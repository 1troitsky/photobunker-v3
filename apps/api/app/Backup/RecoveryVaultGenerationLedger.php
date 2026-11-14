<?php
declare(strict_types=1);

namespace App\Backup;

use App\Storage\StorageAdapter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * INTERNAL generation metadata/physical manifest readback only (#218).
 *
 * This service NEVER authenticates the caller, accepts client object keys,
 * verifies an end-user signature, builds the backup blob graph, or restores.
 * Its entry points MUST remain unmounted until trusted backup-worker, paid
 * entitlement, signed-encrypted manifest and dedup/ref-accounting gates exist.
 * No automatic cleanup: old ciphertext references survive an atomic switch.
 */
final class RecoveryVaultGenerationLedger
{
    private const GENERATIONS = 'backup_generations_v1';
    private const HEADS = 'backup_generation_heads_v1';
    private const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

    public function __construct(private readonly StorageAdapter $adapter) {}

    /** Deterministic server-derived path; never pass a browser-supplied key. */
    public static function objectKey(string $accountId, string $generationId): string
    {
        self::assertUuid($accountId);
        self::assertUuid($generationId);
        return 'cipher/backup/v1/'.$accountId.'/'.$generationId;
    }

    private static function assertUuid(string $value): void
    {
        if (!preg_match('/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/D', $value)) {
            throw new RuntimeException('vault.invalid_id');
        }
    }

    private static function assertManifest(string $sha256, int $bytes): void
    {
        if (!preg_match('/^[a-f0-9]{64}$/D', $sha256)
            || $bytes < 32 || $bytes > self::MAX_MANIFEST_BYTES) {
            throw new RuntimeException('vault.invalid_manifest');
        }
    }

    /** A real per-account PostgreSQL FOR UPDATE lock is the serialization point. */
    private static function lockAccount(string $accountId): void
    {
        $row = DB::table('identity_accounts')->where('id', $accountId)
            ->lockForUpdate()->first(['id', 'status']);
        if (!$row || $row->status !== 'ready') {
            throw new RuntimeException('vault.account_not_ready');
        }
    }

    /**
     * The existing technical backup admission MUST be confirmed first. A
     * reservation alone is not proof; an expired/stolen worker loses authority.
     * User entitlement and identity authentication are separate mandatory gates.
     */
    private static function assertStartedLease(
        string $accountId, string $operationId, string $leaseId
    ): void {
        $row = DB::table('backup_start_operations_v1')
            ->where('operation_id', $operationId)->first();
        if (!$row || $row->account_id !== $accountId
            || $row->lease_id !== $leaseId || $row->state !== 'started'
            || !$row->lease_expires_at
            || CarbonImmutable::parse($row->lease_expires_at)->lessThanOrEqualTo(
                CarbonImmutable::now('UTC'))) {
            throw new RuntimeException('vault.backup_lease_not_started');
        }
    }

    /**
     * Create a single staged candidate. Does NOT claim the manifest exists.
     * Network failures/restarts/replays never retire the current active head.
     */
    public function stageTrusted(
        string $accountId, string $operationId, string $leaseId,
        string $generationId, string $manifestSha256, int $manifestBytes
    ): string {
        foreach ([$accountId, $operationId, $leaseId, $generationId] as $id) {
            self::assertUuid($id);
        }
        self::assertManifest($manifestSha256, $manifestBytes);
        $key = self::objectKey($accountId, $generationId);

        return DB::transaction(static function () use (
            $accountId, $operationId, $leaseId, $generationId,
            $manifestSha256, $manifestBytes, $key
        ): string {
            self::lockAccount($accountId);
            self::assertStartedLease($accountId, $operationId, $leaseId);
            $previous = DB::table(self::GENERATIONS)->where('id', $generationId)->first();
            if ($previous) {
                if ($previous->account_id !== $accountId
                    || $previous->operation_id !== $operationId
                    || $previous->lease_id !== $leaseId
                    || $previous->manifest_sha256 !== $manifestSha256
                    || (int)$previous->manifest_bytes !== $manifestBytes
                    || $previous->object_key !== $key
                    || !in_array($previous->state, ['staged', 'active'], true)) {
                    throw new RuntimeException('vault.generation_conflict');
                }
                return $key;
            }
            if (DB::table(self::GENERATIONS)->where('account_id', $accountId)
                ->where('state', 'staged')->exists()) {
                throw new RuntimeException('vault.stage_in_progress');
            }
            DB::table(self::GENERATIONS)->insert([
                'id' => $generationId,
                'account_id' => $accountId,
                'operation_id' => $operationId,
                'lease_id' => $leaseId,
                'state' => 'staged',
                'manifest_sha256' => $manifestSha256,
                'manifest_bytes' => $manifestBytes,
                'object_key' => $key,
                'verified_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            return $key;
        }, 3);
    }

    /** Compare the ACTUAL opaque remote bytes, not a client checksum claim. */
    private function physicalReadback(string $key, int $bytes, string $sha256): void
    {
        try {
            if (!$this->adapter->exists($key) || $this->adapter->size($key) !== $bytes) {
                throw new RuntimeException('vault.manifest_not_verified');
            }
            $stream = $this->adapter->readStream($key);
            if (!is_resource($stream)) {
                throw new RuntimeException('vault.manifest_not_verified');
            }
            try {
                $hash = hash_init('sha256');
                hash_update_stream($hash, $stream);
                if (!hash_equals($sha256, hash_final($hash))) {
                    throw new RuntimeException('vault.manifest_not_verified');
                }
            } finally {
                fclose($stream);
            }
        } catch (\Throwable $e) {
            // Do not claim a new verified point on outages, truncated reads,
            // digest mismatch, missing objects, or provider exceptions.
            throw new RuntimeException('vault.manifest_not_verified', 0, $e);
        }
    }

    /**
     * Physical readback is outside the DB transaction; the account row and
     * still-live lease are rechecked at the ACTUAL atomic pointer switch.
     * Existing active data is RETIRED in metadata, never physically deleted.
     */
    public function activateVerifiedTrusted(
        string $accountId, string $operationId, string $leaseId,
        string $generationId
    ): string {
        foreach ([$accountId, $operationId, $leaseId, $generationId] as $id) {
            self::assertUuid($id);
        }
        $row = DB::table(self::GENERATIONS)
            ->where('account_id', $accountId)->where('id', $generationId)->first();
        if (!$row || $row->operation_id !== $operationId
            || $row->lease_id !== $leaseId) {
            throw new RuntimeException('vault.generation_missing');
        }
        if ($row->state === 'active') {
            $head = $this->currentActive($accountId);
            if ($head && $head->id === $generationId) {
                return $generationId; // lost ACK, an already committed result
            }
            throw new RuntimeException('vault.head_integrity_failed');
        }
        if ($row->state !== 'staged') {
            throw new RuntimeException('vault.not_staged');
        }
        $this->physicalReadback($row->object_key,
            (int)$row->manifest_bytes, (string)$row->manifest_sha256);

        return DB::transaction(static function () use (
            $accountId, $operationId, $leaseId, $generationId, $row
        ): string {
            self::lockAccount($accountId);
            $current = DB::table(self::GENERATIONS)
                ->where('account_id', $accountId)->where('id', $generationId)
                ->lockForUpdate()->first();
            if (!$current || $current->operation_id !== $operationId
                || $current->lease_id !== $leaseId
                || $current->manifest_sha256 !== $row->manifest_sha256
                || (int)$current->manifest_bytes !== (int)$row->manifest_bytes
                || $current->object_key !== $row->object_key) {
                throw new RuntimeException('vault.generation_conflict');
            }
            $head = DB::table(self::HEADS)->where('account_id', $accountId)->first();
            if ($current->state === 'active' && $head
                && $head->generation_id === $generationId) {
                return $generationId;
            }
            if ($current->state !== 'staged') {
                throw new RuntimeException('vault.not_staged');
            }
            self::assertStartedLease($accountId, $operationId, $leaseId);
            if ($head) {
                $old = DB::table(self::GENERATIONS)
                    ->where('id', $head->generation_id)
                    ->where('account_id', $accountId)
                    ->lockForUpdate()->first();
                if (!$old || $old->state !== 'active') {
                    throw new RuntimeException('vault.head_integrity_failed');
                }
                DB::table(self::GENERATIONS)->where('id', $old->id)
                    ->update(['state' => 'retired', 'updated_at' => now()]);
            }
            DB::table(self::GENERATIONS)->where('id', $generationId)->update([
                'state' => 'active', 'verified_at' => now(), 'updated_at' => now(),
            ]);
            if ($head) {
                DB::table(self::HEADS)->where('account_id', $accountId)->update([
                    'generation_id' => $generationId, 'updated_at' => now(),
                ]);
            } else {
                DB::table(self::HEADS)->insert([
                    'account_id' => $accountId, 'generation_id' => $generationId,
                    'updated_at' => now(),
                ]);
            }
            return $generationId;
        }, 3);
    }

    /**
     * Recover from a dead/expired generation producer WITHOUT S3 deletion.
     * This may only be invoked by a separately authenticated trusted worker.
     * The account row lock serializes stage, release and activation.
     *
     * An active lease MUST never be discarded by another worker. The staged
     * metadata remains as an audit trail; no old verified point is changed.
     */
    public function abandonStaleTrusted(string $accountId): ?string
    {
        self::assertUuid($accountId);
        return DB::transaction(static function () use ($accountId): ?string {
            self::lockAccount($accountId);
            $row = DB::table(self::GENERATIONS)->where('account_id', $accountId)
                ->where('state', 'staged')->lockForUpdate()->first();
            if (!$row) {
                return null;
            }
            $lease = DB::table('backup_start_operations_v1')
                ->where('operation_id', $row->operation_id)->first();
            if (!$lease || $lease->account_id !== $accountId
                || $lease->lease_id !== $row->lease_id) {
                throw new RuntimeException('vault.backup_lease_integrity_failed');
            }
            $live = in_array($lease->state, ['reserved', 'started'], true)
                && $lease->lease_expires_at !== null
                && CarbonImmutable::parse($lease->lease_expires_at)
                    ->greaterThan(CarbonImmutable::now('UTC'));
            if ($live) {
                throw new RuntimeException('vault.stage_lease_still_live');
            }
            DB::table(self::GENERATIONS)->where('id', $row->id)
                ->where('state', 'staged')
                ->update(['state' => 'abandoned', 'updated_at' => now()]);
            return (string) $row->id;
        }, 3);
    }

    /**
     * Read only already-verified active OPAQUE CIPHERTEXT, checking current
     * remote bytes AGAIN before returning any of them to a trusted caller.
     *
     * StorageAdapter does not currently provide object version/conditional
     * PUT, so this detects a later overwrite; it is NOT proof that the
     * manifest was immutable at promotion time. Not mounted to HTTP/restore.
     * All keys and authorization/entitlement proofs remain separate.
     */
    public function readVerifiedActiveCiphertextTrusted(string $accountId): string
    {
        $active = $this->currentActive($accountId);
        if ($active === null) {
            throw new RuntimeException('vault.no_verified_generation');
        }
        $expectedBytes = (int) $active->manifest_bytes;
        $expectedHash = (string) $active->manifest_sha256;
        self::assertManifest($expectedHash, $expectedBytes);
        try {
            $stream = $this->adapter->readStream((string) $active->object_key);
            if (!is_resource($stream)) {
                throw new RuntimeException('vault.manifest_not_verified');
            }
            $bytes = '';
            $hash = hash_init('sha256');
            try {
                while (!feof($stream)) {
                    $part = fread($stream, 65536);
                    if ($part === false || ($part === '' && !feof($stream))) {
                        throw new RuntimeException('vault.manifest_not_verified');
                    }
                    $size = strlen($part);
                    if (strlen($bytes) + $size > $expectedBytes) {
                        throw new RuntimeException('vault.manifest_not_verified');
                    }
                    $bytes .= $part;
                    hash_update($hash, $part);
                }
                if (strlen($bytes) !== $expectedBytes
                    || !hash_equals($expectedHash, hash_final($hash))) {
                    throw new RuntimeException('vault.manifest_not_verified');
                }
            } finally {
                fclose($stream);
            }
        } catch (\Throwable $e) {
            throw new RuntimeException('vault.manifest_not_verified', 0, $e);
        }
        // Fail closed if a concurrent generation switch happened during I/O.
        $latest = $this->currentActive($accountId);
        if ($latest === null || $latest->id !== $active->id
            || $latest->manifest_sha256 !== $expectedHash
            || (int) $latest->manifest_bytes !== $expectedBytes) {
            throw new RuntimeException('vault.head_changed_during_read');
        }
        return $bytes; // Encrypted bytes only; caller must not log them.
    }

    /** Internal read only. Restore MUST physically re-verify the digest. */
    public function currentActive(string $accountId): ?object
    {
        self::assertUuid($accountId);
        $head = DB::table(self::HEADS)->where('account_id', $accountId)->first();
        if (!$head) {
            return null;
        }
        $row = DB::table(self::GENERATIONS)
            ->where('id', $head->generation_id)
            ->where('account_id', $accountId)->first();
        if (!$row || $row->state !== 'active' || !$row->verified_at) {
            throw new RuntimeException('vault.head_integrity_failed');
        }
        return $row;
    }
}
