<?php
declare(strict_types=1);

namespace Tests\Feature\Telemetry;

use App\Telemetry\DatabaseTelemetrySink;
use App\Telemetry\TelemetryActorEpochPreflight;
use App\Telemetry\TelemetryCollector;
use App\Telemetry\TelemetryDecision;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Tests\TestCase;

final class TelemetryActorEpochPreflightTest extends TestCase
{
    use RefreshDatabase;

    private const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const OLD = 'PB3 TEST ONLY old actor epoch HMAC, not for production';
    private const NEW = 'PB3 TEST ONLY candidate epoch HMAC, not for production';

    private function ms(string $iso): int
    {
        return CarbonImmutable::parse($iso)->getTimestampMs();
    }

    private function subject(): TelemetryActorEpochPreflight
    {
        return new TelemetryActorEpochPreflight(DB::connection());
    }

    private function inspect(int $eventAtMs, int $cutoverAtMs): array
    {
        return $this->subject()->inspect(
            CarbonImmutable::now('UTC')->getTimestampMs(),
            $eventAtMs, $cutoverAtMs, self::ACCOUNT, self::OLD, self::NEW,
        );
    }

    public function test_utc_calendar_periods_switch_independently_and_iso_year_rollover_is_correct(): void
    {
        $cut = $this->ms('2027-01-01T00:00:00Z');
        $jan1 = TelemetryActorEpochPreflight::periodPlan(
            $this->ms('2027-01-01T12:00:00Z'), $cut,
        );
        self::assertSame([
            'day' => ['period' => '2027-01-01', 'domain' => 'candidate'],
            'week' => ['period' => '2026-W53', 'domain' => 'old'],
            'month' => ['period' => '2027-01', 'domain' => 'candidate'],
        ], $jan1);
        $jan4 = TelemetryActorEpochPreflight::periodPlan(
            $this->ms('2027-01-04T00:00:00Z'), $cut,
        );
        self::assertSame('candidate', $jan4['week']['domain']);
        self::assertSame('2027-W01', $jan4['week']['period']);

        $late = TelemetryActorEpochPreflight::periodPlan(
            $this->ms('2026-12-31T23:59:59Z'), $cut,
        );
        foreach ($late as $entry) {
            self::assertSame('old', $entry['domain'],
                'late event must use its occurred-at-period HMAC domain');
        }
        $nov = TelemetryActorEpochPreflight::periodPlan(
            $this->ms('2026-11-01T12:00:00Z'),
            $this->ms('2026-11-01T00:00:00Z'),
        );
        self::assertSame('candidate', $nov['day']['domain']);
        self::assertSame('old', $nov['week']['domain']);
        self::assertSame('candidate', $nov['month']['domain']);
    }

    public function test_empty_real_store_is_not_permission_to_cutover_and_returns_no_private_material(): void
    {
        $now = CarbonImmutable::now('UTC');
        $result = $this->inspect(
            $now->getTimestampMs(), $now->startOfDay()->getTimestampMs(),
        );
        self::assertFalse($result['anyCrossDomainRisk']);
        self::assertFalse($result['cutoverApproved']);
        self::assertSame('legacy_writers_unfenced_and_policy_unapproved', $result['assessment']);
        foreach ($result['periods'] as $period) {
            self::assertSame('none', $period['membership']);
            self::assertFalse($period['crossDomainRisk']);
        }
        $serialized = json_encode($result, JSON_THROW_ON_ERROR);
        foreach ([self::ACCOUNT, self::OLD, self::NEW,
            'event_token', 'actor_token', 'fingerprint', 'hmacSecret',
        ] as $private) {
            self::assertStringNotContainsString($private, $serialized);
        }
        self::assertSame(0, DB::table('telemetry_active_tokens')->count());
        self::assertSame(0, DB::table('telemetry_counters')->count());
    }

