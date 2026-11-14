<?php
declare(strict_types=1);

namespace App\Storage\Replication;

use App\Storage\StorageAdapter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * #234: an explicitly invoked, server-only and durable ciphertext replicator.
 *
 * This is a genuine physical copy/repair boundary with a verified destination
 * readback and an account-scoped PostgreSQL lease. The only mutable existing
 * object row is the target location's state, promoted to "verified" AFTER
 * the actual destination content is checked, never based on an S3 PUT ACK.
 *
 * NOT registered as a route/job/scheduler, not BYO credential management,
 * not Recovery Vault backup and not a live StorageManager failover.
 * Physical S3 failures do not delete any copy or claim a successful backup.
 * Separate provider failure domains MUST be established independently of
 * the asserted registry labels before a future production activation.
 */
final class CiphertextReplicaCoordinator
{
    private const TABLE = 'ciphertext_replication_jobs_v1';
    private const MAX_BYTES = 8 * 1024 * 1024;
    private const LEASE_SECONDS = 120;
    private const RETRY_BASE_SECONDS = 10;
    private const RETRY_MAX_SECONDS = 3600;

    /**
     * @param array<string,array{adapter:StorageAdapter,failureDomain:string,credentialRevision:int}> $trustedProviders
     * Trust this server-owned registry only; NEVER bind it from HTTP/JSON.
     */
    public function __construct(private readonly array $trustedProviders) {}

    /** @return array<string,mixed> */
    public function enqueue(
        string $trustedAccountId,
        string $kind,
        string $logicalId,
        string $sourceLocationId,
        string $targetLocationId,
        string $idempotencyKey,
        CarbonImmutable $serverNow,
    ): array {
        self::validateRequest($trustedAccountId,$kind,$logicalId,
            $sourceLocationId,$targetLocationId,$idempotencyKey);
        $serverNow=self::freshNow($serverNow);
        $keyHash = hash('sha256',$idempotencyKey);
        return DB::transaction(function () use (
            $trustedAccountId,$kind,$logicalId,$sourceLocationId,
            $targetLocationId,$keyHash,$serverNow
        ): array {
            $this->lockReadyAccount($trustedAccountId);
            // Idempotent replay of the *same immutable request* remains safe
            // even after its destination was promoted to verified.
            $old=DB::table(self::TABLE)
                ->where('account_id',$trustedAccountId)
                ->where('idempotency_sha256',$keyHash)
                ->lockForUpdate()->first();
            if ($old!==null) {
                if ($old->kind!==$kind || $old->logical_id!==$logicalId
                    || $old->source_location_id!==$sourceLocationId
                    || $old->target_location_id!==$targetLocationId) {
                    throw new RuntimeException('replication.idempotency_conflict');
                }
                return self::statusRow($old);
            }

            $ctx=$this->context($trustedAccountId,$kind,$logicalId,
                $sourceLocationId,$targetLocationId,$serverNow);
            $latest=DB::table(self::TABLE)
                ->where('kind',$kind)
                ->where('target_location_id',$targetLocationId)
                ->orderByDesc('generation')->lockForUpdate()->first();
            $gen=$latest===null?0:(int)$latest->generation;
            if ($latest!==null
                && !in_array($latest->state,['verified','cancelled'],true)) {
                throw new RuntimeException('replication.target_busy');
            }
            if ($gen>=1000000) {
                throw new RuntimeException('replication.generation_limit');
            }
            $id=(string)Str::uuid();
            DB::table(self::TABLE)->insert([
                'id'=>$id,'account_id'=>$trustedAccountId,
                'kind'=>$kind,'logical_id'=>$logicalId,
                'source_location_id'=>$sourceLocationId,
                'target_location_id'=>$targetLocationId,
                'generation'=>$gen+1,'idempotency_sha256'=>$keyHash,
                'ciphertext_sha256'=>$ctx['sha'],
                'ciphertext_bytes'=>$ctx['bytes'],
                'source_credential_revision'=>$ctx['sourceRevision'],
                'target_credential_revision'=>$ctx['targetRevision'],
                'state'=>'queued','attempts'=>0,
                'lease_sha256'=>null,'lease_until'=>null,
                'next_attempt_at'=>$serverNow->utc(),
                'created_at'=>$serverNow->utc(),
                'updated_at'=>$serverNow->utc(),
            ]);
            $row=DB::table(self::TABLE)->where('id',$id)->first();
            if ($row===null) {
                throw new RuntimeException('replication.enqueue_unconfirmed');
            }
            return self::statusRow($row);
        },3);
    }

