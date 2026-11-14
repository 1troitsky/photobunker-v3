<?php
declare(strict_types=1);

namespace App\Administration\Grants;

use App\Administration\AdminAuditLedger;
use App\Administration\AdminPolicy;
use App\Administration\AdminPrincipal;
use App\Billing\EntitlementLedger;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Support\Facades\DB;

/**
 * Transactional INTERNAL action: audit and immutable account entitlement
 * advance succeed together, or neither is committed.
 *
 * IMPORTANT: AdminPrincipal MUST be constructed only by a separate server
 * authenticator which proves operator role, expiry and fresh step-up MFA.
 * This class does NOT mint principals or expose a network route. Do not mount
 * a controller before a verified admin-auth boundary exists.
 *
 * No Recovery Keys, media, plaintext, token, IP address or freeform reasons.
 */
final class AdminTrialGrantExecutor
{
    private const OPERATIONS = 'admin_trial_grant_operations_v1';
    private const PLANS = ['go', 'pro', 'unlimited', 'unlimited_plus'];
    private const REASONS = ['trial_access', 'approved_compensation', 'partner_pilot'];
    private const UUID = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/D';
    private const MAX_AGE_SECONDS = 300;
    private const MAX_DURATION_SECONDS = 364 * 86400;

    public function __construct(
        private readonly AdminAuditLedger $audit,
        private readonly EntitlementLedger $entitlements,
    ) {}

    /**
     * @return array{state:string,operationId:string,revision:int,replay:bool,auditDigest:string,eventHash:string}
     */
    public function issueTrusted(
        AdminPrincipal $trustedActor,
        string $operationId,
        string $targetAccountId,
        string $planId,
        int $expectedRevision,
        string $reasonCode,
        CarbonImmutable $startsAt,
        CarbonImmutable $endsAt,
    ): array {
        $now = CarbonImmutable::now('UTC');
        $nowMs = $now->getTimestampMs();
        // Re-assert the narrow permission at the actual server clock, including
        // on Lost ACK replay. The audit ledger repeats it under the row lock.
        AdminPolicy::requireAllowed($trustedActor, 'grants.issue', $nowMs);
        $startsAt = $startsAt->utc();
        $endsAt = $endsAt->utc();
        if (preg_match(self::UUID, $operationId) !== 1
            || preg_match(self::UUID, $targetAccountId) !== 1
            || !in_array($planId, self::PLANS, true)
            || !in_array($reasonCode, self::REASONS, true)
            || $expectedRevision < 1
            || $startsAt->format('u') !== '000000'
            || $endsAt->format('u') !== '000000'
            || $startsAt->greaterThan($now)
            || $startsAt->lessThan($now->subSeconds(self::MAX_AGE_SECONDS))
            || !$endsAt->greaterThan($now)
            || !$endsAt->greaterThan($startsAt)
            || $endsAt->diffInSeconds($now, absolute: true) > self::MAX_DURATION_SECONDS) {
            throw new DomainException('admin.trial_invalid');
        }

        $starts = $startsAt->format('Y-m-d\TH:i:s\Z');
        $ends = $endsAt->format('Y-m-d\TH:i:s\Z');
        $intent = [
            'domain' => 'pb3.admin.trial-grant.v1',
            'operationId' => $operationId,
            'actorId' => $trustedActor->accountId,
            'targetAccountId' => $targetAccountId,
            'planId' => $planId,
            'expectedRevision' => $expectedRevision,
            'reasonCode' => $reasonCode,
            'startsAt' => $starts,
            'endsAt' => $ends,
        ];
        $intentHash = hash('sha256',
            json_encode($intent, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));

        return DB::transaction(function () use (
            $trustedActor, $operationId, $targetAccountId, $planId,
            $expectedRevision, $reasonCode, $startsAt, $endsAt, $intentHash,
        ): array {
            // This serializes the global audit head first. An operation
            // collision is checked AFTER acquiring that same transaction lock,
            // preventing two parallel writers from both seeing "no receipt".
            // Nothing is committed if the billing CAS rejects.
            $audit = $this->audit->record(
                $trustedActor, $operationId, 'grants.issue', 'account',
                $targetAccountId, $reasonCode, $endsAt->getTimestampMs(),
            );
            if ($audit['state'] !== 'recorded_only') {
                throw new DomainException('admin.audit_denied');
            }
            $auditDigest = $audit['digest'];
            $eventHash = hash('sha256', "pb3.admin.approved-entitlement.v1\n"
                .$intentHash."\n".$auditDigest);

            $existing = DB::table(self::OPERATIONS)
                ->where('operation_id', $operationId)->lockForUpdate()->first();
            if ($existing !== null
                && (!is_string($existing->intent_hash)
                    || !hash_equals($existing->intent_hash, $intentHash)
                    || !hash_equals((string) $existing->audit_digest, $auditDigest)
                    || !hash_equals((string) $existing->verified_event_hash, $eventHash)
                    || $existing->actor_id !== $trustedActor->accountId
                    || $existing->account_id !== $targetAccountId)) {
                throw new DomainException('admin.trial_conflicting_replay');
            }

            $entitlement = $this->entitlements->advanceTrusted(
                $targetAccountId, $planId, $expectedRevision,
                $eventHash, 'admin_mfa_approved', $startsAt, $endsAt,
            );
            if ($existing === null) {
                if ($entitlement['unchanged'] !== false
                    || $entitlement['revision'] !== $expectedRevision + 1) {
                    throw new DomainException('admin.trial_inconsistent');
                }
                DB::table(self::OPERATIONS)->insert([
                    'operation_id' => $operationId,
                    'actor_id' => $trustedActor->accountId,
                    'account_id' => $targetAccountId,
                    'plan_id' => $planId,
                    'expected_revision' => $expectedRevision,
                    'reason_code' => $reasonCode,
                    'starts_at' => $startsAt,
                    'expires_at' => $endsAt,
                    'intent_hash' => $intentHash,
                    'audit_digest' => $auditDigest,
                    'verified_event_hash' => $eventHash,
                    'entitlement_revision' => $entitlement['revision'],
                    'created_at' => now(),
                ]);
            } elseif ($entitlement['unchanged'] !== true
                || $entitlement['revision'] !== (int) $existing->entitlement_revision) {
                throw new DomainException('admin.trial_inconsistent');
            }
            return [
                'state' => 'internal_trial_grant_recorded',
                'operationId' => $operationId,
                'revision' => $entitlement['revision'],
                'replay' => $existing !== null,
                'auditDigest' => $auditDigest,
                'eventHash' => $eventHash,
            ];
        }, 3);
    }
}
