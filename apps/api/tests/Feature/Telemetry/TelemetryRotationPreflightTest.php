<?php
declare(strict_types=1);

namespace Tests\Feature\Telemetry;

use App\Telemetry\DatabaseTelemetrySink;
use App\Telemetry\TelemetryCollector;
use App\Telemetry\TelemetryDecision;
use App\Telemetry\TelemetryEvent;
use App\Telemetry\TelemetryRecord;
use App\Telemetry\TelemetryRotationPreflight;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Tests\TestCase;

final class TelemetryRotationPreflightTest extends TestCase
{
    use RefreshDatabase;

    private const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const OLD_KEY = 'PB3 TEST ONLY old telemetry receipt HMAC key, no real secret';
    private const NEW_KEY = 'PB3 TEST ONLY candidate HMAC key for rotation preflight';
    private const EVENT_PREFIX = '22222222-2222-4222-8222-';

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('identity_accounts')->insert([
            'id' => self::ACCOUNT,
            'operation_id' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'prepare_hash' => str_repeat('a', 64), 'status' => 'ready',
            'reserved_until' => now()->addDay(), 'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function yesterday(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC')->startOfDay()->subDay()->addHours(12);
    }

    private function source(int $n, CarbonImmutable $at): void
    {
        DB::table('assignment_creation_meter_v1')->insert([
            'assignment_id' => sprintf('11111111-1111-4111-8111-%012d', $n),
            'operation_id' => sprintf(self::EVENT_PREFIX.'%012d', $n),
            'owner_account_id' => self::ACCOUNT,
            'created_at' => $at->format('Y-m-d H:i:s.u'),
        ]);
    }

    private function event(int $n, CarbonImmutable $at): array
    {
        return [
            'schemaVersion' => 1,
            'eventId' => sprintf(self::EVENT_PREFIX.'%012d', $n),
            'eventType' => 'assignment.created',
            'occurredAtMs' => $at->getTimestampMs(),
        ];
    }

    private function ingest(int $n, CarbonImmutable $at, string $secret): void
    {
        $result = (new TelemetryCollector(
            new DatabaseTelemetrySink(DB::connection()), $secret,
        ))->ingest($this->event($n, $at), self::ACCOUNT,
            CarbonImmutable::now('UTC')->getTimestampMs());
        self::assertSame(TelemetryDecision::Accepted, $result);
    }

    private function preflight(?int $limit = null): array
    {
        return (new TelemetryRotationPreflight(DB::connection()))->assess(
            CarbonImmutable::now('UTC')->getTimestampMs(),
            $this->yesterday()->format('Y-m-d'),
            self::OLD_KEY, self::NEW_KEY, $limit ?? 100,
        );
    }

    public function test_same_source_under_old_candidate_both_missing_and_corrupted_receipts_is_detected(): void
    {
        $day = $this->yesterday();
        for ($n = 1; $n <= 5; $n++) {
            $this->source($n, $day->addMinutes($n));
        }
        $this->ingest(1, $day->addMinute(), self::OLD_KEY);
        $this->ingest(2, $day->addMinutes(2), self::NEW_KEY);
        // Key changes without a dual-key receipt policy double-count the
        // same source operation. This is disposable test evidence only.
        $this->ingest(3, $day->addMinutes(3), self::OLD_KEY);
        $this->ingest(3, $day->addMinutes(3), self::NEW_KEY);
        $this->ingest(5, $day->addMinutes(5), self::OLD_KEY);
        $record = TelemetryRecord::fromTrusted(
            TelemetryEvent::fromArray($this->event(5, $day->addMinutes(5))),
            self::ACCOUNT, self::OLD_KEY,
        );
        DB::table('telemetry_event_receipts')
            ->where('event_token', $record->eventToken)
            ->update(['fingerprint' => str_repeat('f', 64)]);
        $before = [
            (int) DB::table('telemetry_event_receipts')->count(),
            (int) DB::table('telemetry_counters')->where('metric', 'assignment.created')
                ->where('period_kind', 'day')->sum('total'),
        ];

        $result = $this->preflight();
        foreach ([
            'inspected' => 5, 'oldOnly' => 1, 'candidateOnly' => 1,
            'both' => 1, 'missing' => 1, 'conflicting' => 1,
        ] as $key => $value) {
            self::assertSame($value, $result[$key]);
        }
        self::assertTrue($result['scanComplete']);
        self::assertFalse($result['rotationApproved']);
        self::assertTrue($result['retainedState']['activeReceiptsPresent']);
        self::assertTrue($result['retainedState']['recentTrustedSourcePresent']);
        self::assertFalse($result['retainedState']['expiredReceiptsPresent']);
        self::assertFalse($result['retainedState']['actorMembershipsPresent']);
        self::assertSame($before, [
            (int) DB::table('telemetry_event_receipts')->count(),
            (int) DB::table('telemetry_counters')->where('metric', 'assignment.created')
                ->where('period_kind', 'day')->sum('total'),
        ], 'preflight must not change persistence or counters');

        $json = json_encode($result, JSON_THROW_ON_ERROR);
        foreach ([self::ACCOUNT, self::OLD_KEY, self::NEW_KEY,
            self::EVENT_PREFIX, 'event_token', 'fingerprint',
            'created_at', 'actor_token',
        ] as $private) {
            self::assertStringNotContainsString($private, $json);
        }

        $capped = $this->preflight(1);
        self::assertSame(1, $capped['inspected']);
        self::assertFalse($capped['scanComplete']);
        self::assertFalse($capped['rotationApproved']);
    }

