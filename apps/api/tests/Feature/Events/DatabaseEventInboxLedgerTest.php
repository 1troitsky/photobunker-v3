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

final class DatabaseEventInboxLedgerTest extends TestCase
{
    use RefreshDatabase;

    private string $account;
    private string $subject;
    private EventConsumer $consumer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->account = (string) Str::uuid();
        $this->subject = (string) Str::uuid();
        DB::table('identity_accounts')->insert([
            'id' => $this->account,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'reserved_until' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->consumer = new EventConsumer(new DatabaseEventInboxLedger());
    }

    private function event(int $revision, ?string $id = null): array
    {
        return [
            'schemaVersion' => 1,
            'eventId' => $id ?? (string) Str::uuid(),
            'eventType' => 'MediaCommitted',
            'accountId' => $this->account,
            'subjectType' => 'media',
            'subjectId' => $this->subject,
            'occurredAtMs' => 1800000000000,
            'revision' => $revision,
        ];
    }

    public function test_gap_is_persisted_then_sequenced_after_missing_event_arrives(): void
    {
        $third = $this->event(3);
        $second = $this->event(2);
        self::assertSame(EventAdmission::Deferred, $this->consumer->ingest($third, $this->account));
        self::assertSame(EventAdmission::Deferred, $this->consumer->ingest($second, $this->account));
        self::assertSame(2, DB::table('notification_event_ledger_v1')
            ->where('admission_state', 'deferred')->count());

        // Simulated process restart: new consumer, same persistent DB.
        $restarted = new EventConsumer(new DatabaseEventInboxLedger());
        self::assertSame(EventAdmission::Accepted,
            $restarted->ingest($this->event(1), $this->account));
        self::assertSame(3, DB::table('notification_event_streams_v1')
            ->where('account_id', $this->account)->value('contiguous_revision'));
        self::assertSame(0, DB::table('notification_event_ledger_v1')
            ->where('admission_state', 'deferred')->count());
        self::assertSame(EventAdmission::Duplicate, $restarted->ingest($third, $this->account));
        self::assertSame(EventAdmission::Duplicate, $restarted->ingest($second, $this->account));
    }

    public function test_modified_replay_and_same_revision_are_conflicts(): void
    {
        $first = $this->event(1);
        self::assertSame(EventAdmission::Accepted, $this->consumer->ingest($first, $this->account));
        self::assertSame(EventAdmission::Duplicate, $this->consumer->ingest($first, $this->account));
        self::assertSame(EventAdmission::Conflict, $this->consumer->ingest(
            [...$first, 'occurredAtMs' => 1800000000001], $this->account));
        self::assertSame(EventAdmission::Conflict,
            $this->consumer->ingest($this->event(1), $this->account));
        self::assertSame(1, DB::table('notification_event_ledger_v1')->count());
    }

    public function test_cross_account_and_payload_injection_never_write(): void
    {
        $event = $this->event(1);
        self::assertSame(EventAdmission::Quarantined,
            $this->consumer->ingest($event, (string) Str::uuid()));
        self::assertSame(EventAdmission::Quarantined,
            $this->consumer->ingest([...$event, 'gps' => 'PRIVATE'], $this->account));
        self::assertSame(0, DB::table('notification_event_ledger_v1')->count());
    }

    public function test_far_future_revision_is_quarantined_without_storage(): void
    {
        self::assertSame(EventAdmission::Quarantined,
            $this->consumer->ingest($this->event(130), $this->account));
        self::assertSame(0, DB::table('notification_event_ledger_v1')->count());
    }

    public function test_inactive_account_is_not_admitted(): void
    {
        DB::table('identity_accounts')->where('id', $this->account)
            ->update(['status' => 'reserved']);
        self::assertSame(EventAdmission::Quarantined,
            $this->consumer->ingest($this->event(1), $this->account));
        self::assertSame(0, DB::table('notification_event_ledger_v1')->count());
    }
}
