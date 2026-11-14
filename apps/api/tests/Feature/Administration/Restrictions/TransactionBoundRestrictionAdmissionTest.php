<?php
declare(strict_types=1);

namespace Tests\Feature\Administration\Restrictions;

use App\Administration\AdminPrincipal;
use App\Administration\Restrictions\AuditedAccountRestrictionExecutor;
use App\Administration\Restrictions\TemporaryRestrictionLedger;
use App\Administration\Restrictions\TransactionBoundRestrictionAdmission;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class TransactionBoundRestrictionAdmissionTest extends TestCase
{
    use RefreshDatabase;

    private string $operatorId;
    private string $accountId;
    private string $deviceId;
    private string $secondDeviceId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->operatorId = $this->readyAccount();
        $this->accountId = $this->readyAccount();
        $this->deviceId = $this->device($this->accountId);
        $this->secondDeviceId = $this->device($this->accountId);
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

    private function device(string $accountId): string
    {
        $id = (string) Str::uuid();
        DB::table('identity_devices')->insert([
            'id' => $id, 'account_id' => $accountId,
            'signing_spki' => 'synthetic-public-test-only',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        return $id;
    }

    private function admission(): TransactionBoundRestrictionAdmission
    {
        return app(TransactionBoundRestrictionAdmission::class);
    }

    private function operator(): AdminPrincipal
    {
        $ms = CarbonImmutable::now('UTC')->getTimestampMs();
        return new AdminPrincipal($this->operatorId, 'operator',
            $ms + 600000, $ms - 1000);
    }

    private function deadline(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC')->addDays(3)->startOfSecond();
    }

    private function suspendAccount(): void
    {
        app(AuditedAccountRestrictionExecutor::class)->restrictTrusted(
            $this->operator(), (string) Str::uuid(), $this->accountId,
            0, 'abuse_report', $this->deadline(),
        );
    }

    private function deny(callable $callback, string $code): void
    {
        try {
            $callback();
            self::fail('Transaction admission failed open: '.$code);
        } catch (DomainException $e) {
            self::assertSame($code, $e->getMessage());
        }
    }

    public function test_autocommit_cannot_check_and_then_mutate_after_lock_release(): void
    {
        // RefreshDatabase itself owns a transaction (depth >= 1), so stub
        // only the current-depth read and restore the actual DB facade
        // manager before teardown; otherwise this test would be false.
        $actualDb = DB::getFacadeRoot();
        $unbound = \Mockery::mock();
        $unbound->shouldReceive('transactionLevel')->once()->andReturn(0);
        DB::swap($unbound);
        try {
            $this->deny(
                fn() => $this->admission()->assertForTrustedDatabaseTransaction(
                    $this->accountId, $this->deviceId),
                'admin.restriction_transaction_required',
            );
        } finally {
            DB::swap($actualDb);
        }
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 0);
    }

    public function test_pre_authenticated_identity_checks_before_protected_db_write(): void
    {
        $newTime = now()->addMinute();
        $outerDepth = DB::transactionLevel();
        DB::transaction(function () use ($newTime, $outerDepth): void {
            self::assertSame($outerDepth + 1, DB::transactionLevel());
            $this->admission()->assertForTrustedDatabaseTransaction(
                $this->accountId, $this->deviceId);
            self::assertSame($outerDepth + 1, DB::transactionLevel());
            $changed = DB::table('identity_devices')->where('id', $this->deviceId)
                ->update(['updated_at' => $newTime]);
            self::assertSame(1, $changed);
        });
        $this->assertDatabaseHas('identity_devices', [
            'id' => $this->deviceId, 'updated_at' => $newTime,
            'revoked_at' => null,
        ]);
        self::assertSame($outerDepth, DB::transactionLevel());
    }

    public function test_account_restriction_denies_before_any_user_db_mutation(): void
    {
        $this->suspendAccount();
        $original = DB::table('identity_devices')->where('id', $this->deviceId)
            ->value('updated_at');
        $ran = false;

        $this->deny(
            function () use (&$ran): void {
                DB::transaction(function () use (&$ran): void {
                    $this->admission()->assertForTrustedDatabaseTransaction(
                        $this->accountId, $this->deviceId);
                    $ran = true;
                    DB::table('identity_devices')->where('id', $this->deviceId)
                        ->update(['updated_at' => now()->addHour()]);
                });
            },
            'admin.restriction_access_denied',
        );

        self::assertFalse($ran);
        self::assertSame($original,
            DB::table('identity_devices')->where('id', $this->deviceId)
                ->value('updated_at'));
        self::assertSame(1,
            DB::table('admin_audit_records_v1')->count());
    }

    public function test_device_only_restriction_is_scoped_and_does_not_revoke_keys(): void
    {
        app(TemporaryRestrictionLedger::class)->changeTrusted(
            $this->operator(), (string) Str::uuid(), $this->accountId,
            'device', $this->deviceId, 'restrict', 0, 'abuse_report',
            $this->deadline(),
        );
        $this->deny(
            fn() => DB::transaction(fn() =>
                $this->admission()->assertForTrustedDatabaseTransaction(
                    $this->accountId, $this->deviceId)),
            'admin.restriction_access_denied',
        );
        DB::transaction(fn() =>
            $this->admission()->assertForTrustedDatabaseTransaction(
                $this->accountId, $this->secondDeviceId));
        $this->assertDatabaseHas('identity_devices', [
            'id' => $this->deviceId, 'revoked_at' => null,
        ]);
    }

    public function test_forged_account_device_pair_rejected_inside_real_transaction(): void
    {
        $otherAccount = $this->readyAccount();
        $otherDevice = $this->device($otherAccount);
        $this->deny(
            fn() => DB::transaction(fn() =>
                $this->admission()->assertForTrustedDatabaseTransaction(
                    $this->accountId, $otherDevice)),
            'admin.restriction_target_unavailable',
        );
        $this->deny(
            fn() => DB::transaction(fn() =>
                $this->admission()->assertForTrustedDatabaseTransaction(
                    $this->accountId, (string) Str::uuid())),
            'admin.restriction_target_unavailable',
        );
    }

    public function test_existing_device_revocation_always_denies_regardless_of_policy(): void
    {
        DB::table('identity_devices')->where('id', $this->deviceId)
            ->update(['revoked_at' => now()]);
        $this->deny(
            fn() => DB::transaction(fn() =>
                $this->admission()->assertForTrustedDatabaseTransaction(
                    $this->accountId, $this->deviceId)),
            'admin.restriction_target_unavailable',
        );
    }

    public function test_outer_rollback_reverts_authenticated_db_work(): void
    {
        $old = DB::table('identity_devices')->where('id', $this->deviceId)
            ->value('updated_at');
        $this->deny(
            function (): void {
                DB::transaction(function (): void {
                    $this->admission()->assertForTrustedDatabaseTransaction(
                        $this->accountId, $this->deviceId);
                    DB::table('identity_devices')->where('id', $this->deviceId)
                        ->update(['updated_at' => now()->addHours(4)]);
                    throw new DomainException('expected.rollback');
                });
            },
            'expected.rollback',
        );
        self::assertSame($old,
            DB::table('identity_devices')->where('id', $this->deviceId)
                ->value('updated_at'));
    }

    public function test_no_live_http_identity_or_admin_policy_hook_is_claimed(): void
    {
        $this->postJson('/admin/v1/restriction-admission', [
            'accountId' => $this->accountId,
            'deviceId' => $this->deviceId,
            'adminRole' => 'owner',
        ])->assertNotFound();
        $this->assertDatabaseCount('admin_audit_records_v1', 0);
    }
}
