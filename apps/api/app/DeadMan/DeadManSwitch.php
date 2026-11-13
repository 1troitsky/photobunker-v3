<?php
declare(strict_types=1);

namespace App\DeadMan;

use App\Identity\Protocol;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Durable, NON-DESTRUCTIVE Dead Man's Switch.
 *
 * Entry points are internal domain services, NOT public API authorization.
 * Callers must additionally establish authenticated same-origin session/CSRF.
 * Each configure/check-in needs a genuine P-256 signature from an unrevoked
 * device bound to a ready account; a browser timestamp is never trusted.
 *
 * This service NEVER deletes live media, changes Recovery Vault, revokes a
 * device, sends alerts or starts Panic. The only expiry state is expired_review,
 * pending a separately approved product policy and independent security QA.
 */
final class DeadManSwitch
{
    private const SWITCHES = 'dead_man_switches_v1';
    private const OPERATIONS = 'dead_man_operations_v1';
    private const PURPOSE = "pb3.dead-man-switch.v1\n";
    private const PERIODS = [0, 4, 6, 12, 24];
    private const WARNING_DAYS = 30; // provisional, never a client-controlled delay
    private const UUID = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/D';

    /**
     * @param array<string,mixed> $payload Exactly:
     *  version=1, kind=configure|checkin, accountId, deviceId, operationId,
     *  expectedRevision, months (configure: 0|4|6|12|24; checkin: null).
     * @return array{accountId:string,operationId:string,revision:int,state:string,
     *               deadlineAt:?string,idempotent:bool}
     */
    public function applySigned(array $payload, string $signatureP1363): array
    {
        $this->validatePayload($payload);
        $message = self::PURPOSE.$this->canonical($payload);
        $digest = hash('sha256', $message);

        return DB::transaction(function () use ($payload, $signatureP1363, $message, $digest): array {
            // Serializes commands with other processes and the scheduler.
            // PostgreSQL row locks are authoritative; SQLite tests are not
            // a concurrency proof.
            $account = DB::table('identity_accounts')
                ->where('id', $payload['accountId'])
                ->lockForUpdate()->first(['id','status']);
            if ($account === null || $account->status !== 'ready') {
                $this->deny();
            }
            $device = DB::table('identity_devices')
                ->where('id', $payload['deviceId'])
                ->where('account_id', $payload['accountId'])
                ->whereNull('revoked_at')
                ->first(['id','signing_spki']);
            if ($device === null) {
                $this->deny();
            }
            try {
                if (!Protocol::verify($device->signing_spki, $message, $signatureP1363)) {
                    $this->deny();
                }
            } catch (\Throwable) {
                $this->deny();
            }

            // Replays may return their original acknowledgement only after
            // fresh device/account authentication. Never execute again.
            $prior = DB::table(self::OPERATIONS)
                ->where('operation_id', $payload['operationId'])->first();
            if ($prior !== null) {
                if ($prior->account_id !== $payload['accountId']
                    || $prior->device_id !== $payload['deviceId']
                    || !hash_equals($prior->payload_hash, $digest)) {
                    $this->deny();
                }
                return $this->receipt(
                    $payload['accountId'], $payload['operationId'],
                    (int)$prior->result_revision, $prior->result_state,
                    $prior->result_deadline_at, true,
                );
            }

            $switch = DB::table(self::SWITCHES)
                ->where('account_id', $payload['accountId'])
                ->lockForUpdate()->first();
            $revision = $switch === null ? 0 : (int) $switch->revision;
            if ($revision !== $payload['expectedRevision'] || $revision === PHP_INT_MAX) {
                $this->deny();
            }
            if ($payload['kind'] === 'checkin' &&
                ($switch === null || (int)$switch->months === 0 || $switch->state === 'disabled')) {
                $this->deny();
            }

            $now = $this->clock();
            $months = $payload['kind'] === 'configure'
                ? $payload['months'] : (int) $switch->months;
            $enabled = $months !== 0;
            $newRevision = $revision + 1;
            $deadline = $enabled ? $now->addMonthsNoOverflow($months) : null;
            $values = [
                'months' => $months,
                'state' => $enabled ? 'armed' : 'disabled',
                'revision' => $newRevision,
                'last_confirmed_at' => $enabled ? $now : null,
                'warning_at' => $deadline?->subDays(self::WARNING_DAYS),
                'warned_at' => null,
                'deadline_at' => $deadline,
                'expired_review_at' => null,
                'updated_at' => $now,
            ];
            if ($switch === null) {
                DB::table(self::SWITCHES)->insert([
                    'account_id' => $payload['accountId'],
                    'created_at' => $now,
                ] + $values);
            } else {
                DB::table(self::SWITCHES)
                    ->where('account_id', $payload['accountId'])->update($values);
            }

            DB::table(self::OPERATIONS)->insert([
                'operation_id' => $payload['operationId'],
                'account_id' => $payload['accountId'],
                'device_id' => $payload['deviceId'],
                'payload_hash' => $digest,
                'kind' => $payload['kind'],
                'result_revision' => $newRevision,
                'result_state' => $values['state'],
                'result_deadline_at' => $deadline,
                'accepted_at' => $now,
            ]);

            return $this->receipt(
                $payload['accountId'], $payload['operationId'],
                $newRevision, $values['state'], $deadline, false,
            );
        }, 3);
    }

