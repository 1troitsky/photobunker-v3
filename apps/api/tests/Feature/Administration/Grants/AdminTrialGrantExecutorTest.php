<?php
declare(strict_types=1);

namespace Tests\Feature\Administration\Grants;

use App\Administration\AdminAuditLedger;
use App\Administration\AdminPrincipal;
use App\Administration\Grants\AdminTrialGrantExecutor;
use App\Billing\EntitlementLedger;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class AdminTrialGrantExecutorTest extends TestCase
{
    use RefreshDatabase;

    private string $actorId;
    private string $targetId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actorId = $this->readyAccount();
        $this->targetId = $this->readyAccount();
    }

    private function readyAccount(): string
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
        string $role = 'owner',
        ?int $mfaMs = null,
        ?int $endsMs = null,
    ): AdminPrincipal {
        $now = (int) now()->getTimestampMs();
        return new AdminPrincipal(
            $this->actorId, $role, $endsMs ?? $now + 600_000,
            $mfaMs ?? $now - 1_000,
        );
    }

    /** @return array{0:CarbonImmutable,1:CarbonImmutable} */
    private function period(): array
    {
        $now = CarbonImmutable::now('UTC');
        return [$now->subSeconds(20)->startOfSecond(),
            $now->addDays(10)->startOfSecond()];
    }

    private function ledger(): EntitlementLedger
    {
        return $this->app->make(EntitlementLedger::class);
    }

    private function execute(
        AdminPrincipal $actor,
        string $operationId,
        string $planId = 'pro',
        int $expectedRevision = 1,
        string $reason = 'trial_access',
        ?string $targetId = null,
        ?array $period = null,
    ): array {
        [$starts, $ends] = $period ?? $this->period();
        return $this->app->make(AdminTrialGrantExecutor::class)->issueTrusted(
            $actor, $operationId, $targetId ?? $this->targetId,
            $planId, $expectedRevision, $reason, $starts, $ends,
        );
    }

    public function test_owner_mfa_audit_billing_and_receipt_commit_atomically(): void
    {
        $before = $this->ledger()->current($this->targetId);
        self::assertSame('free', $before['planId']);
        self::assertSame(1, $before['revision']);

        $actor = $this->actor();
        $operation = (string) Str::uuid();
        $period = $this->period();
        $result = $this->execute($actor, $operation, 'pro', 1,
            'trial_access', $this->targetId, $period);

        self::assertSame('internal_trial_grant_recorded', $result['state']);
        self::assertSame(2, $result['revision']);
        self::assertFalse($result['replay']);
        self::assertSame(1, (new AdminAuditLedger())->verifyChain()['count']);
        $now = $this->ledger()->current($this->targetId);
        self::assertSame('pro', $now['planId']);
        self::assertSame(2, $now['revision']);
        self::assertSame('active', $now['status']);
        self::assertSame('admin_mfa_approved', $now['source']);
        $this->assertDatabaseCount('admin_trial_grant_operations_v1', 1);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 2);
        $this->assertDatabaseHas('admin_trial_grant_operations_v1', [
            'operation_id' => $operation, 'actor_id' => $this->actorId,
            'account_id' => $this->targetId, 'plan_id' => 'pro',
            'reason_code' => 'trial_access', 'entitlement_revision' => 2,
        ]);
        $receipt = DB::table('admin_trial_grant_operations_v1')->first();
        self::assertSame($result['auditDigest'], $receipt->audit_digest);
        self::assertSame($result['eventHash'], $receipt->verified_event_hash);
        $serialized = json_encode($receipt, JSON_THROW_ON_ERROR);
        foreach (['recoveryKey', 'gps', 'filename', 'plaintext', 'privateKey', 'accessToken'] as $secret) {
            self::assertStringNotContainsString($secret, $serialized);
        }

        $replay = $this->execute($actor, $operation, 'pro', 1,
            'trial_access', $this->targetId, $period);
        self::assertTrue($replay['replay']);
        self::assertSame($result['eventHash'], $replay['eventHash']);
        self::assertSame($result['auditDigest'], $replay['auditDigest']);
        self::assertSame(2, $replay['revision']);
        self::assertSame(1, (new AdminAuditLedger())->verifyChain()['count']);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 2);
        $this->assertDatabaseCount('admin_trial_grant_operations_v1', 1);
    }

    public function test_changed_plan_or_actor_under_same_operation_fails_closed(): void
    {
        $actor = $this->actor();
        $op = (string) Str::uuid();
        $period = $this->period();
        $this->ledger()->current($this->targetId);
        $this->execute($actor, $op, 'go', 1, 'trial_access', null, $period);
        $original = DB::table('admin_trial_grant_operations_v1')->first();
        foreach (['pro','unlimited_plus'] as $changed) {
            try {
                $this->execute($actor, $op, $changed, 1, 'trial_access', null, $period);
                self::fail('Plan change reused a verified admin operation');
            } catch (DomainException $e) {
                self::assertSame('admin.trial_conflicting_replay', $e->getMessage());
            }
        }
        $other = new AdminPrincipal((string) Str::uuid(), 'owner',
            ((int) now()->getTimestampMs()) + 600_000,
            ((int) now()->getTimestampMs()) - 1_000);
        try {
            $this->execute($other, $op, 'go', 1, 'trial_access', null, $period);
            self::fail('Different actor reused an admin operation');
        } catch (DomainException $e) {
            self::assertSame('admin.audit_inconsistent', $e->getMessage());
        }
        self::assertEquals($original, DB::table('admin_trial_grant_operations_v1')->first());
        self::assertSame(1, (new AdminAuditLedger())->verifyChain()['count']);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 2);
    }

    public function test_missing_stale_mfa_or_non_owner_cannot_create_receipt_or_audit(): void
    {
        $now = (int) now()->getTimestampMs();
        foreach ([
            $this->actor('operator'),
            $this->actor('auditor'),
            new AdminPrincipal($this->actorId, 'owner', $now + 600_000, null),
            $this->actor('owner', $now - 300_001),
            $this->actor('owner', $now + 1_000),
            $this->actor('owner', $now - 1_000, $now - 1),
        ] as $actor) {
            try {
                $this->execute($actor, (string) Str::uuid());
                self::fail('Invalid actor granted tariff');
            } catch (DomainException $e) {
                self::assertSame('admin.access_denied', $e->getMessage());
            }
        }
        $this->assertDatabaseCount('admin_trial_grant_operations_v1', 0);
        $this->assertDatabaseCount('admin_audit_records_v1', 0);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 0);
    }

    public function test_invalid_plan_reason_or_period_does_not_write(): void
    {
        $actor = $this->actor();
        $now = CarbonImmutable::now('UTC');
        foreach ([
            ['free','trial_access',[$now->subSeconds(10)->startOfSecond(),$now->addDay()->startOfSecond()]],
            ['pro','Emergency PIN: 1234',[$now->subSeconds(10)->startOfSecond(),$now->addDay()->startOfSecond()]],
            ['pro','trial_access',[$now->addMinutes(5)->startOfSecond(),$now->addDay()->startOfSecond()]],
            ['pro','trial_access',[$now->subSeconds(10)->startOfSecond(),$now->addDays(366)->startOfSecond()]],
            ['pro','trial_access',[$now->subSeconds(10)->startOfSecond(),$now->subSeconds(1)->startOfSecond()]],
        ] as [$plan,$reason,$period]) {
            try {
                $this->execute($actor, (string) Str::uuid(), $plan, 1, $reason, null, $period);
                self::fail('Invalid grant accepted');
            } catch (DomainException $e) {
                self::assertSame('admin.trial_invalid', $e->getMessage());
            }
        }
        $this->assertDatabaseCount('admin_trial_grant_operations_v1', 0);
        $this->assertDatabaseCount('admin_audit_records_v1', 0);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 0);
    }

    public function test_stale_expected_revision_rolls_back_audit_and_receipt(): void
    {
        $actor = $this->actor();
        $period = $this->period();
        $this->ledger()->current($this->targetId);
        $this->execute($actor, (string) Str::uuid(), 'go', 1, 'trial_access', null, $period);
        try {
            $this->execute($actor, (string) Str::uuid(), 'pro', 1, 'trial_access', null, $period);
            self::fail('Stale revision succeeded');
        } catch (HttpException $e) {
            self::assertSame(409, $e->getStatusCode());
        }
        self::assertSame(1, (new AdminAuditLedger())->verifyChain()['count']);
        $this->assertDatabaseCount('admin_trial_grant_operations_v1', 1);
        self::assertSame('go', $this->ledger()->current($this->targetId)['planId']);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 2);
    }

    public function test_unready_target_cannot_leave_audited_but_unapplied_grant(): void
    {
        DB::table('identity_accounts')->where('id', $this->targetId)
            ->update(['status' => 'reserved']);
        try {
            $this->execute($this->actor(), (string) Str::uuid());
            self::fail('Unready target accepted');
        } catch (HttpException $e) {
            self::assertSame(401, $e->getStatusCode());
        }
        $this->assertDatabaseCount('admin_trial_grant_operations_v1', 0);
        $this->assertDatabaseCount('admin_audit_records_v1', 0);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 0);
    }

    public function test_no_public_admin_grant_endpoint_is_mounted(): void
    {
        $this->postJson('/admin/v1/grants', [
            'planId'=>'unlimited_plus',
            'adminRole'=>'owner',
            'mfaVerifiedAtMs'=>PHP_INT_MAX,
        ])->assertNotFound();
    }
}
