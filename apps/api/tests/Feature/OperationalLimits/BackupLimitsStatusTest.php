<?php

declare(strict_types=1);

namespace Tests\Feature\OperationalLimits;

use App\OperationalLimits\BackupAdmission;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Live Laravel web route, Identity v2 session & device ACL, real admission DB.
 * No fake successful backup/worker/settlement is created in these tests.
 */
final class BackupLimitsStatusTest extends TestCase
{
    use RefreshDatabase;

    /** @var array<string,array{account:string,device:string}> */
    private array $users = [];

    protected function setUp(): void
    {
        parent::setUp();
        foreach (['alice', 'bob'] as $name) {
            $account = (string) Str::uuid();
            $device = (string) Str::uuid();
            DB::table('identity_accounts')->insert([
                'id' => $account,
                'operation_id' => (string) Str::uuid(),
                'prepare_hash' => str_repeat('b', 64),
                'status' => 'ready',
                'reserved_until' => now()->addDay(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('identity_devices')->insert([
                'id' => $device, 'account_id' => $account,
                'signing_spki' => 'isolated-technical-status-test',
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $this->users[$name] = ['account' => $account, 'device' => $device];
        }
    }

    private function login(string $user): void
    {
        $this->withSession([
            'identity_account' => $this->users[$user]['account'],
            'identity_device' => $this->users[$user]['device'],
            'identity_issued' => time(),
        ]);
    }

    private function reserve(string $owner): array
    {
        $op = (string) Str::uuid();
        $decision = app(BackupAdmission::class)->reserve($this->users[$owner]['account'], $op);
        $this->assertTrue($decision->allowed);
        $this->assertNotNull($decision->leaseId);
        return [$op, $decision->leaseId];
    }

    public function test_read_only_route_uses_real_session_and_exposes_no_start(): void
    {
        $this->getJson('/backup/v1/limits')->assertUnauthorized();
        $this->postJson('/backup/v1/limits', ['accountId' => $this->users['bob']['account']])
            ->assertStatus(405);
        $this->postJson('/backup/v1/start', ['operationId' => (string) Str::uuid()])
            ->assertNotFound();

        $this->login('alice');
        $response = $this->getJson('/backup/v1/limits')->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('schemaVersion', 1)
            ->assertJsonPath('technicalGate', 'clear')
            ->assertJsonPath('technicalBlocked', false)
            ->assertJsonPath('activeLeaseState', null)
            ->assertJsonPath('retryAfterSeconds', null)
            ->assertJsonPath('minimumStartIntervalSeconds', 3600)
            ->assertJsonPath('source', 'server_backup_admission_v1')
            ->assertJsonPath('scope', 'advisory_only_not_backup_eligibility_or_verified_backup');
        $this->assertMatchesRegularExpression(
            '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/',
            $response->json('asOfAt')
        );
        $this->assertDatabaseCount('backup_start_operations_v1', 0);
    }

    public function test_reserved_worker_lease_is_private_and_cannot_be_mutated_by_get(): void
    {
        [$operation, $lease] = $this->reserve('alice');
        $this->login('alice');
        $one = $this->getJson('/backup/v1/limits')->assertOk()
            ->assertJsonPath('technicalGate', 'active_lease')
            ->assertJsonPath('technicalBlocked', true)
            ->assertJsonPath('activeLeaseState', 'reserved')->json();

        $this->assertGreaterThanOrEqual(1, $one['retryAfterSeconds']);
        $this->assertLessThanOrEqual(900, $one['retryAfterSeconds']);
        $encoded = json_encode($one, JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString($operation, $encoded);
        $this->assertStringNotContainsString($lease, $encoded);
        $this->assertStringNotContainsString($this->users['alice']['account'], $encoded);
        $this->getJson('/backup/v1/limits?accountId='.$this->users['bob']['account'])
            ->assertJsonPath('technicalGate', 'active_lease');
        $this->assertSame('reserved', DB::table('backup_start_operations_v1')
            ->where('operation_id', $operation)->value('state'));
        $this->assertDatabaseCount('backup_start_operations_v1', 1);
        $this->login('bob');
        $this->getJson('/backup/v1/limits?accountId='.$this->users['alice']['account'])
            ->assertOk()->assertJsonPath('technicalGate', 'clear');
    }

    public function test_confirmed_failure_preserves_one_hour_cooldown_without_pretending_success(): void
    {
        [$op, $lease] = $this->reserve('alice');
        $a = $this->users['alice']['account'];
        $admission = app(BackupAdmission::class);
        $this->assertSame('backup.started', $admission->confirmStart($a, $op, $lease)->code);
        $this->assertSame('backup.failed', $admission->finish($a, $op, $lease, false)->code);
        $this->login('alice');
        $data = $this->getJson('/backup/v1/limits')->assertOk()
            ->assertJsonPath('technicalGate', 'cooldown')
            ->assertJsonPath('activeLeaseState', null)
            ->assertJsonPath('technicalBlocked', true)
            ->json();
        $this->assertGreaterThanOrEqual(1, $data['retryAfterSeconds']);
        $this->assertLessThanOrEqual(3600, $data['retryAfterSeconds']);
        $this->assertNotNull($data['nextTechnicalStartAt']);
        $this->assertSame('failed', DB::table('backup_start_operations_v1')
            ->where('operation_id', $op)->value('state'));
    }

    public function test_active_started_lease_does_not_hide_the_later_cooldown_deadline(): void
    {
        [$op, $lease] = $this->reserve('alice');
        $admission = app(BackupAdmission::class);
        $this->assertSame('backup.started',
            $admission->confirmStart($this->users['alice']['account'], $op, $lease)->code);
        $this->login('alice');
        $data = $this->getJson('/backup/v1/limits')->assertOk()
            ->assertJsonPath('technicalGate', 'active_lease')
            ->assertJsonPath('activeLeaseState', 'started')->json();
        $this->assertGreaterThan(900, $data['retryAfterSeconds']);
        $this->assertLessThanOrEqual(3600, $data['retryAfterSeconds']);
    }

    public function test_stale_lease_is_not_reported_as_live_or_mutated_during_get(): void
    {
        [$op] = $this->reserve('alice');
        DB::table('backup_start_operations_v1')->where('operation_id', $op)
            ->update(['lease_expires_at' => CarbonImmutable::now('UTC')->subDay()]);
        $this->login('alice');
        $this->getJson('/backup/v1/limits')
            ->assertOk()->assertJsonPath('technicalGate', 'clear')
            ->assertJsonPath('technicalBlocked', false);
        // This advisory GET does not expire leases: ONLY the atomic admission
        // path under account row lock can do that before a genuine reservation.
        $this->assertSame('reserved', DB::table('backup_start_operations_v1')
            ->where('operation_id', $op)->value('state'));
    }

    public function test_revoked_device_expired_session_and_foreign_device_are_denied(): void
    {
        $this->reserve('alice');
        $this->login('alice');
        DB::table('identity_devices')->where('id', $this->users['alice']['device'])
            ->update(['revoked_at' => now()]);
        $this->getJson('/backup/v1/limits')->assertUnauthorized();
        DB::table('identity_devices')->where('id', $this->users['alice']['device'])
            ->update(['revoked_at' => null]);

        $this->withSession([
            'identity_account' => $this->users['alice']['account'],
            'identity_device' => $this->users['bob']['device'],
            'identity_issued' => time(),
        ]);
        $this->getJson('/backup/v1/limits')->assertUnauthorized();

        $this->withSession([
            'identity_account' => $this->users['alice']['account'],
            'identity_device' => $this->users['alice']['device'],
            'identity_issued' => time()-90000,
        ]);
        $this->getJson('/backup/v1/limits')->assertUnauthorized();
    }

    public function test_plan_unlimited_plus_cannot_lower_technical_cooldown_floor(): void
    {
        config()->set('plans.plans.unlimited_plus.backup_limit', null);
        config()->set('operational_limits.backup.minimum_start_interval_seconds', 1);
        [$op, $lease] = $this->reserve('alice');
        $a = $this->users['alice']['account'];
        $admission = app(BackupAdmission::class);
        $admission->confirmStart($a, $op, $lease);
        $admission->finish($a, $op, $lease, true);
        $this->login('alice');
        $this->getJson('/backup/v1/limits')->assertOk()
            ->assertJsonPath('minimumStartIntervalSeconds', 3600)
            ->assertJsonPath('technicalGate', 'cooldown');
    }
}
