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

final class NotificationEventsHttpTest extends TestCase
{
    use RefreshDatabase;

    private array $accounts = [];

    protected function setUp(): void
    {
        parent::setUp();
        foreach (['alice', 'bob'] as $name) {
            $account = (string) Str::uuid();
            $device = (string) Str::uuid();
            DB::table('identity_accounts')->insert([
                'id' => $account, 'operation_id' => (string) Str::uuid(),
                'prepare_hash' => str_repeat('a', 64), 'status' => 'ready',
                'reserved_until' => now()->addDay(),
                'created_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('identity_devices')->insert([
                'id' => $device, 'account_id' => $account,
                'signing_spki' => 'test-only', 'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->accounts[$name] = [$account, $device];
        }
    }

    private function login(string $name): void
    {
        [$account, $device] = $this->accounts[$name];
        $this->withSession([
            'identity_account' => $account,
            'identity_device' => $device,
            'identity_issued' => time(),
        ]);
    }

    private function publish(string $name, int $revision, ?string $subject = null): array
    {
        [$account] = $this->accounts[$name];
        $event = [
            'schemaVersion' => 1,
            'eventId' => (string) Str::uuid(),
            'eventType' => 'DeviceRevoked',
            'accountId' => $account,
            'subjectType' => 'device',
            'subjectId' => $subject ?? (string) Str::uuid(),
            'occurredAtMs' => 1800000000000,
            'revision' => $revision,
        ];
        return [$event, (new EventConsumer(new DatabaseEventInboxLedger()))
            ->ingest($event, $account)];
    }

    public function test_no_public_or_cross_tenant_event_feed(): void
    {
        $this->getJson('/notifications/v1/events')->assertUnauthorized();
        [$alice] = $this->publish('alice', 1);
        [$bob] = $this->publish('bob', 1);
        $this->login('alice');
        $response = $this->getJson('/notifications/v1/events')->assertOk()
            ->assertHeader('Cache-Control', 'no-store')
            ->assertJsonPath('schemaVersion', 1)
            ->assertJsonPath('hasMore', false);
        $this->assertSame([$alice['eventId']], array_column($response->json('items'), 'id'));
        $this->assertNotContains($bob['eventId'], array_column($response->json('items'), 'id'));
        $this->assertSame('security', $response->json('items.0.kind'));
        $this->assertNull($response->json('items.0.targetId'));
        $this->assertSame('1', $response->json('nextCursor'));
        $this->postJson('/notifications/v1/events', [])->assertStatus(405);
    }

    public function test_deferred_events_get_delivery_sequence_after_gap_closes(): void
    {
        $subject = (string) Str::uuid();
        [$second, $deferred] = $this->publish('alice', 2, $subject);
        $this->assertSame(EventAdmission::Deferred, $deferred);
        $this->login('alice');
        $this->getJson('/notifications/v1/events')->assertOk()
            ->assertJsonCount(0, 'items')->assertJsonPath('nextCursor', '0');
        [$first, $accepted] = $this->publish('alice', 1, $subject);
        $this->assertSame(EventAdmission::Accepted, $accepted);
        $firstPage = $this->getJson('/notifications/v1/events?after=0')->assertOk();
        $this->assertSame([$first['eventId'], $second['eventId']],
            array_column($firstPage->json('items'), 'id'));
        $this->assertSame('2', $firstPage->json('nextCursor'));
        $this->getJson('/notifications/v1/events?after=2')->assertOk()
            ->assertJsonCount(0, 'items')->assertJsonPath('nextCursor', '2');
    }

    public function test_pagination_and_untrusted_cursor_inputs(): void
    {
        for ($i = 0; $i < 52; $i++) {
            $this->assertSame(EventAdmission::Accepted,
                $this->publish('alice', 1)[1]);
        }
        $this->login('alice');
        $page = $this->getJson('/notifications/v1/events')->assertOk()
            ->assertJsonCount(50, 'items')->assertJsonPath('hasMore', true);
        $this->assertSame('50', $page->json('nextCursor'));
        $next = $this->getJson('/notifications/v1/events?after=50')->assertOk()
            ->assertJsonCount(2, 'items')->assertJsonPath('hasMore', false);
        $this->assertSame('52', $next->json('nextCursor'));
        foreach (['-1', '01', '1e3', '9007199254740992', 'bad'] as $invalid) {
            $this->getJson('/notifications/v1/events?after='.$invalid)->assertStatus(422);
        }
        $this->getJson('/notifications/v1/events?accountId='.
            $this->accounts['bob'][0])->assertStatus(422);
    }

    public function test_revoked_device_loses_access_to_feed(): void
    {
        $this->publish('alice', 1);
        $this->login('alice');
        $this->getJson('/notifications/v1/events')->assertOk();
        DB::table('identity_devices')->where('id', $this->accounts['alice'][1])
            ->update(['revoked_at' => now()]);
        $this->getJson('/notifications/v1/events')->assertUnauthorized();
    }
}