    /**
     * Exactly one bounded, explicitly invoked attempt. No background worker
     * is auto-scheduled and no plaintext is created. A missing source is
     * retryable, NEVER interpreted as successful physical replication.
     *
     * @return array<string,mixed>
     */
    public function process(string $jobId, CarbonImmutable $now): array
    {
        if (!Str::isUuid($jobId)) {
            throw new RuntimeException('replication.invalid_job_id');
        }
        $now=self::freshNow($now);
        $lease=$this->claim($jobId,$now);
        if ($lease===null) {
            return $this->jobStatus($jobId);
        }
        $tmp=null;
        try {
            $job=$lease['job'];
            $ctx=$this->context(
                $job->account_id,$job->kind,$job->logical_id,
                $job->source_location_id,$job->target_location_id,$now);
            $this->assertJobMatchesContext($job,$ctx);
            $source=$ctx['sourceAdapter'];
            $target=$ctx['targetAdapter'];

            // Verify the ORIGINAL fully before writing a single target byte.
            // Temp stream may spill onto the ephemeral runner's disk but
            // contains ciphertext only. It is closed after every attempt.
            $tmp=fopen('php://temp/maxmemory:1048576','w+b');
            if (!is_resource($tmp)) {
                throw new RuntimeException('replication.unavailable_ciphertext_stream');
            }
            $this->copyVerifiedSource($source,$ctx['source']->object_key,
                $ctx['bytes'],$ctx['sha'],$tmp);

            // A previously completed physical PUT with lost DB ACK must be
            // reconciled by an independent GET/hash, not a fictitious ACK.
            if (!$this->remoteVerified($target,
                $ctx['target']->object_key,$ctx['bytes'],$ctx['sha'])) {
                rewind($tmp);
                if ($target->putStream($ctx['target']->object_key,$tmp)!==true) {
                    throw new RuntimeException('replication.physical_put_failed');
                }
                if (!$this->remoteVerified($target,
                    $ctx['target']->object_key,$ctx['bytes'],$ctx['sha'])) {
                    throw new RuntimeException('replication.target_readback_failed');
                }
            }

            // Recheck the logical parent, live target row, and the SAME
            // source/target object keys under the trusted account lock.
            // The existing StorageManager does NOT acquire this lock yet:
            // full live write fencing remains a later, blocked integration.
            return $this->confirm($jobId,$lease['token'],$ctx,
                self::freshNow($now));
        } catch (Throwable) {
            // Do not log S3 endpoint, object key, provider error or secret.
            // A remote PUT may have succeeded; the next attempt will
            // independently hash the destination and skip a repeated PUT.
            return $this->retry($jobId,$lease['token'],self::freshNow($now));
        } finally {
            if (is_resource($tmp)) fclose($tmp);
        }
    }

    /** @return array<string,mixed> */
    public function status(string $trustedAccountId,string $jobId): array
    {
        if (!Str::isUuid($trustedAccountId) || !Str::isUuid($jobId)) {
            throw new RuntimeException('replication.invalid_identity');
        }
        $job=DB::table(self::TABLE)->where('id',$jobId)
            ->where('account_id',$trustedAccountId)->first();
        if ($job===null) throw new RuntimeException('replication.not_found');
        return self::statusRow($job);
    }

