<?php
declare(strict_types=1);

namespace App\Storage;

use Illuminate\Support\Facades\DB;

/**
 * One logical asset -> one or more verified physical storage locations.
 * This P1 slice enables app_s3; BYO/replicas are staged for P4.
 *
 * Authorization MUST be enforced by the calling domain service before any
 * method is called. No browser-supplied object keys are accepted.
 */
final class StorageManager
{
    public function __construct(private readonly StorageAdapter $appS3) {}

    private function adapter(string $provider): StorageAdapter
    {
        if ($provider !== 'app_s3') {
            throw new \RuntimeException('storage.unsupported_provider');
        }
        return $this->appS3;
    }

    /**
     * One physical call group is a single health event. Every provider call
     * uses the same durable circuit, independently of Identity and Camera.
     */
    private function io(string $provider,\Closure $operation,bool $falseIsFailure=false):mixed
    {
        $adapter=$this->adapter($provider);
        return app(StorageProviderHealth::class)->call(
            $provider,static fn()=>$operation($adapter),$falseIsFailure);
    }

    private function locations(string $assetId): \Illuminate\Support\Collection
    {
        return DB::table('storage_locations')->where('asset_id', $assetId)
            ->orderBy('id')->get();
    }

    public function writeAsset(string $assetId, mixed $ciphertextStream): bool
    {
        $locations=$this->locations($assetId);
        if ($locations->count() !== 1) throw new \RuntimeException('storage.invalid_write_placement');
        $loc=$locations->first();
        // Ticket first: a process dying after the S3 PUT still leaves a
        // durable reference for ACK-loss verification after restart.
        app(StorageRetryLedger::class)->remember('photo',$assetId);
        return $this->io($loc->provider,
            static fn(StorageAdapter $a)=>$a->putStream($loc->object_key,$ciphertextStream),true);
    }

    public function readAsset(string $assetId): mixed
    {
        foreach ($this->locations($assetId) as $loc) {
            if (!in_array($loc->state,['verified','active'],true)) continue;
            $stream=$this->io($loc->provider,static function(StorageAdapter $a)use($loc){
                return $a->exists($loc->object_key)
                    ?$a->readStream($loc->object_key):null;
            });
            if(is_resource($stream))return $stream;
        }
        throw new \RuntimeException('storage.no_verified_location');
    }

    public function verifyAsset(string $assetId, int $expectedBytes, string $expectedSha256): bool
    {
        foreach ($this->locations($assetId) as $loc) {
            if ((int)$loc->bytes!==$expectedBytes || !hash_equals($loc->sha256,$expectedSha256)) {
                return false;
            }
            $verified=$this->io($loc->provider,
                static function(StorageAdapter $a)use($loc,$expectedBytes,$expectedSha256):bool{
                    if(!$a->exists($loc->object_key)
                        ||$a->size($loc->object_key)!==$expectedBytes)return false;
                    $stream=$a->readStream($loc->object_key);
                    if(!is_resource($stream))return false;
                    try{
                        $hash=hash_init('sha256');
                        hash_update_stream($hash,$stream);
                        return hash_equals($expectedSha256,hash_final($hash));
                    }finally{fclose($stream);}
                });
            if(!$verified)return false;
        }
        // Every registered replica must validate; no missing placement bypass.
        return $this->locations($assetId)->isNotEmpty();
    }

    /** Physically delete all registered locations; never remove DB pointers first. */
    public function deleteAsset(string $assetId): void
    {
        foreach ($this->locations($assetId) as $loc) {
            $deleted=$this->io($loc->provider,
                static fn(StorageAdapter $a)=>!$a->exists($loc->object_key)
                    ||($a->delete($loc->object_key)&&!$a->exists($loc->object_key)),true);
            if(!$deleted)throw new \RuntimeException('storage.delete_unconfirmed');
        }
    }

