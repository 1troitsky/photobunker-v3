<?php

declare(strict_types=1);

namespace App\OperationalLimits;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Atomic, per-account backup admission. No tariff or HTTP trust decisions here.
 *
 * All methods MUST be called only after a trusted caller establishes accountId
 * and worker ownership. Reservation is NOT an accepted start; only confirmStart()
 * consumes the technical 3600-second window. Failed starts after confirmation
 * keep that technical window, but NEVER charge a product quota in this service.
 *
 * PostgreSQL identity_accounts row FOR UPDATE + partial unique active index
 * guarantee cross-process serialization. A worker must heartbeat while active.
 */
final class BackupAdmission
{
    private const TABLE = 'backup_start_operations_v1';
    private const LEASE_SECONDS = 900;
    private const MIN_INTERVAL = 3600;

    public function reserve(string $accountId, string $operationId): BackupDecision
    {
        if (!$this->validIds($accountId, $operationId)) {
            return $this->deny('backup.invalid_operation', 400);
        }

        return DB::transaction(function () use ($accountId, $operationId): BackupDecision {
            $account = $this->accountLock($accountId);
            if ($account === null) {
                return $this->deny('backup.account_unavailable', 404);
            }
            if ($account->status !== 'ready') {
                return $this->deny('backup.account_inactive', 403);
            }

            $now = $this->clock();
            $this->expireStale($accountId, $now);

            // Global operation ID is unique; a different account can never
            // replay it or adopt the lease. Terminal IDs can never restart.
            $existing = DB::table(self::TABLE)->where('operation_id', $operationId)->first();
            if ($existing !== null) {
                if ($existing->account_id !== $accountId) {
                    return $this->deny('backup.operation_conflict', 409);
                }
                if (in_array($existing->state, ['reserved', 'started'], true)) {
                    return $this->ok($existing->state, $existing, true);
                }

                return $this->deny('backup.operation_final', 409);
            }

            $active = DB::table(self::TABLE)->where('account_id', $accountId)
                ->whereIn('state', ['reserved', 'started'])->first();
            if ($active !== null) {
                $until = CarbonImmutable::parse($active->lease_expires_at);
                return $this->deny('backup.active', 409, $now, $until);
            }

            $last = $this->lastAccepted($accountId);
            $next = $last === null ? null : CarbonImmutable::parse($last->accepted_at)
                ->addSeconds($this->minimumInterval());
            if ($next !== null && $now->lessThan($next)) {
                return $this->deny('backup.cooldown', 429, $now, $next);
            }

            $leaseId = (string) Str::uuid();
            $expiry = $now->addSeconds(self::LEASE_SECONDS);
            DB::table(self::TABLE)->insert([
                'operation_id' => $operationId,
                'account_id' => $accountId,
                'lease_id' => $leaseId,
                'state' => 'reserved',
                'reserved_at' => $now,
                'accepted_at' => null,
                'lease_expires_at' => $expiry,
                'finished_at' => null,
            ]);

            return new BackupDecision('backup.reserved', 202, true, leaseId: $leaseId,
                leaseExpiresAt: $expiry->toIso8601String());
        }, 3);
    }

    /** Confirm only AFTER the trusted scheduler/worker has accepted the start. */
    public function confirmStart(string $accountId, string $operationId, string $leaseId): BackupDecision
    {
        return $this->operate($accountId, $operationId, $leaseId,
            function (object $operation, CarbonImmutable $now) use ($accountId): BackupDecision {
                if ($operation->state === 'started') {
                    return $this->ok('started', $operation, true);
                }
                if ($operation->state !== 'reserved') {
                    return $this->deny('backup.not_reserved', 409);
                }

                // Protect against policy changes after reservation.
                $last = $this->lastAccepted($accountId);
                $next = $last === null ? null : CarbonImmutable::parse($last->accepted_at)
                    ->addSeconds($this->minimumInterval());
                if ($next !== null && $now->lessThan($next)) {
                    return $this->deny('backup.cooldown', 429, $now, $next);
                }

                DB::table(self::TABLE)->where('operation_id', $operation->operation_id)
                    ->where('state', 'reserved')->update([
                        'state' => 'started',
                        'accepted_at' => $now,
                        'lease_expires_at' => $now->addSeconds(self::LEASE_SECONDS),
                    ]);
                $started = DB::table(self::TABLE)
                    ->where('operation_id', $operation->operation_id)->first();

                return $this->ok('started', $started);
            }, true);
    }

    /** Extend only a live confirmed worker lease; a stale worker cannot revive. */
    public function heartbeat(string $accountId, string $operationId, string $leaseId): BackupDecision
    {
        return $this->operate($accountId, $operationId, $leaseId,
            function (object $operation, CarbonImmutable $now): BackupDecision {
                if ($operation->state !== 'started') {
                    return $this->deny('backup.not_started', 409);
                }
                $expiry = $now->addSeconds(self::LEASE_SECONDS);
                DB::table(self::TABLE)->where('operation_id', $operation->operation_id)
                    ->where('state', 'started')->update(['lease_expires_at' => $expiry]);

                return new BackupDecision('backup.started', 200, true, leaseId: $operation->lease_id,
                    leaseExpiresAt: $expiry->toIso8601String());
            });
    }

