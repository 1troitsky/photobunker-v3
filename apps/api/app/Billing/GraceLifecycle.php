<?php
declare(strict_types=1);

namespace App\Billing;

use Carbon\CarbonImmutable;
use RuntimeException;
use Throwable;

/**
 * #226: read-only subscription/grace projection for an already VERIFIED
 * account-scoped EntitlementLedger snapshot.
 *
 * Does not confer paid rights, change immutable signed asset TTL, release
 * ciphertext, accept payments, or authorize physical deletion.
 * The caller MUST supply the same server UTC instant to current() and here.
 */
final class GraceLifecycle
{
    private static function utc(?string $value): ?CarbonImmutable
    {
        if ($value === null) {
            return null;
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/D', $value)) {
            throw new RuntimeException('billing.lifecycle_invalid_timestamp');
        }
        try {
            $date = CarbonImmutable::parse($value, 'UTC')->utc();
        } catch (Throwable) {
            throw new RuntimeException('billing.lifecycle_invalid_timestamp');
        }
        if ($date->format('Y-m-d\TH:i:s\Z') !== $value) {
            throw new RuntimeException('billing.lifecycle_invalid_timestamp');
        }
        return $date;
    }

    /**
     * @return array{
     *   schemaVersion:int,asOfAt:string,revision:int,planId:string,
     *   status:string,effectivePlanId:string,paidPrivilegesActive:bool,
     *   graceDays:?int,planEndsAt:?string,graceEndsAt:?string,
     *   nextDeadlineAt:?string,secondsUntilNextDeadline:?int,
     *   graceActive:bool,paidRightsDowngraded:bool,
     *   newWritesPolicy:string,existingMediaPolicy:string
     * }
     */
    public function describe(array $entitlement, CarbonImmutable $serverNow): array
    {
        $now = $serverNow->utc();
        $revision = $entitlement['revision'] ?? null;
        $hash = $entitlement['snapshotSha256'] ?? null;
        $plan = $entitlement['planId'] ?? null;
        $effectivePlan = $entitlement['effectivePlanId'] ?? null;
        $status = $entitlement['status'] ?? null;
        $paid = $entitlement['paidPrivilegesActive'] ?? null;
        $definition = $entitlement['definition'] ?? null;

        if (($entitlement['schemaVersion'] ?? null) !== 1
            || !is_int($revision) || $revision < 1
            || !is_string($hash) || !preg_match('/^[a-f0-9]{64}$/D', $hash)
            || !is_string($plan) || !in_array($plan,
                ['free', 'go', 'pro', 'unlimited', 'unlimited_plus'], true)
            || !is_string($effectivePlan)
            || !in_array($status, ['pending', 'active', 'grace', 'expired'], true)
            || !is_bool($paid)
            || !is_array($definition)
            || ($definition['planId'] ?? null) !== $plan
            || !is_array($definition['limits'] ?? null)
            || !array_key_exists('graceDays', $definition['limits'])) {
            throw new RuntimeException('billing.lifecycle_invalid_snapshot');
        }

        $graceDays = $definition['limits']['graceDays'];
        $starts = self::utc($entitlement['startsAt'] ?? null);
        $ends = self::utc($entitlement['endsAt'] ?? null);
        $graceEnds = self::utc($entitlement['graceEndsAt'] ?? null);
        if ($starts === null) {
            throw new RuntimeException('billing.lifecycle_invalid_snapshot');
        }

        if ($plan === 'free') {
            if ($graceDays !== null || $ends !== null || $graceEnds !== null) {
                throw new RuntimeException('billing.lifecycle_invalid_snapshot');
            }
        } else {
            if (!is_int($graceDays) || $graceDays < 1 || $graceDays > 365
                || $ends === null || $graceEnds === null
                || !$ends->greaterThan($starts)
                || !$graceEnds->equalTo($ends->addDays($graceDays))) {
                throw new RuntimeException('billing.lifecycle_invalid_snapshot');
            }
        }

        $computedStatus = $now->lessThan($starts) ? 'pending'
            : ($ends === null || $now->lessThan($ends) ? 'active'
                : ($graceEnds !== null && $now->lessThan($graceEnds)
                    ? 'grace' : 'expired'));
        $expectedEffective = $computedStatus === 'active' ? $plan : 'free';
        $expectedPaid = $computedStatus === 'active' && $plan !== 'free';
        if ($computedStatus !== $status || $effectivePlan !== $expectedEffective
            || $paid !== $expectedPaid) {
            throw new RuntimeException('billing.lifecycle_state_mismatch');
        }

        // Informational deadline only. The signed file/assignment TTL and
        // current ACL still independently govern existing ciphertext.
        $next = $status === 'active' ? $ends
            : ($status === 'grace' ? $graceEnds : null);
        $seconds = $next === null
            ? null : max(0, $next->getTimestamp() - $now->getTimestamp());

        return [
            'schemaVersion' => 1,
            'asOfAt' => $now->format('Y-m-d\TH:i:s\Z'),
            'revision' => $revision,
            'planId' => $plan,
            'status' => $status,
            'effectivePlanId' => $effectivePlan,
            'paidPrivilegesActive' => $paid,
            'graceDays' => $graceDays,
            'planEndsAt' => $entitlement['endsAt'] ?? null,
            'graceEndsAt' => $entitlement['graceEndsAt'] ?? null,
            'nextDeadlineAt' => $next?->format('Y-m-d\TH:i:s\Z'),
            'secondsUntilNextDeadline' => $seconds,
            'graceActive' => $status === 'grace',
            'paidRightsDowngraded' => $plan !== 'free' && $status !== 'active',
            'newWritesPolicy' => 'effective_entitlement_and_server_quotas',
            'existingMediaPolicy' => 'immutable_signed_ttl_and_current_acl',
        ];
    }
}