    public function test_receipt_eight_day_and_whole_utc_actor_period_retention_are_preview_only(): void
    {
        $now = CarbonImmutable::now('UTC')->startOfSecond();
        DB::table('telemetry_event_receipts')->insert([
            'event_token' => str_repeat('a', 64),
            'fingerprint' => str_repeat('b', 64),
            'received_at' => $now->subDays(9)->format('Y-m-d\TH:i:s+00:00'),
        ]);
        DB::table('telemetry_event_receipts')->insert([
            'event_token' => str_repeat('c', 64),
            'fingerprint' => str_repeat('d', 64),
            'received_at' => $now->subDay()->format('Y-m-d\TH:i:s+00:00'),
        ]);
        DB::table('telemetry_active_tokens')->insert([
            'period_kind' => 'day', 'period_key' => '2020-01-01',
            'actor_token' => str_repeat('e', 64),
        ]);
        DB::table('telemetry_active_tokens')->insert([
            'period_kind' => 'month', 'period_key' => $now->format('Y-m'),
            'actor_token' => str_repeat('f', 64),
        ]);
        $result = $this->preflight();
        self::assertSame(0, $result['inspected']);
        self::assertTrue($result['scanComplete']);
        self::assertFalse($result['rotationApproved']);
        self::assertSame([
            'activeReceiptsPresent' => true,
            'expiredReceiptsPresent' => true,
            'actorMembershipsPresent' => true,
            'expiredActorMembershipsPresent' => true,
            'recentTrustedSourcePresent' => false,
        ], $result['retainedState']);
        self::assertSame(2, DB::table('telemetry_event_receipts')->count());
        self::assertSame(2, DB::table('telemetry_active_tokens')->count());

        // Even an empty store has no proof that external writers are paused.
        DB::table('telemetry_event_receipts')->delete();
        DB::table('telemetry_active_tokens')->delete();
        $empty = $this->preflight();
        self::assertSame(0, $empty['inspected']);
        self::assertFalse($empty['rotationApproved']);
        self::assertSame('owner_quiescence_and_policy_required', $empty['assessment']);
    }

    public function test_invalid_secret_clock_day_and_batch_fail_before_source_read(): void
    {
        $now = CarbonImmutable::now('UTC');
        $day = $this->yesterday()->format('Y-m-d');
        $audit = new TelemetryRotationPreflight(DB::connection());
        $bad = [
            [0, $day, self::OLD_KEY, self::NEW_KEY, 1],
            [$now->addHour()->getTimestampMs(), $day, self::OLD_KEY, self::NEW_KEY, 1],
            [$now->getTimestampMs(), $day, 'short', self::NEW_KEY, 1],
            [$now->getTimestampMs(), $day, self::OLD_KEY, 'short', 1],
            [$now->getTimestampMs(), $day, self::OLD_KEY, self::OLD_KEY, 1],
            [$now->getTimestampMs(), $day, self::OLD_KEY, self::NEW_KEY, 0],
            [$now->getTimestampMs(), $day, self::OLD_KEY, self::NEW_KEY, 201],
            [$now->getTimestampMs(), $now->format('Y-m-d'), self::OLD_KEY, self::NEW_KEY, 1],
            [$now->getTimestampMs(), $now->startOfDay()->subDays(7)->format('Y-m-d'),
                self::OLD_KEY, self::NEW_KEY, 1],
            [$now->getTimestampMs(), '2026-02-30', self::OLD_KEY, self::NEW_KEY, 1],
            [$now->getTimestampMs(), '2026-01-01;DROP', self::OLD_KEY, self::NEW_KEY, 1],
        ];
        foreach ($bad as $args) {
            try {
                $audit->assess(...$args);
                self::fail('unsafe key rotation preflight argument accepted');
            } catch (InvalidArgumentException $error) {
                self::assertContains($error->getMessage(), [
                    'telemetry.rotation_invalid_clock',
                    'telemetry.rotation_invalid_keys_or_bounds',
                    'telemetry.rotation_invalid_day',
                ]);
            }
        }
        self::assertSame(0, DB::table('telemetry_event_receipts')->count());
        self::assertSame(0, DB::table('telemetry_active_tokens')->count());
    }
}