    /**
     * A confirmed failure frees concurrency but retains technical cooldown.
     * A canceled reservation never consumes cooldown or product quota.
     */
    public function finish(string $accountId, string $operationId, string $leaseId, bool $success): BackupDecision
    {
        return $this->operate($accountId, $operationId, $leaseId,
            function (object $operation, CarbonImmutable $now) use ($success): BackupDecision {
                if (in_array($operation->state, ['completed', 'failed', 'canceled'], true)) {
                    return $this->ok($operation->state, $operation, true);
                }
                if ($operation->state !== 'started' && ($operation->state !== 'reserved' || $success)) {
                    return $this->deny('backup.not_started', 409);
                }

                $state = $operation->state === 'reserved'
                    ? 'canceled' : ($success ? 'completed' : 'failed');
                DB::table(self::TABLE)->where('operation_id', $operation->operation_id)
                    ->update([
                        'state' => $state,
                        'lease_expires_at' => null,
                        'finished_at' => $now,
                    ]);
                $done = DB::table(self::TABLE)
                    ->where('operation_id', $operation->operation_id)->first();

                return $this->ok($state, $done);
            });
    }

    /**
     * Per-account lock is the serialization point for independent web/queue
     * processes. Backends without row-level locks are NOT concurrency proof.
     */
    private function accountLock(string $accountId): ?object
    {
        return DB::table('identity_accounts')->where('id', $accountId)
            ->lockForUpdate()->first(['id', 'status']);
    }

    /**
     * On PG use the actual database wall clock AFTER waiting on the row lock
     * (transaction_timestamp() would be stale after contention). SQLite clock
     * is only for non-concurrency unit tests.
     */
    private function clock(): CarbonImmutable
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            $row = DB::selectOne('SELECT clock_timestamp() AS db_now');
            return CarbonImmutable::parse($row->db_now);
        }

        return CarbonImmutable::now();
    }

    private function expireStale(string $accountId, CarbonImmutable $now): void
    {
        DB::table(self::TABLE)->where('account_id', $accountId)
            ->whereIn('state', ['reserved', 'started'])
            ->where(function ($q) use ($now): void {
                $q->where('lease_expires_at', '<=', $now)->orWhereNull('lease_expires_at');
            })
            ->update(['state' => 'expired', 'lease_expires_at' => null, 'finished_at' => $now]);
    }

    private function lastAccepted(string $accountId): ?object
    {
        return DB::table(self::TABLE)->where('account_id', $accountId)
            ->whereNotNull('accepted_at')->orderByDesc('accepted_at')->first();
    }

    private function minimumInterval(): int
    {
        // Unlimited/Unlimited+ may change product quotas, never this floor.
        return max(self::MIN_INTERVAL,
            (int) config('operational_limits.backup.minimum_start_interval_seconds', self::MIN_INTERVAL));
    }

    private function operate(
        string $accountId,
        string $operationId,
        string $leaseId,
        \Closure $action,
        bool $requireReady = false,
    ): BackupDecision {
        if (!$this->validIds($accountId, $operationId) || !Str::isUuid($leaseId)) {
            return $this->deny('backup.invalid_operation', 400);
        }

        return DB::transaction(function () use (
            $accountId, $operationId, $leaseId, $action, $requireReady
        ): BackupDecision {
            $account = $this->accountLock($accountId);
            if ($account === null) {
                return $this->deny('backup.account_unavailable', 404);
            }
            if ($requireReady && $account->status !== 'ready') {
                return $this->deny('backup.account_inactive', 403);
            }
            $now = $this->clock();
            $this->expireStale($accountId, $now);
            $operation = DB::table(self::TABLE)->where('operation_id', $operationId)->first();
            if ($operation === null || $operation->account_id !== $accountId
                || $operation->lease_id !== $leaseId) {
                return $this->deny('backup.operation_conflict', 409);
            }
            if ($operation->state === 'expired') {
                return $this->deny('backup.lease_expired', 409);
            }

            return $action($operation, $now);
        }, 3);
    }

    private function validIds(string $accountId, string $operationId): bool
    {
        return Str::isUuid($accountId) && Str::isUuid($operationId);
    }

    private function ok(string $state, object $operation, bool $idem = false): BackupDecision
    {
        return new BackupDecision('backup.'.$state, $state === 'reserved' ? 202 : 200,
            true, $idem, $operation->lease_id,
            $operation->lease_expires_at === null
                ? null : CarbonImmutable::parse($operation->lease_expires_at)->toIso8601String());
    }

    private function deny(string $code, int $httpStatus,
        ?CarbonImmutable $now = null, ?CarbonImmutable $next = null): BackupDecision
    {
        $retry = $now !== null && $next !== null
            ? max(1, (int) ceil($now->diffInSeconds($next))) : null;

        return new BackupDecision($code, $httpStatus, false, nextAllowedAt: $next?->toIso8601String(),
            retryAfter: $retry);
    }
}