    /** @return array<string,mixed> */
    private function jobStatus(string $id): array
    {
        $row=DB::table(self::TABLE)->where('id',$id)->first();
        if ($row===null) throw new RuntimeException('replication.not_found');
        return self::statusRow($row);
    }

    private function lockReadyAccount(string $account): void
    {
        $a=DB::table('identity_accounts')->where('id',$account)
            ->lockForUpdate()->first();
        if ($a===null || $a->status!=='ready') {
            throw new RuntimeException('replication.account_not_ready');
        }
    }

    /**
     * @return array{job:object,token:string}|null
     */
    private function claim(string $jobId,CarbonImmutable $now): ?array
    {
        $initial=DB::table(self::TABLE)->where('id',$jobId)->first();
        if ($initial===null) throw new RuntimeException('replication.not_found');

        return DB::transaction(function () use ($jobId,$initial,$now): ?array {
            $this->lockReadyAccount((string)$initial->account_id);
            $row=DB::table(self::TABLE)->where('id',$jobId)
                ->lockForUpdate()->first();
            if ($row===null || $row->account_id!==$initial->account_id) {
                throw new RuntimeException('replication.not_found');
            }
            if ($row->state==='verified' || $row->state==='cancelled') return null;
            if ($row->state==='leased' && $row->lease_until!==null
                && CarbonImmutable::parse($row->lease_until)->greaterThan($now)) {
                return null;
            }
            if (!in_array($row->state,['queued','retry','leased'],true)
                || CarbonImmutable::parse($row->next_attempt_at)->greaterThan($now)) {
                return null;
            }
            $token=bin2hex(random_bytes(32));
            DB::table(self::TABLE)->where('id',$jobId)->update([
                'state'=>'leased','attempts'=>min(1000000,(int)$row->attempts+1),
                'lease_sha256'=>hash('sha256',$token),
                'lease_until'=>$now->addSeconds(self::LEASE_SECONDS)->utc(),
                'updated_at'=>$now->utc(),
            ]);
            return ['job'=>DB::table(self::TABLE)->where('id',$jobId)->first(),
                'token'=>$token];
        },3);
    }

