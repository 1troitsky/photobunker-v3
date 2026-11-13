<?php
declare(strict_types=1);

namespace Tests\Feature\Billing;

use App\Billing\EntitlementLedger;
use App\Billing\GraceLifecycle;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * #226: genuine Laravel session + immutable DB snapshot; trusted settlement
 * is a TEST-ONLY fixture, not a payment callback or real merchant proof.
 * No physical deletion, real S3 or device-browser acceptance is claimed.
 */
final class GraceLifecycleTest extends TestCase
{
    use RefreshDatabase;

    /** @var array<string,array{account:string,device:string}> */
    private array $users = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-11-14T12:00:00Z'));
    }

    private function account(string $label): string
    {
        $account = (string) Str::uuid();
        $device = (string) Str::uuid();
        DB::table('identity_accounts')->insert([
            'id' => $account,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'reserved_until' => now()->addYear(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('identity_devices')->insert([
            'id' => $device,
            'account_id' => $account,
            'signing_spki' => 'test-only-device-spki',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->users[$label] = ['account' => $account, 'device' => $device];
        return $account;
    }

    private function login(string $label): void
    {
        $this->withSession([
            'identity_account' => $this->users[$label]['account'],
            'identity_device' => $this->users[$label]['device'],
            'identity_issued' => time(),
        ]);
    }

    private function ledger(): EntitlementLedger
    {
        return app(EntitlementLedger::class);
    }

    private function paid(
        string $account, string $plan, CarbonImmutable $starts,
        CarbonImmutable $ends, int $expectedRevision = 1,
    ): void {
        if ($expectedRevision === 1) {
            $this->ledger()->current($account);
        }
        $this->ledger()->advanceTrusted(
            $account, $plan, $expectedRevision,
            hash('sha256', 'test-only-verified-event:' . $account . ':'
                . $plan . ':' . $expectedRevision),
            'settlement_verified', $starts, $ends,
        );
    }

    public function test_free_bootstrap_has_no_fictitious_payment_grace_or_deadline(): void
    {
        $this->account('alice');
        $this->login('alice');
        $response = $this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('lifecycle.schemaVersion', 1)
            ->assertJsonPath('lifecycle.planId', 'free')
            ->assertJsonPath('lifecycle.status', 'active')
            ->assertJsonPath('lifecycle.effectivePlanId', 'free')
            ->assertJsonPath('lifecycle.paidPrivilegesActive', false)
            ->assertJsonPath('lifecycle.graceActive', false)
            ->assertJsonPath('lifecycle.paidRightsDowngraded', false)
            ->assertJsonPath('lifecycle.newWritesPolicy',
                'effective_entitlement_and_server_quotas')
            ->assertJsonPath('lifecycle.existingMediaPolicy',
                'immutable_signed_ttl_and_current_acl')
            ->json('lifecycle');
        $this->assertNull($response['graceDays']);
        $this->assertNull($response['planEndsAt']);
        $this->assertNull($response['graceEndsAt']);
        $this->assertNull($response['nextDeadlineAt']);
        $this->assertNull($response['secondsUntilNextDeadline']);
        $this->assertSame('2026-11-14T12:00:00Z', $response['asOfAt']);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 1);
    }

    public function test_all_paid_plans_have_exact_grace_deadline_but_only_free_new_rights(): void
    {
        $cases = [
            'go' => 15, 'pro' => 30, 'unlimited' => 60,
            'unlimited_plus' => 90,
        ];
        $now = CarbonImmutable::now('UTC');
        $end = $now->subDay();
        foreach ($cases as $plan => $days) {
            $id = $this->account($plan);
            $this->paid($id, $plan, $now->subDays(40), $end);
            $this->login($plan);
            $response = $this->getJson('/billing/v1/me?planId=unlimited_plus')
                ->assertOk()
                ->assertJsonPath('entitlement.planId', $plan)
                ->assertJsonPath('entitlement.status', 'grace')
                ->assertJsonPath('lifecycle.planId', $plan)
                ->assertJsonPath('lifecycle.status', 'grace')
                ->assertJsonPath('lifecycle.effectivePlanId', 'free')
                ->assertJsonPath('lifecycle.paidPrivilegesActive', false)
                ->assertJsonPath('lifecycle.graceActive', true)
                ->assertJsonPath('lifecycle.paidRightsDowngraded', true)
                ->json('lifecycle');
            $deadline = $end->addDays($days);
            $this->assertSame($days, $response['graceDays']);
            $this->assertSame($end->format('Y-m-d\TH:i:s\Z'),
                $response['planEndsAt']);
            $this->assertSame($deadline->format('Y-m-d\TH:i:s\Z'),
                $response['graceEndsAt']);
            $this->assertSame($response['graceEndsAt'],
                $response['nextDeadlineAt']);
            $this->assertSame($deadline->getTimestamp() - $now->getTimestamp(),
                $response['secondsUntilNextDeadline']);
        }
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 8);
    }

    public function test_exact_end_and_grace_boundaries_fail_closed_to_free_without_clock_drift(): void
    {
        $account = $this->account('alice');
        $now = CarbonImmutable::now('UTC');
        $end = $now->addDay();
        $this->paid($account, 'pro', $now->subMinute(), $end);
        $lifecycle = app(GraceLifecycle::class);
        foreach ([
            [$end->subSecond(), 'active', 'pro', true],
            [$end, 'grace', 'free', false],
            [$end->addDays(30)->subSecond(), 'grace', 'free', false],
            [$end->addDays(30), 'expired', 'free', false],
        ] as [$at, $status, $effectivePlan, $hasPaidRights]) {
            $e = $this->ledger()->current($account, $at);
            $result = $lifecycle->describe($e, $at);
            $this->assertSame($status, $result['status']);
            $this->assertSame($effectivePlan, $result['effectivePlanId']);
            $this->assertSame($hasPaidRights, $result['paidPrivilegesActive']);
            $this->assertSame($status === 'expired' ? null
                : ($status === 'active'
                    ? $end->format('Y-m-d\TH:i:s\Z')
                    : $end->addDays(30)->format('Y-m-d\TH:i:s\Z')),
                $result['nextDeadlineAt']);
        }
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 2);
    }

    public function test_trusted_renewal_during_grace_restores_rights_and_keeps_old_revision(): void
    {
        $account = $this->account('alice');
        $this->login('alice');
        $now = CarbonImmutable::now('UTC');
        $this->paid($account, 'go', $now->subDays(33), $now->subDays(2));
        $grace = $this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('lifecycle.status', 'grace')
            ->assertJsonPath('lifecycle.effectivePlanId', 'free')
            ->json('entitlement');
        $oldHash = $grace['snapshotSha256'];
        $this->paid($account, 'go', $now->subMinute(), $now->addDays(30), 2);
        $this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('lifecycle.status', 'active')
            ->assertJsonPath('lifecycle.revision', 3)
            ->assertJsonPath('lifecycle.effectivePlanId', 'go')
            ->assertJsonPath('lifecycle.paidPrivilegesActive', true)
            ->assertJsonPath('lifecycle.graceActive', false);
        $this->assertSame($oldHash, DB::table('billing_entitlement_snapshots_v1')
            ->where('account_id', $account)->where('revision', 2)
            ->value('snapshot_hash'));
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 3);
    }

    public function test_paid_lapse_is_read_only_for_existing_asset_deadlines(): void
    {
        $account = $this->account('alice');
        $this->login('alice');
        $now = CarbonImmutable::now('UTC');
        $this->paid($account, 'go', $now->subDays(20), $now->subDay());
        $photo = (string) Str::uuid();
        $expiry = $now->addDays(5)->getTimestampMs();
        DB::table('photo_records')->insert([
            'id' => $photo, 'account_id' => $account,
            'device_id' => $this->users['alice']['device'],
            'operation_id' => (string) Str::uuid(), 'state' => 'active',
            'expires_at' => $expiry, 'contract_hash' => str_repeat('b', 64),
            'contract_json' => '{}', 'signature' => 'fixture-only',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('lifecycle.status', 'grace')
            ->assertJsonPath('lifecycle.existingMediaPolicy',
                'immutable_signed_ttl_and_current_acl');
        $this->assertDatabaseHas('photo_records', [
            'id' => $photo, 'state' => 'active', 'expires_at' => $expiry,
        ]);
        $this->assertDatabaseCount('photo_records', 1);
    }

    public function test_unauthorized_and_cross_account_requests_never_expose_other_grace(): void
    {
        $alice = $this->account('alice');
        $this->account('bob');
        $now = CarbonImmutable::now('UTC');
        $this->paid($alice, 'unlimited_plus',
            $now->subDays(6), $now->subDay());
        $this->getJson('/billing/v1/me')->assertUnauthorized();
        $this->login('bob');
        $this->getJson('/billing/v1/me?accountId=' . $alice)
            ->assertOk()->assertJsonPath('lifecycle.planId', 'free')
            ->assertJsonPath('lifecycle.graceEndsAt', null)
            ->assertJsonPath('lifecycle.paidPrivilegesActive', false);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 3);
    }

    public function test_forged_or_inconsistent_snapshot_metadata_never_generates_grace_rights(): void
    {
        $account = $this->account('alice');
        $now = CarbonImmutable::now('UTC');
        $this->paid($account, 'go', $now->subDays(20), $now->subDay());
        $valid = $this->ledger()->current($account, $now);
        $lifecycle = app(GraceLifecycle::class);
        foreach ([
            ['status' => 'active'],
            ['effectivePlanId' => 'unlimited_plus'],
            ['paidPrivilegesActive' => true],
            ['graceEndsAt' => '2099-01-01T00:00:00Z'],
            ['graceEndsAt' => '2026-02-30T00:00:00Z'],
            ['graceEndsAt' => null],
            ['snapshotSha256' => str_repeat('x', 64)],
        ] as $override) {
            try {
                $lifecycle->describe(array_replace($valid, $override), $now);
                $this->fail('Forged lifecycle state must be rejected');
            } catch (RuntimeException $e) {
                $this->assertStringStartsWith('billing.lifecycle_', $e->getMessage());
            }
        }
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 2);
    }
}
