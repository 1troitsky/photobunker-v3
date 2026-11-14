<?php
declare(strict_types=1);

namespace Tests\Feature\Telemetry;

use App\Telemetry\AssignmentCreationReplay;
use App\Telemetry\DatabaseTelemetrySink;
use App\Telemetry\TelemetryCollector;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use RuntimeException;
use Tests\TestCase;

final class AssignmentCreationReplayTest extends TestCase
{
    use RefreshDatabase;

    private const KEY = 'PB3 only disposable telemetry source test HMAC secret';
    private const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    private const ASSIGNMENT_A = '11111111-1111-4111-8111-111111111111';
    private const ASSIGNMENT_B = '22222222-2222-4222-8222-222222222222';
    private const OP_A = '33333333-3333-4333-8333-333333333333';
    private const OP_B = '44444444-4444-4444-8444-444444444444';

    protected function setUp(): void
    {
        parent::setUp();
        foreach ([self::ACCOUNT_A, self::ACCOUNT_B] as $idx => $id) {
            DB::table('identity_accounts')->insert([
                'id' => $id, 'operation_id' => sprintf('55555555-5555-4555-8555-%012d', $idx + 1),
                'status' => 'ready', 'prepare_hash' => str_repeat('a', 64),
                'reserved_until' => now()->addDay(),
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    private function source(string $assignment, string $op, string $account, CarbonImmutable $time): void
    {
        DB::table('assignment_creation_meter_v1')->insert([
            'assignment_id' => $assignment, 'operation_id' => $op,
            'owner_account_id' => $account, 'created_at' => $time->format('Y-m-d H:i:s.u'),
        ]);
    }

    private function replay(): AssignmentCreationReplay
    {
        return new AssignmentCreationReplay(DB::connection(), new TelemetryCollector(
            new DatabaseTelemetrySink(DB::connection()), self::KEY,
        ));
    }

    private function countDay(): int
    {
        return (int) DB::table('telemetry_counters')
            ->where('metric', 'assignment.created')
            ->where('period_kind', 'day')->sum('total');
    }

    public function test_keyset_batches_use_real_immutable_meter_and_do_not_double_count(): void
    {
        $now = CarbonImmutable::now('UTC')->startOfSecond();
        $time = $now->subMinute();
        $this->source(self::ASSIGNMENT_A, self::OP_A, self::ACCOUNT_A, $time);
        $this->source(self::ASSIGNMENT_B, self::OP_B, self::ACCOUNT_B, $time);
        $replay = $this->replay();
        $ms = $now->getTimestampMs();

        $first = $replay->replayPage($ms, 1);
        self::assertSame(1, $first['accepted']);
        self::assertSame(0, $first['duplicate']);
        self::assertTrue($first['hasMore']);
        self::assertNotNull($first['next']);
        $second = $replay->replayPage($ms, 1, $first['next']);
        self::assertSame(1, $second['accepted']);
        self::assertFalse($second['hasMore']);
        self::assertNull($second['next']);
        self::assertSame(2, $this->countDay());

        $again = $replay->replayPage($ms, 2);
        self::assertSame(0, $again['accepted']);
        self::assertSame(2, $again['duplicate']);
        self::assertSame(2, DB::table('telemetry_event_receipts')->count());
        self::assertSame(0, DB::table('telemetry_active_tokens')->count());

        $stored = json_encode([
            DB::table('telemetry_event_receipts')->get()->toArray(),
            DB::table('telemetry_counters')->get()->toArray(),
        ], JSON_THROW_ON_ERROR);
        foreach ([self::ACCOUNT_A, self::ACCOUNT_B, self::OP_A,
            self::OP_B, self::ASSIGNMENT_A, self::KEY,
            'filename', 'GPS', 'recovery', 'privateEnvelope',
        ] as $private) {
            self::assertStringNotContainsString($private, $stored);
        }
    }

    public function test_expired_and_far_future_ledger_rows_are_never_counted(): void
    {
        $now = CarbonImmutable::now('UTC')->startOfSecond();
        $this->source(self::ASSIGNMENT_A, self::OP_A, self::ACCOUNT_A, $now->subDays(8));
        $this->source(self::ASSIGNMENT_B, self::OP_B, self::ACCOUNT_B, $now->addMinutes(10));
        $out = $this->replay()->replayPage($now->getTimestampMs());
        self::assertSame(0, $out['accepted']);
        self::assertSame(0, $out['duplicate']);
        self::assertSame(0, $this->countDay());
        self::assertSame(0, DB::table('telemetry_event_receipts')->count());
    }

    public function test_tampering_source_timestamp_detects_conflict_without_recount(): void
    {
        $now = CarbonImmutable::now('UTC')->startOfSecond();
        $time = $now->subMinute();
        $this->source(self::ASSIGNMENT_A, self::OP_A, self::ACCOUNT_A, $time);
        $replay = $this->replay();
        self::assertSame(1, $replay->replayPage($now->getTimestampMs())['accepted']);
        // This UPDATE only simulates a corrupt source. Production meter is
        // append-only; a replay must fail closed rather than accept the drift.
        DB::table('assignment_creation_meter_v1')
            ->where('assignment_id', self::ASSIGNMENT_A)
            ->update(['created_at' => $time->addSecond()->format('Y-m-d H:i:s.u')]);
        try {
            $replay->replayPage($now->getTimestampMs());
            self::fail('changed event identity must conflict');
        } catch (RuntimeException $e) {
            self::assertSame('telemetry.source_admission_conflict', $e->getMessage());
        }
        self::assertSame(1, $this->countDay());
    }

    public function test_invalid_or_untrusted_cursor_and_limits_fail_without_side_effects(): void
    {
        $replay = $this->replay();
        $now = CarbonImmutable::now('UTC')->getTimestampMs();
        foreach ([0, 201] as $limit) {
            try {
                $replay->replayPage($now, $limit);
                self::fail('unbounded limit must not be allowed');
            } catch (InvalidArgumentException) {}
        }
        foreach ([
            ['assignmentId' => 'not-a-uuid', 'createdAt' => '2026-11-14 00:00:00.000000'],
            ['assignmentId' => self::ASSIGNMENT_A, 'createdAt' => '2026-11-14;DROP'],
            ['assignmentId' => self::ASSIGNMENT_A, 'createdAt' => '2026-11-14 00:00:00.000000', 'accountId' => self::ACCOUNT_A],
        ] as $bad) {
            try {
                $replay->replayPage($now, 100, $bad);
                self::fail('noncanonical cursor must be rejected');
            } catch (InvalidArgumentException) {}
        }
        self::assertSame(0, DB::table('telemetry_counters')->count());
        self::assertSame(0, DB::table('telemetry_event_receipts')->count());
    }
}
