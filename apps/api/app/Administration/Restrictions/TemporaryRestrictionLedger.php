<?php
declare(strict_types=1);

namespace App\Administration\Restrictions;

use App\Administration\AdminPolicy;
use App\Administration\AdminPrincipal;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * #228 INTERNAL policy-state and privacy-minimized event ledger. It does NOT
 * authenticate the operator/customer, route requests or revoke device keys.
 *
 * - Restrict and release are separate audited actions with revision CAS.
 * - Effective restriction expires at SERVER time even without a worker.
 * - Account row locks serialize both account and device restrictions.
 * - The SHA chain is DB consistency evidence, NOT external tamper-evidence.
 *
 * Do not expose this class through an API until authenticated actor/session
 * admission, step-up MFA, CSRF and account/device policy scopes are integrated.
 */
final class TemporaryRestrictionLedger
{
    private const HEAD = 'admin_temporary_restriction_heads_v1';
    private const EVENTS = 'admin_temporary_restriction_events_v1';
    private const ZERO_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
    private const UUID = '/\A[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\z/D';
    private const MAX_ACCOUNT_SECONDS = 90 * 86400;
    private const MAX_DEVICE_SECONDS = 30 * 86400;

    private static function require(bool $condition, string $error): void
    {
        if (!$condition) {
            throw new DomainException('admin.restriction_'.$error);
        }
    }

    private static function utc(CarbonImmutable $date): string
    {
        return $date->utc()->format('Y-m-d\TH:i:s\Z');
    }

    private static function parsed(mixed $stored): ?string
    {
        if ($stored === null) {
            return null;
        }
        self::require(is_string($stored) && trim($stored) !== '', 'corrupt');
        try {
            return self::utc(CarbonImmutable::parse($stored, 'UTC'));
        } catch (Throwable) {
            throw new DomainException('admin.restriction_corrupt');
        }
    }

