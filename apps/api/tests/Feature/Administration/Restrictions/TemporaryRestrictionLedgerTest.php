<?php
declare(strict_types=1);

namespace Tests\Feature\Administration\Restrictions;

use App\Administration\AdminPrincipal;
use App\Administration\Restrictions\TemporaryRestrictionLedger;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class TemporaryRestrictionLedgerTest extends TestCase
{
    use RefreshDatabase;

    private string $actorId;
    private string $accountId;
    private string $deviceId;
    private string $secondDeviceId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actorId = $this->readyAccount();
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

    private function device(string $account): string
    {
        $id = (string) Str::uuid();
        DB::table('identity_devices')->insert([
            'id' => $id,
            'account_id' => $account,
            'signing_spki' => 'isolated-fixture-no-real-keys',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $id;
    }

    private function actor(
        string $role = 'operator', ?int $mfa = null, ?int $expires = null,
    ): AdminPrincipal {
        $now = (int) now()->getTimestampMs();
        return new AdminPrincipal(
            $this->actorId, $role, $expires ?? $now + 600_000,
            $mfa ?? $now - 1_000,
        );
    }

    private function ledger(): TemporaryRestrictionLedger
    {
        return $this->app->make(TemporaryRestrictionLedger::class);
    }

    private function expiry(int $days = 7): CarbonImmutable
    {
        return CarbonImmutable::now('UTC')->addDays($days)->startOfSecond();
    }

    private function change(
        string $type = 'account', string $action = 'restrict',
        int $expectedRevision = 0, ?string $id = null,
        ?string $operationId = null, ?CarbonImmutable $expiry = null,
        ?AdminPrincipal $actor = null, ?string $reason = null,
        ?string $accountId = null,
    ): array {
        return $this->ledger()->changeTrusted(
            $actor ?? $this->actor(),
            $operationId ?? (string) Str::uuid(),
            $accountId ?? $this->accountId,
            $type,
            $id ?? ($type === 'account' ? $this->accountId : $this->deviceId),
            $action,
            $expectedRevision,
            $reason ?? ($action === 'restrict' ? 'abuse_report' : 'appeal_accepted'),
            $action === 'restrict' ? ($expiry ?? $this->expiry()) : $expiry,
        );
    }

    private function deny(callable $action, string $error): void
    {
        try {
            $action();
            self::fail('Restriction failed open: '.$error);
        } catch (DomainException $e) {
            self::assertSame($error, $e->getMessage());
        }
    }

    public function test_account_restriction_denies_both_devices_and_expires_without_mutation(): void
    {
        $this->ledger()->assertNotRestrictedForTrustedSession(
            $this->accountId, $this->deviceId);
        $this->ledger()->assertNotRestrictedForTrustedSession(
            $this->accountId, $this->secondDeviceId);

        $until = $this->expiry();
        $op = (string) Str::uuid();
        $result = $this->change('account', 'restrict', 0, null, $op, $until);
        self::assertSame('internal_restriction_event_recorded', $result['state']);
        self::assertSame(1, $result['revision']);
        self::assertFalse($result['replay']);
        foreach ([$this->deviceId, $this->secondDeviceId] as $device) {
            $this->deny(
                fn() => $this->ledger()->assertNotRestrictedForTrustedSession(
                    $this->accountId, $device),
                'admin.restriction_access_denied',
            );
            // Effective expiry is checked on each server read. No scheduler
            // nor destructive edit to identity rows is necessary.
            $this->ledger()->assertNotRestrictedForTrustedSession(
                $this->accountId, $device, $until->addSecond(),
            );
        }
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 1);
        $this->assertDatabaseCount('admin_temporary_restriction_heads_v1', 1);
        $this->assertDatabaseHas('identity_accounts', [
            'id' => $this->accountId, 'status' => 'ready',
        ]);
    }

    public function test_device_restriction_does_not_revoke_keys_or_affect_other_device(): void
    {
        $until = $this->expiry(5);
        $this->change('device', 'restrict', 0, $this->deviceId, null, $until);
        $this->deny(
            fn() => $this->ledger()->assertNotRestrictedForTrustedSession(
                $this->accountId, $this->deviceId),
            'admin.restriction_access_denied',
        );
        $this->ledger()->assertNotRestrictedForTrustedSession(
            $this->accountId, $this->secondDeviceId);
        $this->assertDatabaseHas('identity_devices', [
            'id' => $this->deviceId, 'revoked_at' => null,
        ]);
        $this->ledger()->assertNotRestrictedForTrustedSession(
            $this->accountId, $this->deviceId, $until->addSecond());
    }

    public function test_release_is_separate_audited_cas_action_and_cannot_be_replayed_as_restrict(): void
    {
        $until = $this->expiry();
        $firstId = (string) Str::uuid();
        $this->change('account', 'restrict', 0, null, $firstId, $until);

        $releaseId = (string) Str::uuid();
        $released = $this->change('account', 'release', 1, null, $releaseId);
        self::assertSame(2, $released['revision']);
        self::assertFalse($released['replay']);
        $this->ledger()->assertNotRestrictedForTrustedSession(
            $this->accountId, $this->deviceId);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 2);
        $head = DB::table('admin_temporary_restriction_heads_v1')->first();
        self::assertSame($releaseId, $head->last_operation_id);
        self::assertSame(2, (int) $head->revision);

        $replay = $this->change('account', 'release', 1, null, $releaseId);
        self::assertTrue($replay['replay']);
        self::assertSame(2, $replay['revision']);
        $this->deny(
            fn() => $this->change('account', 'restrict', 1, null, $releaseId, $until),
            'admin.restriction_conflicting_replay',
        );
        $this->deny(
            fn() => $this->change('account', 'release', 2),
            'admin.restriction_not_active',
        );
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 2);
    }

    public function test_expired_restriction_can_be_replaced_with_new_revision_not_resurrected(): void
    {
        $old = $this->expiry(1);
        $this->change('device', 'restrict', 0, $this->deviceId, null, $old);
        $future = $old->addSecond();
        $this->ledger()->assertNotRestrictedForTrustedSession(
            $this->accountId, $this->deviceId, $future);

        // An expired restriction is not silently "released": a new action
        // acquires a new durable revision. Test uses controlled server clock.
        CarbonImmutable::setTestNow($future);
        try {
            $actor = new AdminPrincipal(
                $this->actorId, 'operator',
                $future->getTimestampMs() + 600_000,
                $future->getTimestampMs() - 1_000,
            );
            $new = $this->change('device', 'restrict', 1, $this->deviceId,
                null, $future->addDay()->startOfSecond(), $actor);
            self::assertSame(2, $new['revision']);
            self::assertFalse($new['replay']);
            $this->deny(
                fn() => $this->ledger()->assertNotRestrictedForTrustedSession(
                    $this->accountId, $this->deviceId),
                'admin.restriction_access_denied',
            );
        } finally {
            CarbonImmutable::setTestNow();
        }
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 2);
    }

    public function test_same_operation_replay_returns_historical_revision_only_and_changes_deny(): void
    {
        $actor = $this->actor();
        $operation = (string) Str::uuid();
        $expires = $this->expiry();
        $first = $this->change('account', 'restrict', 0, null,
            $operation, $expires, $actor);
        $replay = $this->change('account', 'restrict', 0, null,
            $operation, $expires, $actor);
        self::assertSame($first['revision'], $replay['revision']);
        self::assertTrue($replay['replay']);
        $this->deny(
            fn() => $this->change('account', 'restrict', 0, null,
                $operation, $this->expiry(8), $actor),
            'admin.restriction_conflicting_replay',
        );
        $this->deny(
            fn() => $this->change('account', 'restrict', 0, null,
                (string) Str::uuid(), $expires, $actor),
            'admin.restriction_revision_conflict',
        );
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 1);
        $this->assertDatabaseCount('admin_temporary_restriction_heads_v1', 1);
    }

    public function test_bad_role_mfa_reason_expiry_and_target_cannot_mutate_data(): void
    {
        $now = (int) now()->getTimestampMs();
        foreach ([
            $this->actor('auditor'),
            new AdminPrincipal($this->actorId, 'operator', $now + 600_000, null),
            $this->actor('operator', $now - 301_000),
            $this->actor('operator', $now + 1_000),
            $this->actor('operator', $now - 1_000, $now - 1),
        ] as $principal) {
            $this->deny(
                fn() => $this->change(actor: $principal),
                'admin.access_denied',
            );
        }
        $this->deny(
            fn() => $this->change(reason: 'Recovery Key PIN 1234'),
            'admin.restriction_invalid',
        );
        $this->deny(
            fn() => $this->change(expiry: $this->expiry(91)),
            'admin.restriction_invalid_expiry',
        );
        $this->deny(
            fn() => $this->change(type: 'device', expiry: $this->expiry(31)),
            'admin.restriction_invalid_expiry',
        );
        $this->deny(
            fn() => $this->change(type: 'account', id: (string) Str::uuid()),
            'admin.restriction_invalid',
        );
        $this->deny(
            fn() => $this->change(type: 'device',
                id: $this->device($this->readyAccount())),
            'admin.restriction_target_unavailable',
        );
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 0);
        $this->assertDatabaseCount('admin_temporary_restriction_heads_v1', 0);
    }

    public function test_revoked_device_and_nonready_account_are_denied_without_reactivation(): void
    {
        DB::table('identity_devices')->where('id', $this->deviceId)
            ->update(['revoked_at' => now()]);
        $this->deny(
            fn() => $this->ledger()->assertNotRestrictedForTrustedSession(
                $this->accountId, $this->deviceId),
            'admin.restriction_target_unavailable',
        );
        $this->deny(
            fn() => $this->change(type: 'device'),
            'admin.restriction_target_unavailable',
        );
        DB::table('identity_accounts')->where('id', $this->accountId)
            ->update(['status' => 'reserved']);
        $this->deny(
            fn() => $this->change(),
            'admin.restriction_target_unavailable',
        );
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 0);
    }

    public function test_tampered_head_or_last_event_fails_closed_on_read_and_write(): void
    {
        $this->change();
        DB::table('admin_temporary_restriction_events_v1')
            ->update(['reason_code' => 'forged_reason']);
        $this->deny(
            fn() => $this->ledger()->assertNotRestrictedForTrustedSession(
                $this->accountId, $this->deviceId),
            'admin.restriction_corrupt',
        );
        $this->deny(
            fn() => $this->change(action: 'release', expectedRevision: 1),
            'admin.restriction_corrupt',
        );
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 1);
    }

    public function test_unmounted_api_cannot_accept_client_supplied_admin_roles(): void
    {
        $this->postJson('/admin/v1/restrictions', [
            'actorRole' => 'owner',
            'mfaVerifiedAtMs' => PHP_INT_MAX,
            'targetId' => $this->accountId,
            'action' => 'restrict',
        ])->assertNotFound();
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 0);
    }
}
