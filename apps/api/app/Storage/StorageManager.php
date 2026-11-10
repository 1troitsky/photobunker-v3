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
        return $this->adapter($loc->provider)->putStream($loc->object_key,$ciphertextStream);
    }

    public function readAsset(string $assetId): mixed
    {
        foreach ($this->locations($assetId) as $loc) {
            if (!in_array($loc->state,['verified','active'],true)) continue;
            $adapter=$this->adapter($loc->provider);
            if ($adapter->exists($loc->object_key)) return $adapter->readStream($loc->object_key);
        }
        throw new \RuntimeException('storage.no_verified_location');
    }

    public function verifyAsset(string $assetId, int $expectedBytes, string $expectedSha256): bool
    {
        foreach ($this->locations($assetId) as $loc) {
            if ((int)$loc->bytes!==$expectedBytes || !hash_equals($loc->sha256,$expectedSha256)) {
                return false;
            }
            $adapter=$this->adapter($loc->provider);
            if (!$adapter->exists($loc->object_key) || $adapter->size($loc->object_key)!==$expectedBytes) {
                return false;
            }
            $stream=$adapter->readStream($loc->object_key);
            if (!is_resource($stream)) return false;
            try {
                $hash=hash_init('sha256');
                hash_update_stream($hash,$stream);
                if (!hash_equals($expectedSha256,hash_final($hash))) return false;
            } finally {
                fclose($stream);
            }
        }
        // Every registered replica must validate; no missing placement bypass.
        return $this->locations($assetId)->isNotEmpty();
    }

    /** Physically delete all registered locations; never remove DB pointers first. */
    public function deleteAsset(string $assetId): void
    {
        foreach ($this->locations($assetId) as $loc) {
            $adapter=$this->adapter($loc->provider);
            if ($adapter->exists($loc->object_key)) {
                if (!$adapter->delete($loc->object_key) || $adapter->exists($loc->object_key)) {
                    throw new \RuntimeException('storage.delete_unconfirmed');
                }
            }
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
        return $this->adapter($loc->provider)->putStream($loc->object_key,$stream);
    }

    public function verifyMediaChunk(string $chunkId,int $bytes,string $sha256):bool
    {
        $locs=$this->mediaLocations($chunkId);
        if($locs->isEmpty())return false;
        foreach($locs as $loc){
            if((int)$loc->bytes!==$bytes
                ||!hash_equals($sha256,$loc->sha256))return false;
            $adapter=$this->adapter($loc->provider);
            if(!$adapter->exists($loc->object_key)
                ||$adapter->size($loc->object_key)!==$bytes)return false;
            $stream=$adapter->readStream($loc->object_key);
            if(!is_resource($stream))return false;
            try{
                $hash=hash_init('sha256');
                hash_update_stream($hash,$stream);
                if(!hash_equals($sha256,hash_final($hash)))return false;
            }finally{fclose($stream);}
        }
        return true;
    }

    public function readMediaChunk(string $chunkId):mixed
    {
        foreach($this->mediaLocations($chunkId) as $loc){
            if(!in_array($loc->state,['verified','active'],true))continue;
            $adapter=$this->adapter($loc->provider);
            if($adapter->exists($loc->object_key))
                return $adapter->readStream($loc->object_key);
        }
        throw new \RuntimeException('storage.media_chunk_unavailable');
    }

    public function deleteMediaChunk(string $chunkId):void
    {
        foreach($this->mediaLocations($chunkId) as $loc){
            $adapter=$this->adapter($loc->provider);
            if($adapter->exists($loc->object_key)){
                if(!$adapter->delete($loc->object_key)
                    ||$adapter->exists($loc->object_key))
                    throw new \RuntimeException('storage.media_delete_unconfirmed');
            }
        }
    }

    /** Immutable media tombstones forbid re-reserve and late-write resurrection. */
    public function sweepMediaLateWrite(string $objectKey):void
    {
        if(!preg_match(
            '~^cipher/media/v1/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}$~D',
            $objectKey))
            throw new \RuntimeException('storage.invalid_media_tombstone');
        if($this->appS3->exists($objectKey)){
            if(!$this->appS3->delete($objectKey)
                ||$this->appS3->exists($objectKey))
                throw new \RuntimeException('storage.media_tombstone_retry');
        }
    }

    /** Only for tombstones created from formerly registered ciphertext paths. */
    public function sweepLateWrite(string $objectKey): void
    {
        if (!preg_match('~^cipher/v1/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}$~D', $objectKey)) {
            throw new \RuntimeException('storage.invalid_tombstone');
        }
        if ($this->appS3->exists($objectKey)) {
            if (!$this->appS3->delete($objectKey) || $this->appS3->exists($objectKey)) {
                throw new \RuntimeException('storage.tombstone_retry');
            }
        }
    }
}
