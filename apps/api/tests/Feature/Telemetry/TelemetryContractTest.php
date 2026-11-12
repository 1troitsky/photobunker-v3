<?php
declare(strict_types=1);

namespace Tests\Feature\Telemetry;

use App\Telemetry\TelemetryCollector;
use App\Telemetry\TelemetryDecision;
use App\Telemetry\TelemetryRecord;
use App\Telemetry\TelemetrySink;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

/**
 * Deterministic in-memory model for contract assertions ONLY. No claim of
 * inter-process atomicity, persistence, delivery guarantees or real dashboards.
 */
final class ContractTelemetrySink implements TelemetrySink
{
    /** @var array<string,string> */
    public array $dedupe = [];
    /** @var array<string,int> */
    public array $counters = [];
    /** @var array<string,array<string,bool>> */
    public array $dailyActors = [];
    /** @var array<string,array<string,bool>> */
    public array $weeklyActors = [];
    /** @var array<string,array<string,bool>> */
    public array $monthlyActors = [];
    /** @var list<TelemetryRecord> */
    public array $received = [];

    public function admit(TelemetryRecord $record): TelemetryDecision
    {
        $token = $record->eventToken;
        $fingerprint = $record->fingerprint();
        if (isset($this->dedupe[$token])) {
            return hash_equals($this->dedupe[$token], $fingerprint)
                ? TelemetryDecision::Duplicate : TelemetryDecision::Conflict;
        }
        $this->dedupe[$token] = $fingerprint;
        $this->received[] = $record;
        $metric = $record->utcDay . ':' . $record->eventType;
        $this->counters[$metric] = ($this->counters[$metric] ?? 0) + 1;
        if ($record->eventType === 'session.active') {
            $this->dailyActors[$record->utcDay][$record->dailyActorToken] = true;
            $this->weeklyActors[$record->isoWeek][$record->weeklyActorToken] = true;
            $this->monthlyActors[$record->calendarMonth][$record->monthlyActorToken] = true;
        }
        return TelemetryDecision::Accepted;
    }

    public function dau(string $day): int
    {
        return count($this->dailyActors[$day] ?? []);
    }

    public function wau(string $isoWeek): int
    {
        return count($this->weeklyActors[$isoWeek] ?? []);
    }

    public function mau(string $month): int
    {
        return count($this->monthlyActors[$month] ?? []);
    }
}

final class TelemetryContractTest extends TestCase
{
    private const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    private const EVENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    private const KEY = 'PB3 test only HMAC secret with at least thirty-two bytes';
    private const NOW = 1800000000000;

    private function input(array $override = []): array
    {
        return array_replace([
            'schemaVersion' => 1,
            'eventId' => self::EVENT,
            'eventType' => 'session.active',
            'occurredAtMs' => self::NOW,
        ], $override);
    }

    private function collector(?ContractTelemetrySink &$sink): TelemetryCollector
    {
        $sink = new ContractTelemetrySink();
        return new TelemetryCollector($sink, self::KEY);
    }

    public function test_explicit_event_allowlist_accepts_only_safe_metric_types(): void
    {
        $collector = $this->collector($sink);
        $types = [
            'session.active', 'assignment.created',
            'media.photo.committed', 'media.video.committed',
            'media.audio.committed', 'upload.queued', 'upload.failed',
            'backup.verified', 'backup.failed', 'matrix.message.sent',
            'matrix.delivery.failed', 'storage.request.failed',
            'api.request.failed', 'device.revoked', 'subscription.changed',
        ];
        foreach ($types as $idx => $type) {
            $id = sprintf('11111111-1111-4111-8111-%012x', $idx + 1);
            self::assertSame(TelemetryDecision::Accepted, $collector->ingest(
                $this->input(['eventId' => $id, 'eventType' => $type]),
                self::A, self::NOW,
            ));
        }
        self::assertCount(count($types), $sink->received);
        foreach ($sink->received as $row) {
            self::assertMatchesRegularExpression('/^[a-f0-9]{64}$/D', $row->eventToken);
        }
    }

