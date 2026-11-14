<?php
declare(strict_types=1);

namespace App\Storage\Failover;

use App\Storage\StorageAdapter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * #235: strictly internal, read-only replica evidence, NOT an activated
 * StorageManager failover. No endpoint, service binding or user-facing read.
 *
 * A trusted server-side caller supplies account/location IDs. The registry
 * MUST be assembled outside HTTP input. DB provider strings and SHA256
 * alone are not authenticated storage-provider receipts, active-placement
 * generations, ACL authorization, or proof of separate failure domains.
 */
final class ReplicaReadPreflight
{
    private const MAX_CIPHERTEXT_BYTES = 8 * 1024 * 1024;

    /**
     * @param array<string,array{adapter:StorageAdapter,failureDomain:string,credentialRevision:int}> $trustedProviders
     */
    public function __construct(private readonly array $trustedProviders) {}

    /** @return array<string,mixed> */
    public function inspect(
        string $trustedAccountId,
        string $kind,
        string $logicalId,
        string $primaryLocationId,
        string $replicaLocationId,
        CarbonImmutable $serverNow,
    ): array {
        foreach ([$trustedAccountId,$logicalId,$primaryLocationId,$replicaLocationId] as $id) {
            if (!Str::isUuid($id)) {
                throw new RuntimeException('failover.invalid_identity');
            }
        }
        if (!in_array($kind,['photo','media_chunk'],true)
            || $primaryLocationId===$replicaLocationId) {
            throw new RuntimeException('failover.invalid_target');
        }

        $before=$this->snapshot($trustedAccountId,$kind,$logicalId,
            $primaryLocationId,$replicaLocationId,$serverNow);
        $primary=$before['primary'];
        $replica=$before['replica'];
        if ($primary->provider===$replica->provider) {
            throw new RuntimeException('failover.same_provider');
        }
        $primaryTransport=$this->transport((string)$primary->provider);
        $replicaTransport=$this->transport((string)$replica->provider);
        if ($primaryTransport['failureDomain']===$replicaTransport['failureDomain']) {
            throw new RuntimeException('failover.same_failure_domain');
        }

        // Deliberately DO NOT touch the primary transport: it may return 503.
        // The target is hashed in full, without exposing or persisting any
        // ciphertext, object path or sensitive provider exception.
        $this->verifyReplica($replicaTransport['adapter'],
            (string)$replica->object_key,
            $before['bytes'],$before['sha256']);

        // A deletion/revoke/expiry or metadata update can occur during S3 IO.
        // This is a second observation only; an actual read gate must adopt
        // account-scoped versioned locking / signed generation fencing.
        $after=$this->snapshot($trustedAccountId,$kind,$logicalId,
            $primaryLocationId,$replicaLocationId,$serverNow);
        if (!hash_equals($before['fingerprint'],$after['fingerprint'])) {
            throw new RuntimeException('failover.changed_during_read');
        }
        return [
            'schemaVersion'=>1,
            'status'=>'replica_physical_preflight_only',
            'kind'=>$kind,
            'accountId'=>$trustedAccountId,
            'logicalId'=>$logicalId,
            'replicaLocationId'=>$replicaLocationId,
            'ciphertextSha256'=>$before['sha256'],
            'ciphertextBytes'=>$before['bytes'],
            'replicaCredentialRevision'=>$replicaTransport['credentialRevision'],
            'physicallyVerified'=>true,
            'failoverAuthorized'=>false,
        ];
    }