    /**
     * @return array<string,mixed> trusted immutable snapshot, for compare
     */
    private function context(
        string $account,string $kind,string $logical,
        string $sourceId,string $targetId,CarbonImmutable $now
    ): array {
        if (!in_array($kind,['photo','media_chunk'],true)
            || !Str::isUuid($logical) || !Str::isUuid($sourceId)
            || !Str::isUuid($targetId) || $sourceId===$targetId) {
            throw new RuntimeException('replication.invalid_target');
        }
        if ($kind==='photo') {
            $record=DB::table('photo_objects as o')
                ->join('photo_records as p','p.id','=','o.photo_id')
                ->join('identity_accounts as a','a.id','=','p.account_id')
                ->where('o.id',$logical)->where('p.account_id',$account)
                ->where('a.status','ready')
                ->first(['p.id as parent_id','p.state as parent_state',
                    'p.expires_at','o.state as asset_state','o.sha256','o.bytes']);
            $table='storage_locations';$fk='asset_id';
            $tomb=$record!==null && DB::table('photo_tombstones')
                ->where('photo_id',$record->parent_id)->exists();
        } else {
            $record=DB::table('media_chunks_v1 as c')
                ->join('media_files_v1 as m','m.id','=','c.media_id')
                ->join('identity_accounts as a','a.id','=','m.account_id')
                ->where('c.id',$logical)->where('m.account_id',$account)
                ->where('a.status','ready')
                ->first(['m.id as parent_id','m.state as parent_state',
                    'm.expires_at','c.state as asset_state','c.sha256','c.bytes']);
            $table='media_chunk_locations_v1';$fk='chunk_id';
            $tomb=$record!==null && DB::table('media_tombstones_v1')
                ->where('media_id',$record->parent_id)->exists();
        }
        if ($record===null || $tomb
            || $record->parent_state!=='active'
            || !in_array($record->asset_state,['active','verified'],true)
            || !is_numeric($record->expires_at)
            || (int)$record->expires_at<=$now->utc()->getTimestampMs()
            || !is_numeric($record->bytes)
            || (int)$record->bytes<1 || (int)$record->bytes>self::MAX_BYTES
            || !self::digest((string)$record->sha256)) {
            throw new RuntimeException('replication.inactive_or_invalid_asset');
        }

        $loc=DB::table($table)->where($fk,$logical)
            ->whereIn('id',[$sourceId,$targetId])->get()->keyBy('id');
        if ($loc->count()!==2) {
            throw new RuntimeException('replication.location_missing');
        }
        $src=$loc->get($sourceId); $dst=$loc->get($targetId);
        foreach ([$src,$dst] as $l) {
            if ((int)$l->bytes!==(int)$record->bytes
                || !hash_equals((string)$record->sha256,(string)$l->sha256)
                || !is_string($l->object_key) || $l->object_key==='') {
                throw new RuntimeException('replication.location_metadata_invalid');
            }
        }
        if (!in_array($src->state,['verified','active'],true)
            || !in_array($dst->state,['reserved','pending','degraded','repairing'],true)
            || $src->provider===$dst->provider) {
            throw new RuntimeException('replication.location_not_eligible');
        }

        $srcBinding=$this->binding((string)$src->provider);
        $dstBinding=$this->binding((string)$dst->provider);
        if ($srcBinding['failureDomain']===$dstBinding['failureDomain']) {
            throw new RuntimeException('replication.same_failure_domain');
        }
        return [
            'kind'=>$kind,'logical'=>$logical,'account'=>$account,
            'parentId'=>(string)$record->parent_id,
            'source'=>$src,'target'=>$dst,'table'=>$table,
            'fk'=>$fk,'sha'=>(string)$record->sha256,
            'bytes'=>(int)$record->bytes,
            'sourceAdapter'=>$srcBinding['adapter'],
            'targetAdapter'=>$dstBinding['adapter'],
            'sourceRevision'=>$srcBinding['credentialRevision'],
            'targetRevision'=>$dstBinding['credentialRevision'],
            'sourceFingerprint'=>self::locationFingerprint($src),
            'targetFingerprint'=>self::locationFingerprint($dst),
        ];
    }

    /** @return array{adapter:StorageAdapter,failureDomain:string,credentialRevision:int} */
    private function binding(string $provider): array
    {
        $value=$this->trustedProviders[$provider]??null;
        if (!is_array($value)
            || !(($value['adapter']??null) instanceof StorageAdapter)
            || !is_string($value['failureDomain']??null)
            || preg_match('/^[A-Za-z0-9_.:-]{8,128}$/D',
                $value['failureDomain'])!==1
            || !is_int($value['credentialRevision']??null)
            || $value['credentialRevision']<1) {
            throw new RuntimeException('replication.provider_not_registered');
        }
        return $value;
    }

    /** @param array<string,mixed> $ctx */
    private function assertJobMatchesContext(object $job,array $ctx): void
    {
        if ($job->account_id!==$ctx['account']
            || $job->kind!==$ctx['kind']
            || $job->logical_id!==$ctx['logical']
            || $job->source_location_id!==$ctx['source']->id
            || $job->target_location_id!==$ctx['target']->id
            || !hash_equals((string)$job->ciphertext_sha256,$ctx['sha'])
            || (int)$job->ciphertext_bytes!==$ctx['bytes']
            || (int)$job->source_credential_revision!==$ctx['sourceRevision']
            || (int)$job->target_credential_revision!==$ctx['targetRevision']) {
            throw new RuntimeException('replication.job_stale');
        }
    }

