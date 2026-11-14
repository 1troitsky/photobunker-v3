<?php
declare(strict_types=1);

namespace Tests\Feature\Telemetry;

use App\Telemetry\AssignmentReceiptLineageAudit;
use App\Telemetry\DatabaseTelemetrySink;
use App\Telemetry\TelemetryCollector;
use App\Telemetry\TelemetryDecision;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Tests\TestCase;

final class AssignmentReceiptLineageAuditTest extends TestCase
{
    use RefreshDatabase;

    private const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const SECRET = 'PB3 TEST ONLY lineage HMAC secret, never production';

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('identity_accounts')->insert([
            'id' => self::ACCOUNT,
            'operation_id' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready', 'reserved_until' => now()->addDay(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function at(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC')->startOfDay()->subDay()->addHours(12);
    }

    private function create(int $n, CarbonImmutable $at): void
    {
        DB::table('assignment_creation_meter_v1')->insert([
            'assignment_id' => sprintf('11111111-1111-4111-8111-%012d', $n),
            'operation_id' => sprintf('22222222-2222-4222-8222-%012d', $n),
            'owner_account_id' => self::ACCOUNT,
            'created_at' => $at->format('Y-m-d H:i:s.u'),
        ]);
    }

    private function ingest(int $n, CarbonImmutable $at, string $metric = 'assignment.created'): void
    {
        $decision = (new TelemetryCollector(
            new DatabaseTelemetrySink(DB::connection()), self::SECRET,
        ))->ingest([
            'schemaVersion' => 1,
            'eventId' => sprintf('22222222-2222-4222-8222-%012d', $n),
            'eventType' => $metric,
            'occurredAtMs' => $at->getTimestampMs(),
        ], self::ACCOUNT, CarbonImmutable::now('UTC')->getTimestampMs());
        self::assertSame(TelemetryDecision::Accepted, $decision);
    }

    private function inspect(?string $secret = null, int $limit = 100): array
    {
        return (new AssignmentReceiptLineageAudit(DB::connection(), $secret ?? self::SECRET))
            ->inspect(CarbonImmutable::now('UTC')->getTimestampMs(), $this->at()->format('Y-m-d'), $limit);
    }

    public function test_real_signed_source_is_matched_to_precise_receipt_and_mismatch_is_detected_without_leak(): void
    {
        $day = $this->at();
        $this->create(1, $day);
        $this->create(2, $day->addMinute());
        $this->create(3, $day->addMinutes(2));
        $this->create(4, $day->addMinutes(3));
        $missing = $this->inspect();
        self::assertSame([
            'scanned' => 4, 'matched' => 0, 'missing' => 4, 'conflicting' => 0,
            'scanComplete' => true, 'coverageProven' => false,
            'consistency' => 'receipt_lineage_provisional',
        ], $missing);

        $this->ingest(1, $day);
        // Even a same-day seconds drift is tolerated by the intentional
        // coarse UTC period fingerprint, not represented as exact time proof.
        $this->ingest(2, $day->addMinute()->addSecond());
        $this->ingest(3, $day->addMinutes(2), 'media.photo.committed');
        $check = $this->inspect();
        self::assertSame(2, $check['matched']);
        self::assertSame(1, $check['missing']);
        self::assertSame(1, $check['conflicting']);
        self::assertFalse($check['coverageProven']);

        // A wrong operator HMAC secret cannot silently label receipts valid.
        $wrongKey = (new AssignmentReceiptLineageAudit(
            DB::connection(), str_repeat('z', 40),
        ))->inspect(CarbonImmutable::now('UTC')->getTimestampMs(), $day->format('Y-m-d'));
        self::assertSame(4, $wrongKey['missing']);
        self::assertSame(0, $wrongKey['matched']);
        $json = json_encode([$missing, $check, $wrongKey], JSON_THROW_ON_ERROR);
        foreach ([self::ACCOUNT, self::SECRET, '11111111-1111', '22222222-2222',
            'event_token', 'operation_id', 'actor_token', 'fingerprint', 'created_at',
        ] as $private) {
            self::assertStringNotContainsString($private, $json);
        }
    }

    public function test_bounded_scan_reports_incomplete_and_empty_does_not_prove_coverage(): void
    {
        $empty = $this->inspect();
        self::assertSame(0, $empty['scanned']);
        self::assertTrue($empty['scanComplete']);
        self::assertFalse($empty['coverageProven']);

        $day = $this->at();
        for ($n = 1; $n <= 3; $n++) {
            $this->create($n, $day->addMinutes($n));
            $this->ingest($n, $day->addMinutes($n));
        }
        $one = $this->inspect(limit: 1);
        self::assertSame(1, $one['scanned']);
        self::assertSame(1, $one['matched']);
        self::assertFalse($one['scanComplete']);
        self::assertFalse($one['coverageProven']);
        $full = $this->inspect(limit: 3);
        self::assertSame(3, $full['matched']);
        self::assertTrue($full['scanComplete']);
        self::assertFalse($full['coverageProven']);
    }

    public function test_invalid_days_clocks_and_secret_fail_closed(): void
    {
        $now = CarbonImmutable::now('UTC');
        $yesterday = $this->at()->format('Y-m-d');
        $audit = new AssignmentReceiptLineageAudit(DB::connection(), self::SECRET);
        foreach ([
            [0, $yesterday, 1],
            [$now->addHours(2)->getTimestampMs(), $yesterday, 1],
            [$now->getTimestampMs(), $now->format('Y-m-d'), 1],
            [$now->getTimestampMs(), $now->startOfDay()->subDays(7)->format('Y-m-d'), 1],
            [$now->getTimestampMs(), '2026-02-30', 1],
            [$now->getTimestampMs(), '2026-01-01;DROP', 1],
            [$now->getTimestampMs(), $yesterday, 0],
            [$now->getTimestampMs(), $yesterday, 201],
        ] as [$ms, $day, $limit]) {
            try {
                $audit->inspect($ms, $day, $limit);
                self::fail('lineage audit accepted invalid input');
            } catch (InvalidArgumentException $error) {
                self::assertContains($error->getMessage(), [
                    'telemetry.lineage_invalid_clock',
                    'telemetry.lineage_invalid_window',
                ]);
            }
        }
        try {
            new AssignmentReceiptLineageAudit(DB::connection(), 'weak');
            self::fail('weak HMAC secret accepted');
        } catch (InvalidArgumentException $error) {
            self::assertSame('telemetry.lineage_invalid_secret', $error->getMessage());
        }
        self::assertSame(0, DB::table('telemetry_event_receipts')->count());
        self::assertSame(0, DB::table('telemetry_counters')->count());
    }
}