    /** @return array{primary:object,replica:object,sha256:string,bytes:int,fingerprint:string} */
    private function snapshot(
        string $account,string $kind,string $logical,
        string $primaryId,string $replicaId,CarbonImmutable $now
    ): array {
        $photo=$kind==='photo';
        $row=$photo
            ? DB::table('photo_objects as o')
                ->join('photo_records as p','p.id','=','o.photo_id')
                ->join('identity_accounts as a','a.id','=','p.account_id')
                ->where('o.id',$logical)->where('p.account_id',$account)
                ->where('a.status','ready')->first([
                    'p.id as parent_id','p.state as parent_state',
                    'p.expires_at','p.updated_at as parent_updated_at',
                    'a.revision as account_revision',
                    'o.state as asset_state','o.sha256','o.bytes',
                    'o.updated_at as asset_updated_at',
                ])
            : DB::table('media_chunks_v1 as c')
                ->join('media_files_v1 as m','m.id','=','c.media_id')
                ->join('identity_accounts as a','a.id','=','m.account_id')
                ->where('c.id',$logical)->where('m.account_id',$account)
                ->where('a.status','ready')->first([
                    'm.id as parent_id','m.state as parent_state',
                    'm.expires_at','m.updated_at as parent_updated_at',
                    'a.revision as account_revision',
                    'c.state as asset_state','c.sha256','c.bytes',
                    'c.updated_at as asset_updated_at',
                ]);
        if ($row===null || $row->parent_state!=='active'
            || !in_array($row->asset_state,['active','verified'],true)) {
            throw new RuntimeException('failover.asset_unavailable');
        }
        if (!is_numeric($row->expires_at)
            || (int)$row->expires_at<=$now->utc()->getTimestampMs()) {
            throw new RuntimeException('failover.expired');
        }
        $bytes=(int)$row->bytes;
        $sha=(string)$row->sha256;
        if ($bytes<1 || $bytes>self::MAX_CIPHERTEXT_BYTES
            || preg_match('/^[0-9a-f]{64}$/D',$sha)!==1) {
            throw new RuntimeException('failover.invalid_ciphertext_metadata');
        }
        if (DB::table($photo?'photo_tombstones':'media_tombstones_v1')
            ->where($photo?'photo_id':'media_id',$row->parent_id)->exists()) {
            throw new RuntimeException('failover.deleted');
        }

        $locations=DB::table($photo?'storage_locations':'media_chunk_locations_v1')
            ->where($photo?'asset_id':'chunk_id',$logical)
            ->whereIn('id',[$primaryId,$replicaId])->get()->keyBy('id');
        if ($locations->count()!==2) {
            throw new RuntimeException('failover.location_unavailable');
        }
        $primary=$locations->get($primaryId);
        $replica=$locations->get($replicaId);
        // Degraded primary is permitted: its S3 transport is never accessed.
        if (!in_array($primary->state,['active','verified','degraded'],true)
            || !in_array($replica->state,['active','verified'],true)) {
            throw new RuntimeException('failover.location_not_verified');
        }
        foreach ([$primary,$replica] as $loc) {
            if (!is_string($loc->object_key) || $loc->object_key===''
                || (int)$loc->bytes!==$bytes
                || !is_string($loc->sha256)
                || !hash_equals($sha,$loc->sha256)
                || !is_string($loc->provider) || $loc->provider==='') {
                throw new RuntimeException('failover.location_mismatch');
            }
        }

        $parts=[
            (string)$row->parent_id,(string)$row->parent_state,
            (string)$row->expires_at,(string)$row->parent_updated_at,
            // Rotation/recovery may preserve READY yet increment the identity revision.
            // Bypass by changing account revision mid-S3 read is forbidden.
            (string)$row->account_revision,
            (string)$row->asset_state,(string)$row->asset_updated_at,
            $sha,(string)$bytes,
        ];
        foreach ([$primary,$replica] as $loc) {
            foreach (['id','provider','object_key','sha256','bytes','state','updated_at'] as $column) {
                $parts[]=(string)$loc->{$column};
            }
        }
        return [
            'primary'=>$primary,'replica'=>$replica,'sha256'=>$sha,
            'bytes'=>$bytes,
            'fingerprint'=>hash('sha256',json_encode($parts,JSON_THROW_ON_ERROR)),
        ];
    }

    /** @return array{adapter:StorageAdapter,failureDomain:string,credentialRevision:int} */
    private function transport(string $provider):array
    {
        $entry=$this->trustedProviders[$provider]??null;
        if (!is_array($entry)
            || !($entry['adapter']??null) instanceof StorageAdapter
            || !is_string($entry['failureDomain']??null)
            || $entry['failureDomain']===''
            || !is_int($entry['credentialRevision']??null)
            || $entry['credentialRevision']<1) {
            throw new RuntimeException('failover.untrusted_transport');
        }
        return $entry;
    }

    private function verifyReplica(
        StorageAdapter $adapter,string $objectKey,int $expectedBytes,string $expectedSha
    ):void {
        $stream=null;
        try {
            if (!$adapter->exists($objectKey) || $adapter->size($objectKey)!==$expectedBytes) {
                throw new RuntimeException('missing_or_wrong_size');
            }
            $stream=$adapter->readStream($objectKey);
            if (!is_resource($stream)) {
                throw new RuntimeException('no_stream');
            }
            $hash=hash_init('sha256');
            $count=0;
            while (!feof($stream)) {
                $chunk=fread($stream,65536);
                if (!is_string($chunk) || ($chunk==='' && !feof($stream))) {
                    throw new RuntimeException('stream_failure');
                }
                $count+=strlen($chunk);
                if ($count>$expectedBytes) {
                    throw new RuntimeException('oversized_stream');
                }
                hash_update($hash,$chunk);
            }
            if ($count!==$expectedBytes
                || !hash_equals($expectedSha,hash_final($hash))) {
                throw new RuntimeException('bad_digest');
            }
        } catch (Throwable) {
            // Do not leak provider exceptions, keys, endpoints, or credentials.
            throw new RuntimeException('failover.replica_read_unverified');
        } finally {
            if (is_resource($stream)) fclose($stream);
        }
    }
}