    /**
     * Read the whole ORIGINAL into a ciphertext-only bounded temp stream.
     * Hashing before PUT blocks propagating a corrupted primary to replica.
     */
    private function copyVerifiedSource(
        StorageAdapter $source,string $key,int $bytes,string $sha,mixed $temp
    ): void {
        if (!$source->exists($key) || $source->size($key)!==$bytes) {
            throw new RuntimeException('replication.source_not_available');
        }
        $in=$source->readStream($key);
        if (!is_resource($in)) {
            throw new RuntimeException('replication.source_not_available');
        }
        try {
            $hash=hash_init('sha256');
            $count=0;
            while (!feof($in)) {
                $chunk=fread($in,65536);
                if ($chunk===false || ($chunk==='' && !feof($in))) {
                    throw new RuntimeException('replication.source_stream_failed');
                }
                $count+=strlen($chunk);
                if ($count>$bytes || fwrite($temp,$chunk)!==strlen($chunk)) {
                    throw new RuntimeException('replication.source_bytes_mismatch');
                }
                hash_update($hash,$chunk);
            }
            if ($count!==$bytes || !hash_equals($sha,hash_final($hash))) {
                throw new RuntimeException('replication.source_integrity_failed');
            }
        } finally {
            fclose($in);
        }
    }

    private function remoteVerified(
        StorageAdapter $adapter,string $key,int $bytes,string $sha
    ): bool {
        if (!$adapter->exists($key) || $adapter->size($key)!==$bytes) return false;
        $stream=$adapter->readStream($key);
        if (!is_resource($stream)) return false;
        try {
            $hash=hash_init('sha256');
            $count=0;
            while (!feof($stream)) {
                $chunk=fread($stream,65536);
                if ($chunk===false || ($chunk==='' && !feof($stream))) {
                    return false;
                }
                $count+=strlen($chunk);
                if ($count>$bytes) return false;
                hash_update($hash,$chunk);
            }
            return $count===$bytes && hash_equals($sha,hash_final($hash));
        } finally {
            fclose($stream);
        }
    }

    /** @param array<string,mixed> $before @return array<string,mixed> */
    private function confirm(
        string $id,string $token,array $before,CarbonImmutable $now
    ): array {
        return DB::transaction(function () use ($id,$token,$before,$now): array {
            $this->lockReadyAccount($before['account']);
            $job=DB::table(self::TABLE)->where('id',$id)
                ->lockForUpdate()->first();
            if ($job===null || $job->state!=='leased'
                || !hash_equals((string)$job->lease_sha256,hash('sha256',$token))
                || $job->lease_until===null
                || !CarbonImmutable::parse($job->lease_until)->greaterThan($now)) {
                throw new RuntimeException('replication.lease_expired');
            }

            $after=$this->context(
                $before['account'],$before['kind'],$before['logical'],
                $before['source']->id,$before['target']->id,$now);
            $this->assertJobMatchesContext($job,$after);
            if (!hash_equals($before['sourceFingerprint'],$after['sourceFingerprint'])
                || !hash_equals($before['targetFingerprint'],$after['targetFingerprint'])) {
                throw new RuntimeException('replication.location_changed_during_copy');
            }
            $affected=DB::table($before['table'])
                ->where('id',$before['target']->id)
                ->where($before['fk'],$before['logical'])
                ->where('state',$before['target']->state)
                ->where('object_key',$before['target']->object_key)
                ->where('sha256',$before['sha'])
                ->where('bytes',$before['bytes'])
                ->update(['state'=>'verified','updated_at'=>$now->utc()]);
            if ($affected!==1) {
                throw new RuntimeException('replication.location_cas_failed');
            }
            DB::table(self::TABLE)->where('id',$id)
                ->where('state','leased')->update([
                    'state'=>'verified','lease_sha256'=>null,'lease_until'=>null,
                    'failure_class'=>null,'verified_at'=>$now->utc(),
                    'updated_at'=>$now->utc(),
                ]);
            $done=DB::table(self::TABLE)->where('id',$id)->first();
            return self::statusRow($done);
        },3);
    }

