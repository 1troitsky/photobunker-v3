<?php
declare(strict_types=1);

namespace Tests\Feature\Events;

use App\Events\DatabaseEventInboxLedger;
use App\Events\EventAdmission;
use App\Events\EventConsumer;
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

    private function login(): void
    {
        $this->withSession([
            'identity_account' => $this->owner,
            'identity_device' => $this->actorDevice,
            'identity_issued' => time(),
        ])->withHeader('Origin', 'https://localhost');
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
    }

    public function test_self_revoke_invalidates_active_session(): void
    {
        $this->login();
        $this->postJson('/identity/v2/devices/'.$this->actorDevice.'/revoke', [])
            ->assertOk()->assertJsonPath('revoked', true);
        $this->getJson('/notifications/v1/events')->assertUnauthorized();
        $this->assertDatabaseHas('notification_event_ledger_v1', [
            'account_id' => $this->owner,
            'subject_id' => $this->actorDevice,
        ]);
    }
}
