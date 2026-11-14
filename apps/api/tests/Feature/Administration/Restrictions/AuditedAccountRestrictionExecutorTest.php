<?php
declare(strict_types=1);

namespace Tests\Feature\Administration\Restrictions;

use App\Administration\AdminAuditLedger;
use App\Administration\AdminPrincipal;
use App\Administration\Grants\AdminTrialGrantExecutor;
use App\Administration\Restrictions\AuditedAccountRestrictionExecutor;
use App\Administration\Restrictions\TemporaryRestrictionLedger;
use App\Billing\EntitlementLedger;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AuditedAccountRestrictionExecutorTest extends TestCase
{
    use RefreshDatabase;

    private string $actorId;
    private string $accountId;
    private string $deviceId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actorId = $this->account();
        $this->accountId = $this->account();
        $this->deviceId = (string) Str::uuid();
        DB::table('identity_devices')->insert([
            'id' => $this->deviceId,
            'account_id' => $this->accountId,
            'signing_spki' => 'fixture-only-no-secret',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function account(): string
    {
        $id = (string) Str::uuid();
        DB::table('identity_accounts')->insert([
            'id' => $id,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'reserved_until' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $id;
    }

    private function actor(
        string $role = 'operator', ?int $mfaAt = null, ?int $expiresAt = null,
    ): AdminPrincipal {
        $now = CarbonImmutable::now('UTC')->getTimestampMs();
        return new AdminPrincipal(
            $this->actorId, $role,
            $expiresAt ?? $now + 3600000,
            $mfaAt ?? $now - 1000,
        );
    }

    private function deadline(int $days = 6): CarbonImmutable
    {
        return CarbonImmutable::now('UTC')->addDays($days)->startOfSecond();
    }

    private function execute(
        ?string $op = null, int $revision = 0,
        ?string $reason = null, ?CarbonImmutable $until = null,
        ?AdminPrincipal $actor = null, ?string $target = null,
    ): array {
        return app(AuditedAccountRestrictionExecutor::class)->restrictTrusted(
            $actor ?? $this->actor(),
            $op ?? (string) Str::uuid(),
            $target ?? $this->accountId,
            $revision,
            $reason ?? 'abuse_report',
            $until ?? $this->deadline(),
        );
    }

    private function deny(callable $fn, string $message): void
    {
        try {
            $fn();
            self::fail('Fail-open account audit restriction');
        } catch (DomainException $e) {
            self::assertSame($message, $e->getMessage());
        }
    }

    public function test_real_global_and_target_audit_commit_as_one_and_deny_admission(): void
    {
        $operation = (string) Str::uuid();
        $until = $this->deadline();
        $result = $this->execute($operation, until: $until);
        self::assertSame('internal_audited_account_restriction_recorded', $result['state']);
        self::assertSame($operation, $result['operationId']);
        self::assertSame(1, $result['revision']);
        self::assertFalse($result['replay']);
        self::assertSame(1, app(AdminAuditLedger::class)->verifyChain()['count']);
        $this->assertDatabaseCount('admin_audit_records_v1', 1);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 1);
        $this->assertDatabaseCount('admin_temporary_restriction_heads_v1', 1);
        $this->assertDatabaseHas('admin_audit_records_v1', [
            'operation_id' => $operation,
            'actor_id' => $this->actorId,
            'action' => 'accounts.suspend',
            'target_type' => 'account',
            'target_reference' => $this->accountId,
            'reason_code' => 'abuse_report',
            'digest' => $result['auditDigest'],
        ]);
        $this->assertDatabaseHas('admin_temporary_restriction_events_v1', [
            'operation_id' => $operation,
            'action' => 'restrict',
            'revision' => 1,
        ]);
        $this->deny(
            fn() => app(TemporaryRestrictionLedger::class)
                ->assertNotRestrictedForTrustedSession($this->accountId, $this->deviceId),
            'admin.restriction_access_denied',
        );
        $this->assertDatabaseHas('identity_devices', [
            'id' => $this->deviceId, 'revoked_at' => null,
        ]);
    }

    public function test_lost_ack_exact_replay_leaves_both_histories_single(): void
    {
        $op = (string) Str::uuid();
        $actor = $this->actor();
        $deadline = $this->deadline();
        $first = $this->execute($op, until: $deadline, actor: $actor);
        $again = $this->execute($op, until: $deadline, actor: $actor);
        self::assertTrue($again['replay']);
        self::assertSame($first['auditDigest'], $again['auditDigest']);
        self::assertSame(1, $again['revision']);
        self::assertSame(1, app(AdminAuditLedger::class)->verifyChain()['count']);
        $this->assertDatabaseCount('admin_audit_records_v1', 1);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 1);
    }

    public function test_modified_replay_rejects_reason_deadline_and_expected_revision(): void
    {
        $op = (string) Str::uuid();
        $actor = $this->actor();
        $until = $this->deadline();
        $this->execute($op, until: $until, actor: $actor);
        $this->deny(
            fn() => $this->execute($op, reason: 'policy_violation',
                until: $until, actor: $actor),
            'admin.audit_inconsistent',
        );
        $this->deny(
            fn() => $this->execute($op, until: $this->deadline(7), actor: $actor),
            'admin.audit_inconsistent',
        );
        $this->deny(
            fn() => $this->execute($op, revision: 1, until: $until, actor: $actor),
            'admin.restriction_conflicting_replay',
        );
        self::assertSame(1, app(AdminAuditLedger::class)->verifyChain()['count']);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 1);
    }

    public function test_new_action_on_active_restriction_rolls_back_speculative_global_audit(): void
    {
        $this->execute();
        $this->deny(
            fn() => $this->execute((string) Str::uuid(), 1),
            'admin.restriction_already_active',
        );
        self::assertSame(1, app(AdminAuditLedger::class)->verifyChain()['count']);
        $this->assertDatabaseCount('admin_audit_records_v1', 1);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 1);
    }

    public function test_stale_target_revision_rolls_back_global_audit(): void
    {
        $this->execute();
        $this->deny(
            fn() => $this->execute((string) Str::uuid(), 0),
            'admin.restriction_revision_conflict',
        );
        $this->assertDatabaseCount('admin_audit_records_v1', 1);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 1);
        self::assertSame(1, app(AdminAuditLedger::class)->verifyChain()['count']);
    }

    public function test_missing_target_rolls_back_global_audit_with_no_policy_record(): void
    {
        $this->deny(
            fn() => $this->execute(target: (string) Str::uuid()),
            'admin.restriction_target_unavailable',
        );
        $this->assertDatabaseCount('admin_audit_records_v1', 0);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 0);
        self::assertSame(0, app(AdminAuditLedger::class)->verifyChain()['count']);
    }

    public function test_stale_mfa_wrong_role_and_invalid_reason_are_rejected_without_audit(): void
    {
        $ms = CarbonImmutable::now('UTC')->getTimestampMs();
        foreach ([
            $this->actor('auditor'),
            $this->actor('operator', $ms - 301000),
            $this->actor('operator', $ms + 1000),
            $this->actor('operator', $ms - 1000, $ms - 1),
        ] as $actor) {
            $this->deny(fn() => $this->execute(actor: $actor), 'admin.access_denied');
        }
        $this->deny(
            fn() => $this->execute(reason: 'PIN and Recovery Key'),
            'admin.account_restriction_invalid',
        );
        $this->deny(
            fn() => $this->execute(until: $this->deadline(91)),
            'admin.account_restriction_invalid',
        );
        $this->assertDatabaseCount('admin_audit_records_v1', 0);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 0);
    }

    public function test_cannot_pair_preexisting_global_audit_without_policy_record(): void
    {
        $op = (string) Str::uuid();
        $actor = $this->actor();
        $until = $this->deadline();
        $prior = app(AdminAuditLedger::class)->record(
            $actor, $op, 'accounts.suspend', 'account', $this->accountId,
            'abuse_report', $until->getTimestampMs(),
        );
        self::assertFalse($prior['replay']);
        $this->deny(
            fn() => $this->execute($op, until: $until, actor: $actor),
            'admin.account_restriction_inconsistent',
        );
        $this->assertDatabaseCount('admin_audit_records_v1', 1);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 0);
    }

    public function test_cannot_pair_preexisting_standalone_policy_without_global_audit(): void
    {
        $op = (string) Str::uuid();
        $actor = $this->actor();
        $until = $this->deadline();
        app(TemporaryRestrictionLedger::class)->changeTrusted(
            $actor, $op, $this->accountId, 'account', $this->accountId,
            'restrict', 0, 'abuse_report', $until,
        );
        $this->deny(
            fn() => $this->execute($op, until: $until, actor: $actor),
            'admin.account_restriction_inconsistent',
        );
        // The speculative global audit MUST be rolled back.
        $this->assertDatabaseCount('admin_audit_records_v1', 0);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 1);
        self::assertSame(0, app(AdminAuditLedger::class)->verifyChain()['count']);
    }

    public function test_grant_and_account_restrict_share_one_consistent_global_audit(): void
    {
        $owner = $this->actor('owner');
        $until = $this->deadline();
        app(EntitlementLedger::class)->current($this->accountId);
        $start = CarbonImmutable::now('UTC')->subSeconds(20)->startOfSecond();
        $grant = app(AdminTrialGrantExecutor::class)->issueTrusted(
            $owner, (string) Str::uuid(), $this->accountId,
            'go', 1, 'trial_access', $start, $until,
        );
        self::assertSame('internal_trial_grant_recorded', $grant['state']);
        $restriction = $this->execute(actor: $owner);
        self::assertFalse($restriction['replay']);
        self::assertSame(2, app(AdminAuditLedger::class)->verifyChain()['count']);
        $this->assertDatabaseCount('admin_audit_records_v1', 2);
        $this->assertDatabaseCount('admin_trial_grant_operations_v1', 1);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 1);
    }

    public function test_no_fake_account_ban_or_admin_auth_endpoint_mounted(): void
    {
        $this->postJson('/admin/v1/account-restrictions', [
            'adminRole' => 'owner',
            'mfaVerifiedAtMs' => PHP_INT_MAX,
            'targetAccount' => $this->accountId,
        ])->assertNotFound();
        $this->assertDatabaseCount('admin_audit_records_v1', 0);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 0);
    }
}
