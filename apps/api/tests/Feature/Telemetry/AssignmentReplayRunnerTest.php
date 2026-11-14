<?php
declare(strict_types=1);

namespace Tests\Feature\Telemetry;

use App\Telemetry\AssignmentCreationReplay;
use App\Telemetry\AssignmentReplayRunner;
use App\Telemetry\DatabaseTelemetrySink;
use App\Telemetry\TelemetryCollector;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Tests\TestCase;

final class AssignmentReplayRunnerTest extends TestCase
{
    use RefreshDatabase;

    private const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const SECRET = 'PB3 disposable CI runner key of 32+ bytes, no real secret';

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

    private function runner(): AssignmentReplayRunner
    {
        $db = DB::connection();
        return new AssignmentReplayRunner(new AssignmentCreationReplay(
            $db, new TelemetryCollector(new DatabaseTelemetrySink($db), self::SECRET),
        ));
    }

    private function fixture(int $i, CarbonImmutable $time): void
    {
        DB::table('assignment_creation_meter_v1')->insert([
            'assignment_id' => sprintf('11111111-1111-4111-8111-%012d', $i),
            'operation_id' => sprintf('22222222-2222-4222-8222-%012d', $i),
            'owner_account_id' => self::ACCOUNT,
            'created_at' => $time->format('Y-m-d H:i:s.u'),
        ]);
    }

    public function test_cap_is_explicit_and_idempotent_rescan_completes_without_leaking_cursor(): void
    {
        $now = CarbonImmutable::now('UTC')->startOfSecond();
        for ($i = 1; $i <= 3; $i++) {
            $this->fixture($i, $now->subMinutes($i));
        }
        $runner = $this->runner();
        $ms = $now->getTimestampMs();

        $partial = $runner->run($ms, 1, 1);
        self::assertSame(['pages' => 1, 'accepted' => 1,
            'duplicate' => 0, 'complete' => false], $partial);
        $complete = $runner->run($ms, 1, 3);
        self::assertSame(['pages' => 3, 'accepted' => 2,
            'duplicate' => 1, 'complete' => true], $complete);
        $third = $runner->run($ms, 2, 2);
        self::assertSame(0, $third['accepted']);
        self::assertSame(3, $third['duplicate']);
        self::assertTrue($third['complete']);
        self::assertSame(3, DB::table('telemetry_event_receipts')->count());
        foreach (['day', 'week', 'month'] as $period) {
            self::assertSame(3, (int) DB::table('telemetry_counters')
                ->where('metric', 'assignment.created')
                ->where('period_kind', $period)->sum('total'));
        }
        $encoded = json_encode([$partial, $complete, $third], JSON_THROW_ON_ERROR);
        foreach ([self::ACCOUNT, self::SECRET, '11111111-1111',
            '22222222-2222', 'createdAt', 'assignmentId', 'eventToken',
        ] as $unsafe) {
            self::assertStringNotContainsString($unsafe, $encoded);
        }
    }

    public function test_operator_gate_requires_all_runtime_and_policy_conditions(): void
    {
        $allowed = [ '1', '1', self::SECRET, 'pgsql', false ];
        self::assertSame(self::SECRET, AssignmentReplayRunner::requireOperatorSecret(...$allowed));
        $bad = [
            [false, '1', self::SECRET, 'pgsql', false],
            ['0', '1', self::SECRET, 'pgsql', false],
            ['1', false, self::SECRET, 'pgsql', false],
            ['1', '0', self::SECRET, 'pgsql', false],
            ['1', '1', 'weak', 'pgsql', false],
            ['1', '1', str_repeat('X', 4097), 'pgsql', false],
            ['1', '1', self::SECRET, 'sqlite', false],
            ['1', '1', self::SECRET, 'pgsql', true],
        ];
        foreach ($bad as $args) {
            try {
                AssignmentReplayRunner::requireOperatorSecret(...$args);
                self::fail('operator gate failed closed condition');
            } catch (InvalidArgumentException $e) {
                self::assertSame('telemetry.operator_disabled', $e->getMessage());
            }
        }
        self::assertSame(0, DB::table('telemetry_event_receipts')->count());
    }

    public function test_bad_limits_reject_before_any_source_scan(): void
    {
        $runner = $this->runner();
        $now = CarbonImmutable::now('UTC')->getTimestampMs();
        foreach ([[0, 1], [201, 1], [1, 0], [1, 501]] as [$size, $pages]) {
            try {
                $runner->run($now, $size, $pages);
                self::fail('expected bounded scan rejection');
            } catch (InvalidArgumentException $e) {
                self::assertSame('telemetry.runner_invalid_bounds', $e->getMessage());
            }
        }
        self::assertSame(0, DB::table('telemetry_event_receipts')->count());
    }
}
