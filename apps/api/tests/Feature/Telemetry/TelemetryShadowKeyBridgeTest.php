<?php
declare(strict_types=1);

namespace Tests\Feature\Telemetry;

use App\Telemetry\DatabaseTelemetrySink;
use App\Telemetry\TelemetryCollector;
use App\Telemetry\TelemetryDecision;
use App\Telemetry\TelemetryEvent;
use App\Telemetry\TelemetryRecord;
use App\Telemetry\TelemetryShadowKeyBridge;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use RuntimeException;
use Tests\TestCase;

final class TelemetryShadowKeyBridgeTest extends TestCase
{
    use RefreshDatabase;

    private const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const OLD = 'PB3 TEST ONLY canonical old HMAC secret, no production';
    private const NEW = 'PB3 TEST ONLY candidate shadow HMAC secret, no production';

    private function nowMs(): int
    {
        return CarbonImmutable::now('UTC')->getTimestampMs();
    }

    private function bridge(): TelemetryShadowKeyBridge
    {
        return new TelemetryShadowKeyBridge(DB::connection(), self::OLD, self::NEW);
    }

    private function event(int $id = 1, string $metric = 'session.active'): array
    {
        return [
            'schemaVersion' => 1,
            'eventId' => sprintf('11111111-1111-4111-8111-%012d', $id),
            'eventType' => $metric,
            'occurredAtMs' => $this->nowMs(),
        ];
    }

    private function collector(string $secret): TelemetryCollector
    {
        return new TelemetryCollector(
            new DatabaseTelemetrySink(DB::connection()), $secret,
        );
    }

    private function record(array $event, string $secret): TelemetryRecord
    {
        return TelemetryRecord::fromTrusted(
            TelemetryEvent::fromArray($event), self::ACCOUNT, $secret,
        );
    }

    private function total(string $metric, string $kind = 'day'): int
    {
        return (int) DB::table('telemetry_counters')
            ->where('metric', $metric)->where('period_kind', $kind)->sum('total');
    }

    public function test_shadow_alias_is_atomic_uncounted_and_preserves_old_actor_domain(): void
    {
        $first = $this->event(1);
        $bridge = $this->bridge();
        self::assertSame(TelemetryDecision::Accepted,
            $bridge->admit($first, self::ACCOUNT, $this->nowMs()));
        self::assertSame(TelemetryDecision::Duplicate,
            $bridge->admit($first, self::ACCOUNT, $this->nowMs()));
        self::assertSame(TelemetryDecision::Duplicate,
            $this->collector(self::OLD)->ingest($first, self::ACCOUNT, $this->nowMs()));
        self::assertSame(TelemetryDecision::Duplicate,
            $this->collector(self::NEW)->ingest($first, self::ACCOUNT, $this->nowMs()));

        $second = $this->event(2);
        self::assertSame(TelemetryDecision::Accepted,
            $bridge->admit($second, self::ACCOUNT, $this->nowMs()));
        self::assertSame(4, DB::table('telemetry_event_receipts')->count());
        foreach (['day', 'week', 'month'] as $kind) {
            self::assertSame(2, $this->total('session.active', $kind));
            self::assertSame(1, $this->total('session.active.distinct', $kind));
        }
        self::assertSame(3, DB::table('telemetry_active_tokens')->count());
        $old = $this->record($second, self::OLD);
        $candidate = $this->record($second, self::NEW);
        self::assertSame($old->fingerprint(), DB::table('telemetry_event_receipts')
            ->where('event_token', $old->eventToken)->value('fingerprint'));
        self::assertSame($candidate->fingerprint(), DB::table('telemetry_event_receipts')
            ->where('event_token', $candidate->eventToken)->value('fingerprint'));
        self::assertFalse(DB::table('telemetry_active_tokens')
            ->where('actor_token', $candidate->dailyActorToken)->exists(),
            'a candidate-only actor token must NOT silently replace the canonical distinct domain');
    }

    public function test_old_only_legacy_writer_can_be_shadowed_without_incrementing_again(): void
    {
        $event = $this->event(3, 'assignment.created');
        self::assertSame(TelemetryDecision::Accepted,
            $this->collector(self::OLD)->ingest($event, self::ACCOUNT, $this->nowMs()));
        self::assertSame(TelemetryDecision::Duplicate,
            $this->bridge()->admit($event, self::ACCOUNT, $this->nowMs()));
        self::assertSame(TelemetryDecision::Duplicate,
            $this->collector(self::NEW)->ingest($event, self::ACCOUNT, $this->nowMs()));
        self::assertSame(2, DB::table('telemetry_event_receipts')->count());
        foreach (['day', 'week', 'month'] as $kind) {
            self::assertSame(1, $this->total('assignment.created', $kind));
        }
    }

    public function test_candidate_only_unbridged_receipt_refuses_old_admission_without_mutation(): void
    {
        $event = $this->event(4, 'assignment.created');
        self::assertSame(TelemetryDecision::Accepted,
            $this->collector(self::NEW)->ingest($event, self::ACCOUNT, $this->nowMs()));
        $before = DB::table('telemetry_event_receipts')->count();
        try {
            $this->bridge()->admit($event, self::ACCOUNT, $this->nowMs());
            self::fail('candidate-only receipt must not be treated as harmless alias');
        } catch (RuntimeException $e) {
            self::assertSame('telemetry.shadow_orphan_candidate', $e->getMessage());
        }
        self::assertSame($before, DB::table('telemetry_event_receipts')->count());
        self::assertSame(1, $this->total('assignment.created'));
        self::assertFalse(DB::table('telemetry_event_receipts')
            ->where('event_token', $this->record($event, self::OLD)->eventToken)->exists());
    }

    public function test_conflicting_fingerprint_invalid_events_keys_and_stale_window_fail_closed(): void
    {
        $event = $this->event(5, 'assignment.created');
        self::assertSame(TelemetryDecision::Accepted,
            $this->bridge()->admit($event, self::ACCOUNT, $this->nowMs()));
        $shadow = $this->record($event, self::NEW);
        DB::table('telemetry_event_receipts')
            ->where('event_token', $shadow->eventToken)
            ->update(['fingerprint' => str_repeat('f', 64)]);
        $before = DB::table('telemetry_event_receipts')->count();
        self::assertSame(TelemetryDecision::Conflict,
            $this->bridge()->admit($event, self::ACCOUNT, $this->nowMs()));
        self::assertSame($before, DB::table('telemetry_event_receipts')->count());
        self::assertSame(1, $this->total('assignment.created'));
        self::assertSame(TelemetryDecision::Rejected,
            $this->bridge()->admit($event + ['userId' => self::ACCOUNT],
                self::ACCOUNT, $this->nowMs()));
        self::assertSame(TelemetryDecision::Rejected,
            $this->bridge()->admit($event, 'not-a-uuid', $this->nowMs()));
        self::assertSame(TelemetryDecision::OutsideWindow,
            $this->bridge()->admit($event, self::ACCOUNT,
                $this->nowMs() + TelemetryCollector::MAX_PAST_MS + 1000));

        foreach ([
            ['short', self::NEW],
            [self::OLD, 'short'],
            [self::OLD, self::OLD],
        ] as [$old, $new]) {
            try {
                new TelemetryShadowKeyBridge(DB::connection(), $old, $new);
                self::fail('unsafe shadow bridge secret admitted');
            } catch (InvalidArgumentException $e) {
                self::assertSame('telemetry.shadow_invalid_secrets', $e->getMessage());
            }
        }
    }
}
