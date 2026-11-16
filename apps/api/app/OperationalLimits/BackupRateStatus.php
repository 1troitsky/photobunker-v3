<?php

declare(strict_types=1);

namespace App\OperationalLimits;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Advisory, READ-ONLY projection of the real BackupAdmission technical gate.
 *
 * This is not an admission decision. Only reserve()/confirmStart() holding the
 * identity_accounts row lock may accept any future scheduler-backed backup.
 * This reader never changes leases, decides tariff eligibility, or leaks
 * lease IDs, operation IDs, account IDs, recovery keys or media metadata.
 */
final class BackupRateStatus
{
    private const TABLE = 'backup_start_operations_v1';
    private const INTERVAL_SECONDS = 3600;

    /** @return array<string,int|string|bool|null> */
    public function forAccount(string $accountId): array
    {
        // This class accepts ONLY a caller-established account ID. The HTTP
        // layer obtains it from PhotoSync::actor(), never from request input.
        $now = $this->now();
        $lease = DB::table(self::TABLE)
            ->where('account_id', $accountId)
            ->whereIn('state', ['reserved', 'started'])
            ->whereNotNull('lease_expires_at')
            ->where('lease_expires_at', '>', $now)
            ->orderByDesc('lease_expires_at')
            ->first(['state', 'lease_expires_at']);

        $last = DB::table(self::TABLE)
            ->where('account_id', $accountId)
            ->whereNotNull('accepted_at')
            ->orderByDesc('accepted_at')
            ->first(['accepted_at']);

        // Match BackupAdmission::minimumInterval() byte-for-byte on config
        // coercion: a numeric string from deployment config must not let the
        // advisory GET show an earlier start than atomic POST admission.
        $floor = max(self::INTERVAL_SECONDS, (int) config(
            'operational_limits.backup.minimum_start_interval_seconds',
            self::INTERVAL_SECONDS
        ));
        $cooldownUntil = $last === null ? null
            : CarbonImmutable::parse($last->accepted_at)->utc()->addSeconds($floor);
        $activeUntil = $lease === null ? null
            : CarbonImmutable::parse($lease->lease_expires_at)->utc();
        $blocked = $activeUntil !== null || ($cooldownUntil !== null && $now->lessThan($cooldownUntil));
        $gate = $activeUntil !== null ? 'active_lease'
            : ($blocked ? 'cooldown' : 'clear');

        // If a worker lease and last accepted start coexist, the next
        // possible attempt is AFTER BOTH ceilings, never the earlier one.
        $next = $activeUntil;
        if ($cooldownUntil !== null && $now->lessThan($cooldownUntil)
            && ($next === null || $cooldownUntil->greaterThan($next))) {
            $next = $cooldownUntil;
        }
        $retry = $next === null ? null
            : max(1, (int) ceil($now->diffInSeconds($next)));

        return [
            'schemaVersion' => 1,
            'asOfAt' => $this->utc($now),
            'technicalGate' => $gate,
            'technicalBlocked' => $blocked,
            'activeLeaseState' => $lease?->state,
            'retryAfterSeconds' => $retry,
            'nextTechnicalStartAt' => $next === null ? null : $this->utc($next),
            'minimumStartIntervalSeconds' => $floor,
            'source' => 'server_backup_admission_v1',
            'scope' => 'advisory_only_not_backup_eligibility_or_verified_backup',
        ];
    }

    private function now(): CarbonImmutable
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            $row = DB::selectOne('SELECT clock_timestamp() AS db_now');
            return CarbonImmutable::parse($row->db_now)->utc();
        }

        return CarbonImmutable::now('UTC');
    }

    private function utc(CarbonImmutable $time): string
    {
        return $time->utc()->format('Y-m-d\TH:i:s\Z');
    }
}
