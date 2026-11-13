<?php
declare(strict_types=1);

namespace Tests\Feature\Events;

use App\Events\DatabaseEventInboxLedger;
use App\Events\EventAdmission;
use App\Events\EventConsumer;
use App\Events\PushDeviceSubscriptionRegistry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class DeviceRevokedNotificationTest extends TestCase
{
    use RefreshDatabase;

    private string $owner;
    private string $actorDevice;
    private string $otherDevice;
    private string $foreignAccount;
    private string $foreignDevice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = $this->account();
        $this->foreignAccount = $this->account();
        $this->actorDevice = $this->device($this->owner);
        $this->otherDevice = $this->device($this->owner);
        $this->foreignDevice = $this->device($this->foreignAccount);
    }

    private function account(): string
    {
        $id = (string) Str::uuid();
        DB::table('identity_accounts')->insert([
            'id' => $id, 'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64), 'status' => 'ready',
            'reserved_until' => now()->addDay(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        return $id;
    }

    private function device(string $accountId): string
    {
        $id = (string) Str::uuid();
        DB::table('identity_devices')->insert([
            'id' => $id, 'account_id' => $accountId,
            'signing_spki' => 'test-only', 'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $id;
    }

    /** @return array{endpoint:string,p256dh:string,auth:string} */
    private function pushSubscription(string $suffix): array
    {
        $encode = static fn (string $plain): string =>
            rtrim(strtr(base64_encode($plain), '+/', '-_'), '=');
        return [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/'.$suffix,
            'p256dh' => $encode("\x04".str_repeat('p', 64)),
            'auth' => $encode(str_repeat('s', 16)),
        ];
    }

    private function login(): void
    {
        $this->withSession([
            'identity_account' => $this->owner,
            'identity_device' => $this->actorDevice,
            'identity_issued' => time(),
        ])->withHeader('Origin', 'https://localhost');
    }

    public function test_real_device_revoke_erases_only_its_encrypted_push_credentials(): void
    {
        $push = new PushDeviceSubscriptionRegistry();
        $push->put($this->owner, $this->otherDevice, $this->pushSubscription('victim'));
        $push->put($this->owner, $this->actorDevice, $this->pushSubscription('actor'));
        $push->put($this->foreignAccount, $this->foreignDevice, $this->pushSubscription('foreign'));
        $this->assertDatabaseCount('notification_push_subscriptions_v1', 3);

        $this->login();
        $this->postJson('/identity/v2/devices/'.$this->otherDevice.'/revoke', [])
            ->assertOk()->assertJsonPath('revoked', true);

        $this->assertDatabaseMissing('notification_push_subscriptions_v1', [
            'device_id' => $this->otherDevice,
        ]);
        $this->assertDatabaseHas('notification_push_subscriptions_v1', [
            'account_id' => $this->owner, 'device_id' => $this->actorDevice,
            'disabled_at' => null,
        ]);
        $this->assertDatabaseHas('notification_push_subscriptions_v1', [
            'account_id' => $this->foreignAccount, 'device_id' => $this->foreignDevice,
            'disabled_at' => null,
        ]);
        self::assertFalse($push->eligible($this->owner, $this->otherDevice));
        self::assertTrue($push->eligible($this->owner, $this->actorDevice));
        self::assertTrue($push->eligible($this->foreignAccount, $this->foreignDevice));
        $this->getJson('/notifications/v1/events')->assertOk()
            ->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.kind', 'security');
    }

    public function test_failed_auth_and_origin_never_purge_other_device_push_secret(): void
    {
        $push = new PushDeviceSubscriptionRegistry();
        $push->put($this->owner, $this->otherDevice, $this->pushSubscription('protected'));

        $this->withHeader('Origin','https://localhost');
        $this->postJson('/identity/v2/devices/'.$this->otherDevice.'/revoke', [])
            ->assertUnauthorized();
        $this->login();
        $this->postJson('/identity/v2/devices/'.$this->foreignDevice.'/revoke', [])
            ->assertNotFound();
        $this->withHeader('Origin','https://wrong.example');
        $this->postJson('/identity/v2/devices/'.$this->otherDevice.'/revoke', [])
            ->assertForbidden();

        $this->assertDatabaseHas('notification_push_subscriptions_v1', [
            'account_id' => $this->owner, 'device_id' => $this->otherDevice,
            'disabled_at' => null,
        ]);
        self::assertTrue($push->eligible($this->owner, $this->otherDevice));
        $this->assertDatabaseCount('notification_event_ledger_v1', 0);
    }

    public function test_authenticated_revoke_publishes_exactly_one_generic_security_event(): void
    {
        $this->login();
        $this->postJson('/identity/v2/devices/'.$this->otherDevice.'/revoke', [])
            ->assertOk()->assertJsonPath('revoked', true);
        $this->assertNotNull(DB::table('identity_devices')
            ->where('id', $this->otherDevice)->value('revoked_at'));
        $this->assertDatabaseHas('notification_event_ledger_v1', [
            'account_id' => $this->owner, 'subject_type' => 'device',
            'subject_id' => $this->otherDevice,
            'revision' => 1, 'admission_state' => 'sequenced',
        ]);
        $this->getJson('/notifications/v1/events')->assertOk()
            ->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.kind', 'security')
            ->assertJsonPath('items.0.targetId', null);
        $this->postJson('/identity/v2/devices/'.$this->otherDevice.'/revoke', [])
            ->assertNotFound();
        $this->assertDatabaseCount('notification_event_ledger_v1', 1);
    }

    public function test_cross_account_and_missing_origin_cannot_revoke_or_emit(): void
    {
        // Supply the valid Origin so this assertion isolates missing auth,
        // rather than correctly failing the Origin gate first.
        $this->withHeader('Origin','https://localhost');
        $this->postJson('/identity/v2/devices/'.$this->otherDevice.'/revoke', [])
            ->assertUnauthorized();
        $this->login();
        $this->postJson('/identity/v2/devices/'.$this->foreignDevice.'/revoke', [])
            ->assertNotFound();
        $this->withHeader('Origin', 'https://wrong.example');
        $this->postJson('/identity/v2/devices/'.$this->otherDevice.'/revoke', [])
            ->assertForbidden();
        $this->assertDatabaseCount('notification_event_ledger_v1', 0);
        $this->assertNull(DB::table('identity_devices')
            ->where('id', $this->otherDevice)->value('revoked_at'));
    }

    public function test_event_collision_cannot_keep_compromised_device_active(): void
    {
        $push = new PushDeviceSubscriptionRegistry();
        $push->put($this->owner, $this->otherDevice, $this->pushSubscription('collision'));
        $this->login();
        $event = [
            'schemaVersion' => 1, 'eventId' => (string) Str::uuid(),
            'eventType' => 'DeviceRevoked', 'accountId' => $this->owner,
            'subjectType' => 'device', 'subjectId' => $this->otherDevice,
            'occurredAtMs' => now()->getTimestampMs(), 'revision' => 1,
        ];
        self::assertSame(EventAdmission::Accepted,
            (new EventConsumer(new DatabaseEventInboxLedger()))
                ->ingest($event, $this->owner));
        $this->postJson('/identity/v2/devices/'.$this->otherDevice.'/revoke', [])
            ->assertOk()->assertJsonPath('revoked', true);
        $this->assertNotNull(DB::table('identity_devices')
            ->where('id', $this->otherDevice)->value('revoked_at'));
        $this->assertDatabaseCount('notification_event_ledger_v1', 1);
        $this->assertDatabaseMissing('notification_push_subscriptions_v1', [
            'device_id' => $this->otherDevice,
        ]);
        self::assertFalse($push->eligible($this->owner, $this->otherDevice));
    }

    public function test_self_revoke_invalidates_active_session(): void
    {
        $push = new PushDeviceSubscriptionRegistry();
        $push->put($this->owner, $this->actorDevice, $this->pushSubscription('self-revoke'));
        $this->login();
        $this->postJson('/identity/v2/devices/'.$this->actorDevice.'/revoke', [])
            ->assertOk()->assertJsonPath('revoked', true);
        $this->getJson('/notifications/v1/events')->assertUnauthorized();
        $this->assertDatabaseMissing('notification_push_subscriptions_v1', [
            'device_id' => $this->actorDevice,
        ]);
        self::assertFalse($push->eligible($this->owner, $this->actorDevice));
        $this->assertDatabaseHas('notification_event_ledger_v1', [
            'account_id' => $this->owner,
            'subject_id' => $this->actorDevice,
        ]);
    }
}