    public function test_rejects_secrets_user_and_media_metadata_and_malformed_fields(): void
    {
        $collector = $this->collector($sink);
        $mutations = [
            ['filename' => 'private.jpg'],
            ['folder' => 'medical'],
            ['gps' => ['lat' => 41.7, 'lon' => 41.5]],
            ['coordinates' => [41.7, 41.5]],
            ['ip' => '127.0.0.1'],
            ['accountId' => self::A],
            ['message' => 'Hello'],
            ['mediaId' => 'private'],
            ['RecoveryKey' => 'PRIVATE'],
            ['PIN' => '0000'],
            ['ciphertext' => 'secret'],
            ['payload' => ['sensitive' => true]],
            ['dimension' => 'high-cardinality'],
            ['planId' => 'unlimited+'],
            ['eventType' => 'custom.arbitrary'],
            ['eventType' => 'session.active.private'],
            ['schemaVersion' => '1'],
            ['schemaVersion' => 2],
            ['occurredAtMs' => '1800000000000'],
            ['occurredAtMs' => 0],
            ['occurredAtMs' => PHP_INT_MAX],
            ['eventId' => strtoupper(self::EVENT)],
            ['eventId' => 'INVALID'],
        ];
        foreach ($mutations as $mutation) {
            self::assertSame(
                TelemetryDecision::Rejected,
                $collector->ingest($this->input($mutation), self::A, self::NOW),
                'Rejected fields: '.implode(',', array_keys($mutation)),
            );
        }
        foreach ([null, 'secret', new \stdClass(), 100, [],
            ['eventId' => self::EVENT],
        ] as $invalid) {
            self::assertSame(TelemetryDecision::Rejected,
                $collector->ingest($invalid, self::A, self::NOW));
        }
        self::assertSame(TelemetryDecision::Rejected, $collector->ingest(
            $this->input(), 'INVALID ACCOUNT', self::NOW));
        self::assertSame(0, count($sink->received));
    }

    public function test_data_is_not_correlatable_by_plain_account_or_event_id(): void
    {
        $collector = $this->collector($sink);
        self::assertSame(TelemetryDecision::Accepted,
            $collector->ingest($this->input(), self::A, self::NOW));
        $record = $sink->received[0];
        $encoded = json_encode($record, JSON_THROW_ON_ERROR);
        foreach ([self::A, self::EVENT, (string)self::NOW, self::KEY,
            'RecoveryKey', 'filename', 'GPS', 'message', '127.0.0.1',
        ] as $unsafe) {
            self::assertStringNotContainsString($unsafe, $encoded);
        }
        self::assertSame(1, json_decode($encoded, true, 512, JSON_THROW_ON_ERROR)['version']);
        self::assertNotNull($record->dailyActorToken);
        self::assertNotNull($record->weeklyActorToken);
        self::assertNotNull($record->monthlyActorToken);
        self::assertNotSame($record->dailyActorToken, $record->weeklyActorToken);
        self::assertNotSame($record->weeklyActorToken, $record->monthlyActorToken);
        self::assertSame(9, count(json_decode($encoded, true, 512, JSON_THROW_ON_ERROR)));
    }

    public function test_duplicate_is_idempotent_mutated_event_is_conflict_and_other_account_is_isolated(): void
    {
        $collector = $this->collector($sink);
        self::assertSame(TelemetryDecision::Accepted,
            $collector->ingest($this->input(), self::A, self::NOW));
        self::assertSame(TelemetryDecision::Duplicate,
            $collector->ingest($this->input(), self::A, self::NOW));
        self::assertSame(TelemetryDecision::Conflict,
            $collector->ingest($this->input(['eventType' => 'media.photo.committed']), self::A, self::NOW));
        self::assertSame(TelemetryDecision::Accepted,
            $collector->ingest($this->input(), self::B, self::NOW));
        self::assertCount(2, $sink->received);
        self::assertSame(2, $sink->dau('2027-01-15')); // computed date checked separately
        self::assertNotSame($sink->received[0]->eventToken, $sink->received[1]->eventToken);
        self::assertNotSame($sink->received[0]->dailyActorToken, $sink->received[1]->dailyActorToken);
    }

