<?php
declare(strict_types=1);

namespace App\Administration\Restrictions;

use App\Administration\AdminAuditLedger;
use App\Administration\AdminPolicy;
use App\Administration\AdminPrincipal;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Support\Facades\DB;

/**
 * INTERNAL / NO ROUTE: reversible *temporary account RESTRICTION* only.
 *
 * This is NOT an admin authenticator. A trustworthy server-side principal
 * with independently verified role and step-up MFA must be supplied.
 *
 * Lock order ALWAYS: #227 global AdminAuditLedger head -> identity_accounts
 * row -> #228 per-target policy head, matching audited billing grants.
 * The outer DB transaction commits the audit and policy event together or
 * rolls back both. No device/release alias is permitted: #227 currently
 * lacks reversible audit action mappings for those operations.
 *
 * Neither global nor per-target SHA chain is externally tamper-proof.
 */
final class AuditedAccountRestrictionExecutor
{
    private const UUID = '/\A[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\z/D';
    private const REASONS = [
        'abuse_report', 'verified_security_incident', 'policy_violation',
    ];
    private const MAX_DURATION_SECONDS = 90 * 86400;

    public function __construct(
        private readonly AdminAuditLedger $audit,
        private readonly TemporaryRestrictionLedger $restrictions,
    ) {}

    /**
     * The restriction expires naturally at SERVER time, even if offline.
     * It does not revoke devices, disable sessions, or expose a public API.
     *
     * @return array{state:string,operationId:string,revision:int,replay:bool,auditDigest:string}
     */
    public function restrictTrusted(
        AdminPrincipal $trustedActor,
        string $operationId,
        string $accountId,
        int $expectedRestrictionRevision,
        string $reasonCode,
        CarbonImmutable $expiresAt,
    ): array {
        $now = CarbonImmutable::now('UTC');
        AdminPolicy::requireAllowed($trustedActor, 'accounts.suspend', $now->getTimestampMs());
        $expires = $expiresAt->utc();
        if (preg_match(self::UUID, $operationId) !== 1
            || preg_match(self::UUID, $accountId) !== 1
            || $expectedRestrictionRevision < 0
            || !in_array($reasonCode, self::REASONS, true)
            || $expires->format('u') !== '000000'
            || !$expires->greaterThan($now)
            || $expires->diffInSeconds($now, absolute: true) > self::MAX_DURATION_SECONDS) {
            throw new DomainException('admin.account_restriction_invalid');
        }

        return DB::transaction(function () use (
            $trustedActor, $operationId, $accountId, $expectedRestrictionRevision,
            $reasonCode, $expires,
        ): array {
            // Atomic / consistent lock order: the global audit head comes
            // BEFORE any account row or per-target restriction head.
            // The audit code rechecks MFA at the actual current server time
            // after waiting on its GLOBAL head.
            $audit = $this->audit->record(
                $trustedActor, $operationId, 'accounts.suspend', 'account',
                $accountId, $reasonCode, $expires->getTimestampMs(),
            );
            if ($audit['state'] !== 'recorded_only') {
                throw new DomainException('admin.account_restriction_inconsistent');
            }

            // Locks account and rechecks MFA AGAIN after any account lock
            // wait. Old revision or unready identity rolls BACK the global
            // audit event, leaving no speculative or unpaired history.
            $restriction = $this->restrictions->changeTrusted(
                $trustedActor, $operationId, $accountId, 'account', $accountId,
                'restrict', $expectedRestrictionRevision, $reasonCode, $expires,
            );
            if ($restriction['state'] !== 'internal_restriction_event_recorded'
                || $audit['replay'] !== $restriction['replay']) {
                // A pre-existing standalone global audit OR per-target event
                // must not silently authorize / pair a different operation.
                throw new DomainException('admin.account_restriction_inconsistent');
            }

            return [
                'state' => 'internal_audited_account_restriction_recorded',
                'operationId' => $operationId,
                'revision' => $restriction['revision'],
                'replay' => $restriction['replay'],
                'auditDigest' => $audit['digest'],
            ];
        }, 3);
    }
}