    public function test_actual_old_and_candidate_actor_domain_mixing_flags_overcount_without_writing(): void
    {
        $now = CarbonImmutable::now('UTC')->subSecond();
        $eventMs = $now->getTimestampMs();
        $cutoverMs = $now->startOfDay()->getTimestampMs();
        $collector = static function (string $key, string $eventId) use ($eventMs): void {
            $result = (new TelemetryCollector(
                new DatabaseTelemetrySink(DB::connection()), $key,
            ))->ingest([
                'schemaVersion' => 1,
                'eventId' => $eventId, 'eventType' => 'session.active',
                'occurredAtMs' => $eventMs,
            ], self::ACCOUNT, CarbonImmutable::now('UTC')->getTimestampMs());
            self::assertSame(TelemetryDecision::Accepted, $result);
        };

        $collector(self::OLD, '11111111-1111-4111-8111-111111111111');
        $before = $this->inspect($eventMs, $cutoverMs);
        self::assertSame('candidate', $before['periods']['day']['domain']);
        self::assertSame('old_only', $before['periods']['day']['membership']);
        self::assertTrue($before['periods']['day']['crossDomainRisk']);
        self::assertFalse($before['cutoverApproved']);

        // Negative fixture: a candidate-only live event for the SAME actor
        // creates a new pseudonym and inflates DAU, WAU and MAU.
        $collector(self::NEW, '22222222-2222-4222-8222-222222222222');
        $after = $this->inspect($eventMs, $cutoverMs);
        self::assertTrue($after['anyCrossDomainRisk']);
        foreach (['day', 'week', 'month'] as $kind) {
            self::assertSame('both', $after['periods'][$kind]['membership']);
            self::assertTrue($after['periods'][$kind]['crossDomainRisk']);
            self::assertSame(2, (int) DB::table('telemetry_counters')
                ->where('metric', 'session.active.distinct')
                ->where('period_kind', $kind)->sum('total'));
        }
        self::assertFalse($after['cutoverApproved']);
        $count = DB::table('telemetry_active_tokens')->count();
        $this->inspect($eventMs, $cutoverMs);
        self::assertSame($count, DB::table('telemetry_active_tokens')->count(),
            'read-only preflight must not alter actor memberships');
    }

    public function test_invalid_midnight_clock_secret_account_and_old_event_fail_closed(): void
    {
        $now = CarbonImmutable::now('UTC');
        $event = $now->getTimestampMs();
        $midnight = $now->startOfDay()->getTimestampMs();
        $checks = [
            [0, $event, $midnight, self::ACCOUNT, self::OLD, self::NEW],
            [$event, $event, $midnight + 1, self::ACCOUNT, self::OLD, self::NEW],
            [$event, $event, $midnight, 'not-a-uuid', self::OLD, self::NEW],
            [$event, $event, $midnight, self::ACCOUNT, 'short', self::NEW],
            [$event, $event, $midnight, self::ACCOUNT, self::OLD, 'short'],
            [$event, $event, $midnight, self::ACCOUNT, self::OLD, self::OLD],
            [$event, $event - TelemetryCollector::MAX_PAST_MS - 10,
                $midnight, self::ACCOUNT, self::OLD, self::NEW],
            [$event, $event + TelemetryCollector::MAX_FUTURE_MS + 10,
                $midnight, self::ACCOUNT, self::OLD, self::NEW],
        ];
        foreach ($checks as $args) {
            try {
                $this->subject()->inspect(...$args);
                self::fail('unsafe epoch preflight arguments accepted');
            } catch (InvalidArgumentException $error) {
                self::assertContains($error->getMessage(), [
                    'telemetry.epoch_invalid_clock',
                    'telemetry.epoch_non_utc_boundary',
                    'telemetry.epoch_invalid_context',
                    'telemetry.epoch_outside_window',
                ]);
            }
        }
        self::assertSame(0, DB::table('telemetry_active_tokens')->count());
        self::assertSame(0, DB::table('telemetry_event_receipts')->count());
    }
}