    public function test_daily_weekly_monthly_unique_users_and_event_counts_are_distinct(): void
    {
        $collector = $this->collector($sink);
        $monday = (int)gmmktime(12, 0, 0, 12, 28, 2026) * 1000;
        $tuesday = (int)gmmktime(12, 0, 0, 12, 29, 2026) * 1000;
        $thursday = (int)gmmktime(12, 0, 0, 12, 31, 2026) * 1000;

        $base = ['eventType' => 'session.active'];
        $events = [
            [self::A, $monday, '11111111-1111-4111-8111-111111111111'],
            [self::A, $monday, '22222222-2222-4222-8222-222222222222'],
            [self::B, $monday, '33333333-3333-4333-8333-333333333333'],
            [self::A, $tuesday, '44444444-4444-4444-8444-444444444444'],
            [self::B, $thursday, '55555555-5555-4555-8555-555555555555'],
        ];
        foreach ($events as [$account, $time, $eventId]) {
            $payload = $this->input(array_replace($base, [
                'eventId' => $eventId, 'occurredAtMs' => $time,
            ]));
            self::assertSame(TelemetryDecision::Accepted,
                $collector->ingest($payload, $account, $thursday));
        }

        self::assertSame(2, $sink->dau('2026-12-28'));
        self::assertSame(1, $sink->dau('2026-12-29'));
        self::assertSame(1, $sink->dau('2026-12-31'));
        self::assertSame(2, $sink->wau('2026-W53'));
        self::assertSame(2, $sink->mau('2026-12'));
        self::assertSame(3, $sink->counters['2026-12-28:session.active']);

        $differentMonth = (int)gmmktime(12, 0, 0, 1, 1, 2027) * 1000;
        self::assertSame(TelemetryDecision::Accepted, $collector->ingest($this->input([
            'eventId' => '66666666-6666-4666-8666-666666666666',
            'occurredAtMs' => $differentMonth,
        ]), self::A, $differentMonth));
        self::assertSame(1, $sink->mau('2027-01'));
        self::assertSame(2, $sink->wau('2026-W53')); // Jan 1 shares the week: A/B remain two distinct users
    }

    public function test_only_activity_emits_actor_tokens_other_counters_remain_aggregate(): void
    {
        $collector = $this->collector($sink);
        $event = $this->input([
            'eventId' => '11111111-1111-4111-8111-111111111111',
            'eventType' => 'media.video.committed',
        ]);
        self::assertSame(TelemetryDecision::Accepted,
            $collector->ingest($event, self::A, self::NOW));
        $record = $sink->received[0];
        self::assertNull($record->dailyActorToken);
        self::assertNull($record->weeklyActorToken);
        self::assertNull($record->monthlyActorToken);
        self::assertSame(0, $sink->dau($record->utcDay));
        self::assertSame(1, $sink->counters[$record->utcDay.':media.video.committed']);
    }

    public function test_enforces_seven_day_retention_and_five_minute_future_window(): void
    {
        $collector = $this->collector($sink);
        self::assertSame(TelemetryDecision::Accepted, $collector->ingest($this->input([
            'occurredAtMs' => self::NOW - TelemetryCollector::MAX_PAST_MS,
        ]), self::A, self::NOW));
        self::assertSame(TelemetryDecision::OutsideWindow, $collector->ingest($this->input([
            'occurredAtMs' => self::NOW - TelemetryCollector::MAX_PAST_MS - 1,
        ]), self::A, self::NOW));
        self::assertSame(TelemetryDecision::Accepted, $collector->ingest($this->input([
            'eventId' => '22222222-2222-4222-8222-222222222222',
            'occurredAtMs' => self::NOW + TelemetryCollector::MAX_FUTURE_MS,
        ]), self::A, self::NOW));
        self::assertSame(TelemetryDecision::OutsideWindow, $collector->ingest($this->input([
            'occurredAtMs' => self::NOW + TelemetryCollector::MAX_FUTURE_MS + 1,
        ]), self::A, self::NOW));
        self::assertCount(2, $sink->received);
    }

    public function test_calendar_month_and_week_tokens_are_scope_limited(): void
    {
        $collector = $this->collector($sink);
        $dec31 = (int)gmmktime(12, 0, 0, 12, 31, 2020) * 1000;
        $jan1 = (int)gmmktime(12, 0, 0, 1, 1, 2021) * 1000;
        self::assertSame(TelemetryDecision::Accepted, $collector->ingest(
            $this->input(['occurredAtMs' => $dec31]), self::A, $dec31));
        self::assertSame(TelemetryDecision::Accepted, $collector->ingest(
            $this->input(['eventId' => '11111111-1111-4111-8111-111111111111',
                'occurredAtMs' => $jan1]), self::A, $jan1));
        [$a, $b] = $sink->received;
        self::assertSame($a->isoWeek, $b->isoWeek);
        self::assertSame('2020-W53', $a->isoWeek);
        self::assertNotSame($a->calendarMonth, $b->calendarMonth);
        self::assertNotSame($a->monthlyActorToken, $b->monthlyActorToken);
        self::assertSame($a->weeklyActorToken, $b->weeklyActorToken);
    }

    public function test_disallows_missing_or_short_hmac_keys(): void
    {
        $this->expectExceptionMessage('telemetry.weak_secret');
        new TelemetryCollector(new ContractTelemetrySink(), 'short');
    }
}
