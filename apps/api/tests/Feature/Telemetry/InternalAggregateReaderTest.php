<?php
declare(strict_types=1);

namespace Tests\Feature\Telemetry;

use App\Telemetry\DatabaseTelemetrySink;
use App\Telemetry\InternalAggregateReader;
use App\Telemetry\TelemetryCollector;
use App\Telemetry\TelemetryDecision;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use RuntimeException;
use Tests\TestCase;

final class InternalAggregateReaderTest extends TestCase
{
    use RefreshDatabase;

    private const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    private const SECRET = 'PB3 only test aggregate reader secret, not real keys';

    private function reader(): InternalAggregateReader
    {
        return new InternalAggregateReader(DB::connection());
    }

    private function admit(
        string $account, string $eventId, string $metric, string $at,
    ): void {
        $ms = CarbonImmutable::parse($at)->getTimestampMs();
        $collector = new TelemetryCollector(
            new DatabaseTelemetrySink(DB::connection()), self::SECRET,
        );
        self::assertSame(TelemetryDecision::Accepted, $collector->ingest([
            'schemaVersion' => 1,
            'eventId' => $eventId,
            'eventType' => $metric,
            'occurredAtMs' => $ms,
        ], $account, $ms));
    }

    public function test_real_stored_events_produce_only_sparse_utc_counters_and_never_raw_ids(): void
    {
        // 2025-12-31 and 2026-01-01 belong to ISO week-year 2026-W01.
        $this->admit(self::ACCOUNT_A, '11111111-1111-4111-8111-111111111111',
            'assignment.created', '2025-12-31T09:00:00Z');
        $this->admit(self::ACCOUNT_B, '22222222-2222-4222-8222-222222222222',
            'assignment.created', '2026-01-01T09:00:00Z');
        $this->admit(self::ACCOUNT_A, '33333333-3333-4333-8333-333333333333',
            'session.active', '2025-12-31T11:00:00Z');
        $this->admit(self::ACCOUNT_A, '44444444-4444-4444-8444-444444444444',
            'session.active', '2026-01-01T11:00:00Z');
        $this->admit(self::ACCOUNT_B, '55555555-5555-4555-8555-555555555555',
            'session.active', '2026-01-01T11:00:00Z');

        $reader = $this->reader();
        $days = $reader->read('assignment.created', 'day', '2025-12-30', '2026-01-02');
        self::assertSame('not_proven', $days['sourceCoverage']);
        self::assertSame([
            ['period' => '2025-12-31', 'count' => 1],
            ['period' => '2026-01-01', 'count' => 1],
        ], $days['points']);
        self::assertSame([
            ['period' => '2026-W01', 'count' => 2],
        ], $reader->read('assignment.created', 'week', '2025-W52', '2026-W02')['points']);
        self::assertSame([
            ['period' => '2025-12', 'count' => 1],
            ['period' => '2026-01', 'count' => 1],
        ], $reader->read('assignment.created', 'month', '2025-12', '2026-01')['points']);
        self::assertSame([
            ['period' => '2026-W01', 'count' => 2],
        ], $reader->read('session.active.distinct', 'week', '2026-W01', '2026-W01')['points']);
        self::assertSame([], $reader->read(
            'media.audio.committed', 'day', '2026-01-01', '2026-01-02',
        )['points'], 'no observed events is UNKNOWN, never a fabricated zero');

        $json = json_encode([$days, $reader->read(
            'session.active.distinct', 'week', '2026-W01', '2026-W01',
        )], JSON_THROW_ON_ERROR);
        foreach ([self::ACCOUNT_A, self::ACCOUNT_B, self::SECRET,
            '11111111-1111', '22222222-2222', 'actor_token', 'event_token',
        ] as $private) {
            self::assertStringNotContainsString($private, $json);
        }
    }

    public function test_unknown_metrics_invalid_utc_and_overwide_windows_are_rejected(): void
    {
        $reader = $this->reader();
        $requests = [
            ['assignment.created OR 1=1', 'day', '2026-11-01', '2026-11-02'],
            ['device.location', 'day', '2026-11-01', '2026-11-02'],
            ['assignment.created', 'hour', '2026-11-01', '2026-11-02'],
            ['assignment.created', 'day', '2026-02-30', '2026-03-01'],
            ['assignment.created', 'day', '2026-11-10Z', '2026-11-12'],
            ['assignment.created', 'day', '2026-11-12', '2026-11-11'],
            ['assignment.created', 'day', '2026-01-01', '2026-02-02'],
            ['assignment.created', 'week', '2025-W53', '2026-W01'],
            ['assignment.created', 'week', '2026-W00', '2026-W01'],
            ['assignment.created', 'week', '2026-W01', '2026-W15'],
            ['assignment.created', 'month', '2026-00', '2026-01'],
            ['assignment.created', 'month', '2026-01', '2027-02'],
        ];
        foreach ($requests as [$metric, $kind, $from, $to]) {
            try {
                $reader->read($metric, $kind, $from, $to);
                self::fail('invalid reader request was not rejected');
            } catch (InvalidArgumentException $e) {
                self::assertContains($e->getMessage(), [
                    'telemetry.reader_invalid_metric',
                    'telemetry.reader_invalid_period',
                    'telemetry.reader_invalid_window',
                ]);
            }
        }
        self::assertSame(0, DB::table('telemetry_event_receipts')->count());
        self::assertSame(0, DB::table('telemetry_counters')->count());
    }

    public function test_corrupt_counter_fails_closed_without_reporting_a_misleading_total(): void
    {
        DB::table('telemetry_counters')->insert([
            'metric' => 'assignment.created',
            'period_kind' => 'day', 'period_key' => '2026-01-02',
            'total' => 1,
        ]);
        $reader = $this->reader();
        DB::table('telemetry_counters')->where('metric', 'assignment.created')
            ->update(['total' => -5]);

        try {
            $reader->read('assignment.created', 'day', '2026-01-01', '2026-01-03');
            self::fail('corrupt negative counter must throw');
        } catch (RuntimeException $e) {
            self::assertSame('telemetry.reader_invalid_counter', $e->getMessage());
        }
    }
}