    /** @return array<string,mixed> */
    private function retry(string $id,string $token,CarbonImmutable $now): array
    {
        return DB::transaction(function () use ($id,$token,$now): array {
            $initial=DB::table(self::TABLE)->where('id',$id)->first();
            if ($initial===null) throw new RuntimeException('replication.not_found');
            // An account can be revoked WHILE ciphertext is being streamed.
            // A stale worker must never leave a permanent positive ACK.
            // We still hold the account mutex to persist a safe terminal
            // sidecar cancellation, never to authorize further uploads.
            $account=DB::table('identity_accounts')
                ->where('id',(string)$initial->account_id)
                ->lockForUpdate()->first();
            $job=DB::table(self::TABLE)->where('id',$id)
                ->lockForUpdate()->first();
            if ($job===null || $job->state!=='leased'
                || !hash_equals((string)$job->lease_sha256,hash('sha256',$token))) {
                // Late failure from an old worker MUST NOT roll back a
                // newer successful ACK or another worker's lease.
                return $this->jobStatus($id);
            }
            if ($account===null || $account->status!=='ready') {
                DB::table(self::TABLE)->where('id',$id)->update([
                    'state'=>'cancelled','lease_sha256'=>null,
                    'lease_until'=>null,'failure_class'=>'account_revoked',
                    'updated_at'=>$now->utc(),
                ]);
                return $this->jobStatus($id);
            }
            $delay=min(self::RETRY_MAX_SECONDS,
                self::RETRY_BASE_SECONDS*(2**min(8,max(0,(int)$job->attempts-1))));
            DB::table(self::TABLE)->where('id',$id)->update([
                'state'=>'retry','lease_sha256'=>null,'lease_until'=>null,
                'next_attempt_at'=>$now->addSeconds($delay)->utc(),
                'failure_class'=>'transport_or_integrity',
                'updated_at'=>$now->utc(),
            ]);
            return $this->jobStatus($id);
        },3);
    }

    /**
     * Prevent a slow S3 transfer from using the timestamp at which it
     * STARTED as proof that TTL/lease is still valid after the remote IO.
     * Callers already supply trusted server time; real UTC may only move
     * this check forward, never back in time.
     */
    private static function freshNow(CarbonImmutable $requested): CarbonImmutable
    {
        $actual=CarbonImmutable::now('UTC');
        return $actual->greaterThan($requested)?$actual:$requested;
    }

    private static function locationFingerprint(object $loc): string
    {
        return hash('sha256',json_encode([
            'id'=>(string)$loc->id,
            'provider'=>(string)$loc->provider,
            'objectKey'=>(string)$loc->object_key,
            'sha'=>(string)$loc->sha256,
            'bytes'=>(int)$loc->bytes,
            'state'=>(string)$loc->state,
            'updatedAt'=>(string)$loc->updated_at,
        ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
    }

    private static function digest(string $sha):bool
    {
        return preg_match('/^[0-9a-f]{64}$/D',$sha)===1;
    }

    private static function validateRequest(
        string $account,string $kind,string $logical,
        string $source,string $target,string $key
    ):void {
        if (!Str::isUuid($account) || !Str::isUuid($logical)
            || !Str::isUuid($source) || !Str::isUuid($target)
            || !in_array($kind,['photo','media_chunk'],true)
            || $source===$target
            || preg_match('/^[A-Za-z0-9_.:-]{16,160}$/D',$key)!==1) {
            throw new RuntimeException('replication.invalid_request');
        }
    }

    /** @return array<string,mixed> metadata only; NO paths or secrets. */
    private static function statusRow(object $row):array
    {
        return [
            'jobId'=>(string)$row->id,
            'kind'=>(string)$row->kind,
            'logicalId'=>(string)$row->logical_id,
            'generation'=>(int)$row->generation,
            'state'=>(string)$row->state,
            'attempts'=>(int)$row->attempts,
            'nextAttemptAt'=>(string)$row->next_attempt_at,
            'verifiedAt'=>$row->verified_at===null?null:(string)$row->verified_at,
            'transferVerified'=>$row->state==='verified',
            'liveReplicaActivated'=>false,
        ];
    }
}