    /**
     * Media/v1 chunks remain under the SAME centralized StorageManager and
     * physical adapter. Their placement table is separate so legacy photo
     * foreign keys and already stored S3 paths remain unchanged.
     */
    private function mediaLocations(string $chunkId): \Illuminate\Support\Collection
    {
        return DB::table('media_chunk_locations_v1')
            ->where('chunk_id',$chunkId)->orderBy('id')->get();
    }

    public function writeMediaChunk(string $chunkId,mixed $stream):bool
    {
        $locs=$this->mediaLocations($chunkId);
        if($locs->count()!==1)throw new \RuntimeException('storage.invalid_media_placement');
        $loc=$locs->first();
        app(StorageRetryLedger::class)->remember('media',$chunkId);
        return $this->io($loc->provider,
            static fn(StorageAdapter $a)=>$a->putStream($loc->object_key,$stream),true);
    }

    public function verifyMediaChunk(string $chunkId,int $bytes,string $sha256):bool
    {
        $locs=$this->mediaLocations($chunkId);
        if($locs->isEmpty())return false;
        foreach($locs as $loc){
            if((int)$loc->bytes!==$bytes
                ||!hash_equals($sha256,$loc->sha256))return false;
            $verified=$this->io($loc->provider,
                static function(StorageAdapter $a)use($loc,$bytes,$sha256):bool{
                    if(!$a->exists($loc->object_key)
                        ||$a->size($loc->object_key)!==$bytes)return false;
                    $stream=$a->readStream($loc->object_key);
                    if(!is_resource($stream))return false;
                    try{
                        $hash=hash_init('sha256');
                        hash_update_stream($hash,$stream);
                        return hash_equals($sha256,hash_final($hash));
                    }finally{fclose($stream);}
                });
            if(!$verified)return false;
        }
        return true;
    }

    public function readMediaChunk(string $chunkId):mixed
    {
        foreach($this->mediaLocations($chunkId) as $loc){
            if(!in_array($loc->state,['verified','active'],true))continue;
            $stream=$this->io($loc->provider,static function(StorageAdapter $a)use($loc){
                return $a->exists($loc->object_key)
                    ?$a->readStream($loc->object_key):null;
            });
            if(is_resource($stream))return $stream;
        }
        throw new \RuntimeException('storage.media_chunk_unavailable');
    }

    public function deleteMediaChunk(string $chunkId):void
    {
        foreach($this->mediaLocations($chunkId) as $loc){
            $deleted=$this->io($loc->provider,
                static fn(StorageAdapter $a)=>!$a->exists($loc->object_key)
                    ||($a->delete($loc->object_key)&&!$a->exists($loc->object_key)),true);
            if(!$deleted)throw new \RuntimeException('storage.media_delete_unconfirmed');
        }
    }

    /** Immutable media tombstones forbid re-reserve and late-write resurrection. */
    public function sweepMediaLateWrite(string $objectKey):void
    {
        if(!preg_match(
            '~^cipher/media/v1/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}$~D',
            $objectKey))
            throw new \RuntimeException('storage.invalid_media_tombstone');
        $deleted=$this->io('app_s3',
            static fn(StorageAdapter $a)=>!$a->exists($objectKey)
                ||($a->delete($objectKey)&&!$a->exists($objectKey)),true);
        if(!$deleted)throw new \RuntimeException('storage.media_tombstone_retry');
    }

    /** Only for tombstones created from formerly registered ciphertext paths. */
    public function sweepLateWrite(string $objectKey): void
    {
        if (!preg_match('~^cipher/v1/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}$~D', $objectKey)) {
            throw new \RuntimeException('storage.invalid_tombstone');
        }
        $deleted=$this->io('app_s3',
            static fn(StorageAdapter $a)=>!$a->exists($objectKey)
                ||($a->delete($objectKey)&&!$a->exists($objectKey)),true);
        if(!$deleted)throw new \RuntimeException('storage.tombstone_retry');
    }
}