    private static function requestHash(
        string $operationId, string $actorId, string $accountId,
        string $targetType, string $targetId, string $action,
        int $expectedRevision, string $reasonCode, ?string $expiresAt,
    ): string {
        return hash('sha256', json_encode([
            'domain' => 'pb3.admin.temporary-restriction-request.v1',
            'operationId' => $operationId,
            'actorId' => $actorId,
            'accountId' => $accountId,
            'targetType' => $targetType,
            'targetId' => $targetId,
            'action' => $action,
            'expectedRevision' => $expectedRevision,
            'reasonCode' => $reasonCode,
            'expiresAt' => $expiresAt,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    private static function eventHash(
        string $operationId, string $actorId, string $accountId,
        string $targetType, string $targetId, string $action,
        int $expectedRevision, int $revision, string $reasonCode,
        ?string $expiresAt, string $requestHash, string $previousHash,
        string $recordedAt,
    ): string {
        return hash('sha256', json_encode([
            'domain' => 'pb3.admin.temporary-restriction-event.v1',
            'operationId' => $operationId,
            'actorId' => $actorId,
            'accountId' => $accountId,
            'targetType' => $targetType,
            'targetId' => $targetId,
            'action' => $action,
            'expectedRevision' => $expectedRevision,
            'revision' => $revision,
            'reasonCode' => $reasonCode,
            'expiresAt' => $expiresAt,
            'requestHash' => $requestHash,
            'previousHash' => $previousHash,
            'recordedAt' => $recordedAt,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    private static function verifyEvent(object $event): void
    {
        self::require(in_array($event->target_type, ['account', 'device'], true)
            && in_array($event->action, ['restrict', 'release'], true)
            && preg_match(self::UUID, (string) $event->operation_id) === 1
            && preg_match(self::UUID, (string) $event->account_id) === 1
            && preg_match(self::UUID, (string) $event->target_id) === 1
            && preg_match(self::UUID, (string) $event->actor_id) === 1
            && (int) $event->revision === (int) $event->expected_revision + 1
            && preg_match('/\A[0-9a-f]{64}\z/D', (string) $event->request_hash) === 1
            && preg_match('/\A[0-9a-f]{64}\z/D', (string) $event->previous_hash) === 1
            && preg_match('/\A[0-9a-f]{64}\z/D', (string) $event->event_hash) === 1,
            'corrupt');

        $expires = self::parsed($event->expires_at);
        self::require(($event->action === 'restrict') === ($expires !== null), 'corrupt');
        $actual = self::eventHash(
            (string) $event->operation_id, (string) $event->actor_id,
            (string) $event->account_id, (string) $event->target_type,
            (string) $event->target_id, (string) $event->action,
            (int) $event->expected_revision, (int) $event->revision,
            (string) $event->reason_code, $expires,
            (string) $event->request_hash, (string) $event->previous_hash,
            self::parsed($event->recorded_at) ?? '',
        );
        self::require(hash_equals((string) $event->event_hash, $actual), 'corrupt');
    }

    /**
     * Verify current head and its direct preceding event. This is database
     * consistency checking, NOT resistance to privileged whole-DB rewrites.
     */
    private static function last(string $accountId, string $type, string $id): ?object
    {
        $head = DB::table(self::HEAD)->where('target_type', $type)
            ->where('target_id', $id)->first();
        if ($head === null) {
            self::require(!DB::table(self::EVENTS)->where('target_type', $type)
                ->where('target_id', $id)->exists(), 'missing_head');
            return null;
        }
        self::require($head->account_id === $accountId
            && is_numeric($head->revision)
            && (int) $head->revision >= 1, 'corrupt');
        $event = DB::table(self::EVENTS)->where('operation_id', $head->last_operation_id)->first();
        self::require($event !== null, 'corrupt');
        self::verifyEvent($event);
        self::require($event->account_id === $accountId
            && $event->target_type === $type
            && $event->target_id === $id
            && (int) $event->revision === (int) $head->revision
            && hash_equals((string) $head->last_event_hash, (string) $event->event_hash), 'corrupt');

        if ((int) $head->revision === 1) {
            self::require(hash_equals(self::ZERO_HASH, (string) $event->previous_hash), 'corrupt');
        } else {
            $previous = DB::table(self::EVENTS)
                ->where('target_type', $type)->where('target_id', $id)
                ->where('revision', (int) $head->revision - 1)->first();
            self::require($previous !== null, 'corrupt');
            self::verifyEvent($previous);
            self::require($previous->account_id === $accountId
                && hash_equals((string) $previous->event_hash,
                    (string) $event->previous_hash), 'corrupt');
        }
        return $event;
    }

    private static function active(?object $latest, CarbonImmutable $at): bool
    {
        return $latest !== null && $latest->action === 'restrict'
            && $at->lessThan(CarbonImmutable::parse($latest->expires_at, 'UTC'));
    }

    /**
     * @return array{state:string,operationId:string,revision:int,replay:bool}
     */
    public function changeTrusted(
        AdminPrincipal $trustedActor, string $operationId, string $accountId,
        string $targetType, string $targetId, string $action,
        int $expectedRevision, string $reasonCode, ?CarbonImmutable $expiresAt,
    ): array {
        // Never round authorization time: an actor expiring mid-second must
        // not gain up to another second of privileged access.
        $now = CarbonImmutable::now('UTC');
        $recordedAt = $now->startOfSecond();
        $permission = match ($targetType) {
            'account' => 'accounts.suspend',
            'device' => 'devices.revoke',
            default => throw new DomainException('admin.restriction_invalid'),
        };
        AdminPolicy::requireAllowed($trustedActor, $permission, $now->getTimestampMs());
        $expiresAt = $expiresAt?->utc();
        self::require(preg_match(self::UUID, $operationId) === 1
            && preg_match(self::UUID, $accountId) === 1
            && preg_match(self::UUID, $targetId) === 1
            && $expectedRevision >= 0
            && ($targetType !== 'account' || $targetId === $accountId)
            && in_array($action, ['restrict', 'release'], true)
            && ($action === 'restrict'
                ? in_array($reasonCode, ['abuse_report','verified_security_incident',
                    'policy_violation'], true)
                : in_array($reasonCode, ['appeal_accepted','false_positive',
                    'manual_resolution'], true)),
            'invalid');

        if ($action === 'restrict') {
            $max = $targetType === 'account'
                ? self::MAX_ACCOUNT_SECONDS : self::MAX_DEVICE_SECONDS;
            self::require($expiresAt !== null
                && $expiresAt->format('u') === '000000'
                && $expiresAt->greaterThan($now)
                && $expiresAt->diffInSeconds($now, absolute: true) <= $max,
                'invalid_expiry');
        } else {
            self::require($expiresAt === null, 'invalid_expiry');
        }
        $expires = $expiresAt === null ? null : self::utc($expiresAt);
        $requestHash = self::requestHash($operationId, $trustedActor->accountId,
            $accountId, $targetType, $targetId, $action, $expectedRevision,
            $reasonCode, $expires);

        return DB::transaction(function () use (
            $trustedActor, $operationId, $accountId, $targetType, $targetId,
            $action, $expectedRevision, $reasonCode, $expiresAt, $expires,
            $requestHash, $now, $recordedAt,
        ): array {
            // Locks an EXISTING account row, even when the per-target head
            // has not been created yet. Two first writers cannot both insert.
            $account = DB::table('identity_accounts')->where('id', $accountId)
                ->lockForUpdate()->first();
            // Step-up/MFA may expire WHILE waiting for the row lock. Check at
            // the actual current millisecond again inside the transaction.
            AdminPolicy::requireAllowed($trustedActor,
                $targetType === 'account' ? 'accounts.suspend' : 'devices.revoke',
                CarbonImmutable::now('UTC')->getTimestampMs());
            self::require($account !== null && $account->status === 'ready', 'target_unavailable');
            if ($targetType === 'device') {
                $device = DB::table('identity_devices')
                    ->where('id', $targetId)->lockForUpdate()->first();
                self::require($device !== null && $device->account_id === $accountId
                    && $device->revoked_at === null, 'target_unavailable');
            }

            // Exact replay is allowed only with a CURRENT, still-valid actor
            // and byte-identical intent; it NEVER mutates a newer head.
            $existing = DB::table(self::EVENTS)
                ->where('operation_id', $operationId)->first();
            if ($existing !== null) {
                self::verifyEvent($existing);
                self::require(hash_equals((string) $existing->request_hash, $requestHash),
                    'conflicting_replay');
                // An old replay is evidence of the historical operation only;
                // do not imply the target is still restricted/unrestricted.
                return [
                    'state' => 'internal_restriction_event_recorded',
                    'operationId' => $operationId,
                    'revision' => (int) $existing->revision,
                    'replay' => true,
                ];
            }

            $head = DB::table(self::HEAD)
                ->where('target_type', $targetType)
                ->where('target_id', $targetId)->lockForUpdate()->first();
            $latest = self::last($accountId, $targetType, $targetId);
            $revision = $head === null ? 0 : (int) $head->revision;
            self::require($revision === $expectedRevision, 'revision_conflict');
            $active = self::active($latest, $now);
            self::require($action === 'restrict' ? !$active : $active,
                $action === 'restrict' ? 'already_active' : 'not_active');

            $previousHash = $head === null
                ? self::ZERO_HASH : (string) $head->last_event_hash;
            $nextRevision = $revision + 1;
            $eventHash = self::eventHash(
                $operationId, $trustedActor->accountId, $accountId,
                $targetType, $targetId, $action, $expectedRevision, $nextRevision,
                $reasonCode, $expires, $requestHash, $previousHash,
                self::utc($recordedAt),
            );
            DB::table(self::EVENTS)->insert([
                'operation_id' => $operationId,
                'actor_id' => $trustedActor->accountId,
                'account_id' => $accountId,
                'target_type' => $targetType,
                'target_id' => $targetId,
                'action' => $action,
                'reason_code' => $reasonCode,
                'expected_revision' => $expectedRevision,
                'revision' => $nextRevision,
                'expires_at' => $expiresAt,
                'request_hash' => $requestHash,
                'previous_hash' => $previousHash,
                'event_hash' => $eventHash,
                'recorded_at' => $recordedAt,
            ]);
            if ($head === null) {
                DB::table(self::HEAD)->insert([
                    'target_type' => $targetType,
                    'target_id' => $targetId,
                    'account_id' => $accountId,
                    'revision' => $nextRevision,
                    'last_operation_id' => $operationId,
                    'last_event_hash' => $eventHash,
                ]);
            } else {
                $updated = DB::table(self::HEAD)
                    ->where('target_type', $targetType)
                    ->where('target_id', $targetId)
                    ->where('revision', $expectedRevision)
                    ->where('last_event_hash', $previousHash)
                    ->update([
                        'revision' => $nextRevision,
                        'last_operation_id' => $operationId,
                        'last_event_hash' => $eventHash,
                    ]);
                self::require($updated === 1, 'revision_conflict');
            }
            return [
                'state' => 'internal_restriction_event_recorded',
                'operationId' => $operationId,
                'revision' => $nextRevision,
                'replay' => false,
            ];
        }, 3);
    }

    /**
     * Internal READ-ONLY restriction admission; identity and session must be
     * independently verified first. A successful return is NOT login proof.
     * Does not refresh or unblock anything and never reads E2EE payload.
     */
    public function assertNotRestrictedForTrustedSession(
        string $accountId, string $deviceId, ?CarbonImmutable $at = null,
    ): void {
        self::require(preg_match(self::UUID, $accountId) === 1
            && preg_match(self::UUID, $deviceId) === 1, 'invalid');
        $at = ($at ?? CarbonImmutable::now('UTC'))->utc();

        // Shared account lock prevents a concurrent admin writer from
        // committing a restriction between the two policy reads. When this
        // runs inside an outer protected operation transaction, that outer
        // transaction keeps the lock until its own commit.
        DB::transaction(static function () use ($accountId, $deviceId, $at): void {
            $account = DB::table('identity_accounts')
                ->where('id', $accountId)->sharedLock()->first();
            self::require($account !== null && $account->status === 'ready',
                'target_unavailable');
            $device = DB::table('identity_devices')
                ->where('id', $deviceId)->sharedLock()->first();
            self::require($device !== null && $device->account_id === $accountId
                && $device->revoked_at === null, 'target_unavailable');

            $accountEvent = self::last($accountId, 'account', $accountId);
            $deviceEvent = self::last($accountId, 'device', $deviceId);
            self::require(!self::active($accountEvent, $at)
                && !self::active($deviceEvent, $at), 'access_denied');
        }, 3);
    }
}
