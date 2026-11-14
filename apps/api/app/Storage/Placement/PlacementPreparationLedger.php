<?php
declare(strict_types=1);

namespace App\Storage\Placement;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Durable, account-locked CAS for NON-ACTIVATING placement candidates (#233).
 *
 * This ledger does NOT gate StorageManager writers, represent an authoritative
 * active placement pointer, sign S3 receipts, prove independent cloud
 * failure domains or move/delete any ciphertext. It only serializes
 * cooperating internal candidate-preparation calls in PostgreSQL 18.
 *
 * The physical readback happens BEFORE opening a DB transaction to avoid
 * holding an account lock while streaming remote ciphertext. Metadata and
 * identity are checked AGAIN under the account mutex. Neither check is a
 * production switch authorization: TOCTOU can occur afterward and the
 * actual switch must repeat trusted receipt and writer-fence checks.
 */
final class PlacementPreparationLedger
{
    private const TABLE = 'placement_candidate_preparations_v1';

    public function __construct(private readonly PlacementReadiness $readiness) {}

    /**
     * @return array<string,mixed> durable candidate metadata only
     */
    public function prepare(
        string $trustedAccountId,
        string $kind,
        string $logicalId,
        string $sourceLocationId,
        string $targetLocationId,
        int $expectedGeneration,
        string $idempotencyKey,
        CarbonImmutable $serverNow,
    ): array {
        self::validate($trustedAccountId,$kind,$logicalId,
            $expectedGeneration,$idempotencyKey);

        // Real physical readback by the separately bound, trusted provider
        // registry. Never read object paths from untrusted HTTP input.
        $evidence = match ($kind) {
            'photo' => $this->readiness->photo(
                $trustedAccountId,$logicalId,$sourceLocationId,
                $targetLocationId,$serverNow),
            'media_chunk' => $this->readiness->mediaChunk(
                $trustedAccountId,$logicalId,$sourceLocationId,
                $targetLocationId,$serverNow),
        };
        if (($evidence['status'] ?? null)!=='physical_preflight_only'
            || ($evidence['switchAuthorized'] ?? null)!==false
            || ($evidence['accountId'] ?? null)!==$trustedAccountId
            || ($evidence['kind'] ?? null)!==$kind
            || ($evidence['logicalId'] ?? null)!==$logicalId
            || ($evidence['sourceLocationId'] ?? null)!==$sourceLocationId
            || ($evidence['targetLocationId'] ?? null)!==$targetLocationId
            || !is_string($evidence['ciphertextSha256'] ?? null)
            || preg_match('/^[0-9a-f]{64}$/D',$evidence['ciphertextSha256'])!==1
            || !is_int($evidence['ciphertextBytes'] ?? null)
            || $evidence['ciphertextBytes'] <= 0
            || !is_int($evidence['sourceCredentialRevision'] ?? null)
            || $evidence['sourceCredentialRevision'] < 1
            || !is_int($evidence['targetCredentialRevision'] ?? null)
            || $evidence['targetCredentialRevision'] < 1) {
            throw new RuntimeException('placement.invalid_physical_preflight');
        }

        $keySha=hash('sha256',$idempotencyKey);
        return DB::transaction(function () use (
            $trustedAccountId,$kind,$logicalId,
            $sourceLocationId,$targetLocationId,$expectedGeneration,
            $keySha,$evidence,$serverNow
        ): array {
            $this->readyAccountLock($trustedAccountId);
            // Recheck the actual mutable database after physical I/O.
            $this->recheckCanonical($trustedAccountId,$kind,$logicalId,
                $sourceLocationId,$targetLocationId,$evidence,$serverNow);

            $latest=DB::table(self::TABLE)
                ->where('kind',$kind)->where('logical_id',$logicalId)
                ->orderByDesc('generation')->lockForUpdate()->first();
            $used=DB::table(self::TABLE)
                ->where('account_id',$trustedAccountId)
                ->where('idempotency_sha256',$keySha)
                ->lockForUpdate()->first();

            if ($used!==null) {
                if ($used->kind!==$kind
                    || $used->logical_id!==$logicalId
                    || $used->source_location_id!==$sourceLocationId
                    || $used->target_location_id!==$targetLocationId
                    || !hash_equals($used->ciphertext_sha256,
                        $evidence['ciphertextSha256'])
                    || (int)$used->ciphertext_bytes!==$evidence['ciphertextBytes']
                    || (int)$used->source_credential_revision
                        !==$evidence['sourceCredentialRevision']
                    || (int)$used->target_credential_revision
                        !==$evidence['targetCredentialRevision']) {
                    throw new RuntimeException('placement.idempotency_conflict');
                }
                if ($used->state!=='prepared'
                    || $latest===null
                    || $used->id!==$latest->id) {
                    throw new RuntimeException('placement.idempotency_consumed');
                }
                // A replay must carry the same original expected generation.
                if ($expectedGeneration!==(int)$used->generation-1) {
                    throw new RuntimeException('placement.stale_generation');
                }
                return self::result($used);
            }

            $generation=$latest===null?0:(int)$latest->generation;
            if ($expectedGeneration!==$generation) {
                throw new RuntimeException('placement.stale_generation');
            }
            if ($latest!==null && $latest->state!=='abandoned') {
                throw new RuntimeException('placement.candidate_already_prepared');
            }
            if ($generation===PHP_INT_MAX) {
                throw new RuntimeException('placement.generation_exhausted');
            }

            $id=(string)Str::uuid();
            DB::table(self::TABLE)->insert([
                'id'=>$id,
                'account_id'=>$trustedAccountId,
                'kind'=>$kind,'logical_id'=>$logicalId,
                'generation'=>$generation+1,
                'idempotency_sha256'=>$keySha,
                'source_location_id'=>$sourceLocationId,
                'target_location_id'=>$targetLocationId,
                'ciphertext_sha256'=>$evidence['ciphertextSha256'],
                'ciphertext_bytes'=>$evidence['ciphertextBytes'],
                'source_credential_revision'=>$evidence['sourceCredentialRevision'],
                'target_credential_revision'=>$evidence['targetCredentialRevision'],
                'physically_observed_at'=>$serverNow->utc(),
                'state'=>'prepared',
                'created_at'=>$serverNow->utc(),
                'updated_at'=>$serverNow->utc(),
            ]);

            $row=DB::table(self::TABLE)->where('id',$id)->first();
            if ($row===null) {
                throw new RuntimeException('placement.candidate_insert_unconfirmed');
            }
            return self::result($row);
        }, 3);
    }

    /**
     * Revoke a candidate record ONLY; no physical deletion, no pointer change.
     * Requires the trusted account and the exact generation/key used to
     * create the candidate. Safe, idempotent terminal event.
     *
     * @return array<string,mixed>
     */
    public function abandon(
        string $trustedAccountId,
        string $kind,
        string $logicalId,
        int $candidateGeneration,
        string $idempotencyKey,
        CarbonImmutable $serverNow,
    ): array {
        self::validate($trustedAccountId,$kind,$logicalId,
            $candidateGeneration,$idempotencyKey);
        if ($candidateGeneration<1) {
            throw new RuntimeException('placement.invalid_generation');
        }
        $keySha=hash('sha256',$idempotencyKey);

        return DB::transaction(function () use (
            $trustedAccountId,$kind,$logicalId,
            $candidateGeneration,$keySha,$serverNow
        ): array {
            $this->readyAccountLock($trustedAccountId);
            $row=DB::table(self::TABLE)
                ->where('kind',$kind)->where('logical_id',$logicalId)
                ->orderByDesc('generation')->lockForUpdate()->first();
            if ($row===null
                || $row->account_id!==$trustedAccountId
                || (int)$row->generation!==$candidateGeneration
                || !hash_equals($row->idempotency_sha256,$keySha)) {
                throw new RuntimeException('placement.candidate_not_current');
            }
            if ($row->state==='abandoned') {
                return self::result($row);
            }
            if ($row->state!=='prepared') {
                throw new RuntimeException('placement.invalid_candidate_state');
            }
            DB::table(self::TABLE)->where('id',$row->id)
                ->where('state','prepared')
                ->update(['state'=>'abandoned','updated_at'=>$serverNow->utc()]);
            return self::result(DB::table(self::TABLE)->where('id',$row->id)->first());
        }, 3);
    }

    private function readyAccountLock(string $account): void
    {
        $row=DB::table('identity_accounts')->where('id',$account)
            ->lockForUpdate()->first();
        if ($row===null || $row->status!=='ready') {
            throw new RuntimeException('placement.account_unavailable');
        }
    }

    /**
     * Does not lock the writers in StorageManager; that future integration
     * must adopt the same durable fencing protocol before ANY real switch.
     * The source and target bytes and location metadata must still match
     * physical preflight at this instant.
     *
     * @param array<string,mixed> $evidence
     */
    private function recheckCanonical(
        string $account,string $kind,string $logical,
        string $sourceId,string $targetId,array $evidence,
        CarbonImmutable $now
    ): void {
        if ($kind==='photo') {
            $row=DB::table('photo_objects as o')
                ->join('photo_records as p','p.id','=','o.photo_id')
                ->where('o.id',$logical)->where('p.account_id',$account)
                ->first(['p.id as parent_id','p.state as parent_state',
                    'p.expires_at','o.state as asset_state','o.bytes','o.sha256']);
            $table='storage_locations';$fk='asset_id';
            $deleted=$row!==null && DB::table('photo_tombstones')
                ->where('photo_id',$row->parent_id)->exists();
        } else {
            $row=DB::table('media_chunks_v1 as c')
                ->join('media_files_v1 as m','m.id','=','c.media_id')
                ->where('c.id',$logical)->where('m.account_id',$account)
                ->first(['m.id as parent_id','m.state as parent_state',
                    'm.expires_at','c.state as asset_state','c.bytes','c.sha256']);
            $table='media_chunk_locations_v1';$fk='chunk_id';
            $deleted=$row!==null && DB::table('media_tombstones_v1')
                ->where('media_id',$row->parent_id)->exists();
        }
        if ($row===null || $deleted
            || $row->parent_state!=='active'
            || !in_array($row->asset_state,['active','verified'],true)
            || !is_numeric($row->expires_at)
            || (int)$row->expires_at <= $now->utc()->getTimestampMs()
            || (int)$row->bytes!==$evidence['ciphertextBytes']
            || !hash_equals((string)$row->sha256,$evidence['ciphertextSha256'])) {
            throw new RuntimeException('placement.candidate_stale_after_read');
        }
        $locations=DB::table($table)->where($fk,$logical)
            ->whereIn('id',[$sourceId,$targetId])->get()->keyBy('id');
        if ($locations->count()!==2) {
            throw new RuntimeException('placement.candidate_stale_after_read');
        }
        foreach ([$sourceId,$targetId] as $id) {
            $location=$locations->get($id);
            if ($location===null
                || !in_array($location->state,['verified','active'],true)
                || (int)$location->bytes!==$evidence['ciphertextBytes']
                || !hash_equals((string)$location->sha256,$evidence['ciphertextSha256'])) {
                throw new RuntimeException('placement.candidate_stale_after_read');
            }
        }
        if ($locations->get($sourceId)->provider!==$evidence['sourceProvider']
            || $locations->get($targetId)->provider!==$evidence['targetProvider']
            || $locations->get($sourceId)->provider===$locations->get($targetId)->provider) {
            throw new RuntimeException('placement.candidate_stale_after_read');
        }
    }

    private static function validate(
        string $account,string $kind,string $logical,
        int $generation,string $idempotencyKey
    ): void {
        if (!Str::isUuid($account) || !Str::isUuid($logical)
            || !in_array($kind,['photo','media_chunk'],true)
            || $generation<0
            || preg_match('/^[A-Za-z0-9_.:-]{16,160}$/D',$idempotencyKey)!==1) {
            throw new RuntimeException('placement.invalid_candidate_request');
        }
    }

    /** @return array<string,mixed> */
    private static function result(object $row): array
    {
        return [
            'schemaVersion'=>1,
            'candidateId'=>(string)$row->id,
            'kind'=>(string)$row->kind,
            'logicalId'=>(string)$row->logical_id,
            'generation'=>(int)$row->generation,
            'state'=>(string)$row->state,
            'sourceLocationId'=>(string)$row->source_location_id,
            'targetLocationId'=>(string)$row->target_location_id,
            'ciphertextSha256'=>(string)$row->ciphertext_sha256,
            'ciphertextBytes'=>(int)$row->ciphertext_bytes,
            'switchAuthorized'=>false,
            'status'=>'durable_candidate_only',
        ];
    }
}