    /**
     * Called by a future authenticated scheduler, not by a browser request.
     * Idempotently records due warnings/expiration; does NOT dispatch push or
     * run any irreversible action. A check-in racing with sweep always wins
     * safely under the same identity account FOR UPDATE lock.
     *
     * @return array{warning:int,expiredReview:int}
     */
    public function sweepDue(int $batchSize = 100): array
    {
        if ($batchSize < 1 || $batchSize > 500) {
            $this->deny();
        }

        $candidateNow = $this->clock();
        $ids = DB::table(self::SWITCHES)
            ->whereIn('state', ['armed', 'warning'])
            ->where('warning_at', '<=', $candidateNow)
            ->orderBy('warning_at')->limit($batchSize)
            ->pluck('account_id');

        $warning = 0;
        $expiredReview = 0;
        foreach ($ids as $accountId) {
            $result = DB::transaction(function () use ($accountId): string {
                $account = DB::table('identity_accounts')
                    ->where('id', $accountId)->lockForUpdate()->first(['id','status']);
                if ($account === null || $account->status !== 'ready') {
                    return 'none';
                }
                $switch = DB::table(self::SWITCHES)
                    ->where('account_id', $accountId)->lockForUpdate()->first();
                if ($switch === null || (int)$switch->months === 0
                    || !in_array($switch->state, ['armed','warning'],true)
                    || $switch->deadline_at === null || $switch->warning_at === null) {
                    return 'none';
                }
                $now = $this->clock();
                if ($now->greaterThanOrEqualTo(CarbonImmutable::parse($switch->deadline_at))) {
                    DB::table(self::SWITCHES)->where('account_id',$accountId)
                        ->whereIn('state',['armed','warning'])
                        ->update([
                            'state'=>'expired_review',
                            'expired_review_at'=>$now,
                            'updated_at'=>$now,
                        ]);
                    return 'expiredReview';
                }
                if ($switch->state === 'armed'
                    && $now->greaterThanOrEqualTo(CarbonImmutable::parse($switch->warning_at))) {
                    DB::table(self::SWITCHES)->where('account_id',$accountId)
                        ->where('state','armed')->update([
                            'state'=>'warning',
                            'warned_at'=>$now,
                            'updated_at'=>$now,
                        ]);
                    return 'warning';
                }

                return 'none';
            }, 3);
            if ($result === 'warning') $warning++;
            if ($result === 'expiredReview') $expiredReview++;
        }
        return compact('warning', 'expiredReview');
    }

    private function receipt(
        string $accountId, string $operationId, int $revision,
        string $state, mixed $deadline, bool $idempotent
    ): array {
        return [
            'accountId'=>$accountId,
            'operationId'=>$operationId,
            'revision'=>$revision,
            'state'=>$state,
            'deadlineAt'=>$deadline === null ? null
                : CarbonImmutable::parse($deadline)->utc()->toIso8601String(),
            'idempotent'=>$idempotent,
        ];
    }

    private function clock(): CarbonImmutable
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            return CarbonImmutable::parse(DB::selectOne('SELECT clock_timestamp() AS db_now')->db_now);
        }
        return CarbonImmutable::now('UTC');
    }

    private function validatePayload(array $payload): void
    {
        $keys = array_keys($payload);
        sort($keys,SORT_STRING);
        if ($keys !== [
            'accountId','deviceId','expectedRevision','kind',
            'months','operationId','version',
        ] || ($payload['version'] ?? null) !== 1
            || !in_array($payload['kind'],['configure','checkin'],true)
            || !$this->uuid($payload['accountId'])
            || !$this->uuid($payload['deviceId'])
            || !$this->uuid($payload['operationId'])
            || !is_int($payload['expectedRevision'])
            || $payload['expectedRevision'] < 0
            || $payload['expectedRevision'] >= 4294967295
            || ($payload['kind'] === 'configure'
                ? !in_array($payload['months'],self::PERIODS,true)
                : $payload['months'] !== null)) {
            $this->deny();
        }
    }

    private function uuid(mixed $value): bool
    {
        return is_string($value) && preg_match(self::UUID, $value) === 1;
    }

    private function canonical(array $payload): string
    {
        ksort($payload,SORT_STRING);
        return json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function deny(): never
    {
        // Generic outward failure: no account/device/expiry existence oracle.
        throw new \DomainException('deadman.operation_denied');
    }
}
