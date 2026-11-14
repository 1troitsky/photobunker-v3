<?php
declare(strict_types=1);

namespace Tests\Feature\Telemetry;

use App\Telemetry\AssignmentCoverageAudit;
use App\Telemetry\DatabaseTelemetrySink;
use App\Telemetry\InternalAggregateReader;
use App\Telemetry\TelemetryCollector;
use App\Telemetry\TelemetryDecision;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Tests\TestCase;

final class AssignmentCoverageAuditTest extends TestCase
{
    use RefreshDatabase;

    private const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const SECRET = 'PB3 disposable coverage audit HMAC key, not production';

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('identity_accounts')->insert([
            'id' => self::ACCOUNT,
            'operation_id' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'prepare_hash' => str_repeat('a', 64), 'status' => 'ready',
            'reserved_until' => now()->addDay(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function audit(): AssignmentCoverageAudit
    {
        $db = DB::connection();
        return new AssignmentCoverageAudit($db, new InternalAggregateReader($db));
    }

    private function source(int $n, CarbonImmutable $when): void
    {
        DB::table('assignment_creation_meter_v1')->insert([
            'assignment_id' => sprintf('11111111-1111-4111-8111-%012d', $n),
            'operation_id' => sprintf('22222222-2222-4222-8222-%012d', $n),
            'owner_account_id' => self::ACCOUNT,
            'created_at' => $when->format('Y-m-d H:i:s.u'),
        ]);
    }

    private function admit(int $n, CarbonImmutable $at): void
    {
        $ms = $at->getTimestampMs();
        $result = (new TelemetryCollector(
            new DatabaseTelemetrySink(DB::connection()), self::SECRET,
        ))->ingest([
            'schemaVersion' => 1,
            'eventId' => sprintf('22222222-2222-4222-8222-%012d', $n),
            'eventType' => 'assignment.created',
            'occurredAtMs' => $ms,
        ], self::ACCOUNT, CarbonImmutable::now('UTC')->getTimestampMs());
        self::assertSame(TelemetryDecision::Accepted, $result);
    }

    public function test_real_ledger_shortfall_missing_excess_and_count_match_are_never_coverage_proof(): void
    {
        $now = CarbonImmutable::now('UTC')->startOfSecond();
        $yesterday = $now->startOfDay()->subDay()->addHours(10);
        $before = $yesterday->subDay();
        $this->source(1, $before);
        $this->source(2, $yesterday);
        $this->source(3, $yesterday->addHour());

        $start = $before->format('Y-m-d');
        $end = $yesterday->format('Y-m-d');
        $audit = $this->audit();
        $empty = $audit->compare($now->getTimestampMs(), $start, $end);
        self::assertFalse($empty['coverageProven']);
        self::assertSame('provisional_count_comparison', $empty['consistency']);
        self::assertSame('missing_ingestion', $empty['days'][0]['status']);
        self::assertSame('missing_ingestion', $empty['days'][1]['status']);
        self::assertNull($empty['days'][1]['observedCount']);
        self::assertSame(2, $empty['days'][1]['sourceCount']);

        $this->admit(1, $before);
        $this->admit(2, $yesterday);
        $partial = $audit->compare($now->getTimestampMs(), $start, $end);
        self::assertSame('counts_match_unverified', $partial['days'][0]['status']);
        self::assertSame('shortfall_provisional', $partial['days'][1]['status']);
        self::assertSame(1, $partial['days'][1]['observedCount']);

        $this->admit(3, $yesterday->addHour());
        $match = $audit->compare($now->getTimestampMs(), $start, $end);
        self::assertSame('counts_match_unverified', $match['days'][1]['status']);
        self::assertFalse($match['coverageProven']);
        // An internally trusted but non-ledger event can inflate aggregate
        // counts; equality alone can never prove true event-source lineage.
        $this->admit(4, $yesterday->addHours(2));
        $excess = $audit->compare($now->getTimestampMs(), $start, $end);
        self::assertSame('excess_untrusted', $excess['days'][1]['status']);
        self::assertSame(3, $excess['days'][1]['observedCount']);

        $encoded = json_encode([$empty, $partial, $match, $excess], JSON_THROW_ON_ERROR);
        foreach ([self::ACCOUNT, self::SECRET, '11111111-1111',
            '22222222-2222', 'operationId', 'eventToken', 'actor_token',
        ] as $private) {
            self::assertStringNotContainsString($private, $encoded);
        }
    }

    public function test_empty_real_source_is_no_evidence_and_never_a_proven_zero(): void
    {
        $now = CarbonImmutable::now('UTC');
        $key = $now->startOfDay()->subDay()->format('Y-m-d');
        $result = $this->audit()->compare($now->getTimestampMs(), $key, $key);
        self::assertSame('no_evidence', $result['days'][0]['status']);
        self::assertSame(0, $result['days'][0]['sourceCount']);
        self::assertNull($result['days'][0]['observedCount']);
        self::assertFalse($result['coverageProven']);
    }

    public function test_invalid_clock_partial_or_expired_windows_are_rejected_without_any_write(): void
    {
        $now = CarbonImmutable::now('UTC');
        $yesterday = $now->startOfDay()->subDay();
        $tooOld = $now->startOfDay()->subDays(7)->format('Y-m-d');
        $end = $yesterday->format('Y-m-d');
        foreach ([
            [0, $end, $end],
            [$now->addHours(2)->getTimestampMs(), $end, $end],
            [$now->getTimestampMs(), $tooOld, $end],
            [$now->getTimestampMs(), $end, $now->format('Y-m-d')],
            [$now->getTimestampMs(), '2026-02-30', $end],
            [$now->getTimestampMs(), '2026-11-01;DROP', $end],
            [$now->getTimestampMs(), $end, $tooOld],
        ] as [$ms, $from, $to]) {
            try {
                $this->audit()->compare($ms, $from, $to);
                self::fail('invalid/partial day accepted');
            } catch (InvalidArgumentException $error) {
                self::assertContains($error->getMessage(), [
                    'telemetry.coverage_invalid_clock',
                    'telemetry.coverage_invalid_window',
                ]);
            }
        }
        self::assertSame(0, DB::table('telemetry_event_receipts')->count());
        self::assertSame(0, DB::table('telemetry_counters')->count());
    }
}
