<?php
declare(strict_types=1);

namespace Tests\Feature\Telemetry;

use App\Telemetry\DatabaseTelemetrySink;
use App\Telemetry\TelemetryCollector;
use App\Telemetry\TelemetryDecision;
use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class TelemetryDatabaseSinkTest extends TestCase
{
    use RefreshDatabase;

    private const KEY = 'PB3 TEST ONLY TELEMETRY HMAC SECRET, NO REAL KEY';
    private const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    private const EVENT_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    private const EVENT_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    private int $nowMs;

    protected function setUp(): void
    {
        parent::setUp();
        $this->nowMs = intdiv((int) floor(microtime(true) * 1000), 60000) * 60000;
    }

    private function send(
        string $account = self::ACCOUNT_A,
        string $eventId = self::EVENT_A,
        string $eventType = 'session.active',
        array $extra = [],
    ): TelemetryDecision {
        $collector = new TelemetryCollector(
            new DatabaseTelemetrySink(DB::connection()), self::KEY,
        );
        return $collector->ingest(array_merge([
            'schemaVersion' => 1,
            'eventId' => $eventId,
            'eventType' => $eventType,
            // Round to a stable minute for deterministic same-event fingerprint.
            'occurredAtMs' => $this->nowMs,
        ], $extra), $account, $this->nowMs);
    }

    private function countMetric(string $metric, string $periodKind): int
    {
        return (int) DB::table('telemetry_counters')->where('metric', $metric)
            ->where('period_kind', $periodKind)->sum('total');
    }

    public function test_atomic_duplicate_conflict_distinct_actors_and_privacy(): void
    {
        self::assertSame(TelemetryDecision::Accepted, $this->send());
        self::assertSame(TelemetryDecision::Duplicate, $this->send());
        self::assertSame(TelemetryDecision::Conflict, $this->send(eventType: 'media.photo.committed'));
        self::assertSame(TelemetryDecision::Accepted, $this->send(eventId: self::EVENT_B));
        self::assertSame(TelemetryDecision::Accepted, $this->send(account: self::ACCOUNT_B));

        self::assertSame(3, DB::table('telemetry_event_receipts')->count());
        self::assertSame(2, DB::table('telemetry_active_tokens')->where('period_kind', 'day')->count(), 'two daily HMAC actors');
        self::assertSame(6, DB::table('telemetry_active_tokens')->count());
        foreach (['day', 'week', 'month'] as $kind) {
            self::assertSame(3, $this->countMetric('session.active', $kind));
            self::assertSame(2, $this->countMetric('session.active.distinct', $kind));
            self::assertSame(0, $this->countMetric('media.photo.committed', $kind));
        }
        $allStored = json_encode([
            DB::table('telemetry_event_receipts')->get()->toArray(),
            DB::table('telemetry_counters')->get()->toArray(),
            DB::table('telemetry_active_tokens')->get()->toArray(),
        ], JSON_THROW_ON_ERROR);
        foreach ([self::ACCOUNT_A, self::ACCOUNT_B, self::EVENT_A, self::EVENT_B,
            self::KEY, 'GPS', 'filename', 'RecoveryKey', 'message content',
        ] as $private) {
            self::assertStringNotContainsString($private, $allStored);
        }
    }

    public function test_invalid_payload_is_not_recorded(): void
    {
        self::assertSame(TelemetryDecision::Rejected,
            $this->send(extra: ['filename' => 'secret.jpg']));
        self::assertSame(TelemetryDecision::Rejected,
            $this->send(extra: ['ip' => '127.0.0.1']));
        self::assertSame(0, DB::table('telemetry_event_receipts')->count());
        self::assertSame(0, DB::table('telemetry_counters')->count());
    }

    public function test_prune_removes_only_old_hmac_receipts_and_period_tokens(): void
    {
        self::assertSame(TelemetryDecision::Accepted, $this->send());
        $sink = new DatabaseTelemetrySink(DB::connection());
        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        self::assertSame(['receipts' => 0, 'actors' => 0], $sink->prune($now));
        $past = $now->sub(new DateInterval('P30D'));
        DB::table('telemetry_event_receipts')->update([
            'received_at' => $past->format('Y-m-d\\TH:i:s+00:00'),
        ]);
        foreach (['day' => '2020-01-01', 'week' => '2020-W01', 'month' => '2020-01'] as $kind => $old) {
            DB::table('telemetry_active_tokens')->where('period_kind', $kind)
                ->update(['period_key' => $old]);
        }
        $deleted = $sink->prune($now);
        self::assertSame(1, $deleted['receipts']);
        self::assertSame(3, $deleted['actors']);
        self::assertSame(0, DB::table('telemetry_active_tokens')->count());
        self::assertSame(3, DB::table('telemetry_counters')
            ->where('metric', 'session.active.distinct')->count());
        $this->expectException(\InvalidArgumentException::class);
        $sink->prune($now->add(new DateInterval('P90D')));
    }
}
