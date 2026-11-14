<?php
declare(strict_types=1);

namespace App\Telemetry;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\Connection;

/**
 * Opt-in, internal-only durable sink. No HTTP route, collector hook or admin view.
 *
 * A receipt, three calendar counters and three distinct-actor memberships
 * commit atomically. No raw account/event identifiers or user content enter DB.
 * Database errors propagate and MUST NOT be treated as Accepted.
 */
final class DatabaseTelemetrySink implements TelemetrySink
{
    public function __construct(private readonly Connection $db) {}

    public function admit(TelemetryRecord $record): TelemetryDecision
    {
        return $this->db->transaction(function () use ($record): TelemetryDecision {
            $fingerprint = $record->fingerprint();
            $inserted = $this->db->table('telemetry_event_receipts')->insertOrIgnore([
                'event_token' => $record->eventToken,
                'fingerprint' => $fingerprint,
                // Server receive time, never the exact user event timestamp.
                'received_at' => gmdate('Y-m-d\TH:i:s+00:00'),
            ]);

            if ($inserted !== 1) {
                $existing = $this->db->table('telemetry_event_receipts')
                    ->where('event_token', $record->eventToken)->value('fingerprint');
                if (!is_string($existing)) {
                    // A missing row after a unique-key collision is a DB fault,
                    // not evidence of successful/duplicate telemetry.
                    throw new \RuntimeException('telemetry.receipt_inconsistent');
                }
                return hash_equals($existing, $fingerprint)
                    ? TelemetryDecision::Duplicate : TelemetryDecision::Conflict;
            }

            $periods = [
                ['day', $record->utcDay, $record->dailyActorToken],
                ['week', $record->isoWeek, $record->weeklyActorToken],
                ['month', $record->calendarMonth, $record->monthlyActorToken],
            ];
            foreach ($periods as [$kind, $period, $actorToken]) {
                $this->increment($record->eventType, $kind, $period);
                if ($record->eventType !== 'session.active') {
                    continue;
                }
                if (!is_string($actorToken)) {
                    throw new \RuntimeException('telemetry.actor_token_missing');
                }
                $firstSeen = $this->db->table('telemetry_active_tokens')->insertOrIgnore([
                    'period_kind' => $kind,
                    'period_key' => $period,
                    'actor_token' => $actorToken,
                ]);
                if ($firstSeen === 1) {
                    $this->increment('session.active.distinct', $kind, $period);
                }
            }
            return TelemetryDecision::Accepted;
        }, 3);
    }

    private function increment(string $metric, string $kind, string $period): void
    {
        $key = ['metric' => $metric, 'period_kind' => $kind, 'period_key' => $period];
        // INSERT ... ON CONFLICT DO NOTHING, then SQL UPDATE total=total+1.
        // Both run inside the receipt transaction. No read-modify-write race.
        $this->db->table('telemetry_counters')->insertOrIgnore($key + ['total' => 0]);
        $changed = $this->db->table('telemetry_counters')->where($key)->increment('total');
        if ($changed !== 1) {
            throw new \RuntimeException('telemetry.counter_inconsistent');
        }
    }

    /**
     * Explicit maintenance entrypoint, NOT scheduled automatically.
     * Receipts live >=8d (the collector admits only events <=7d old).
     * Actor tokens are purged only after the *whole* relevant UTC period
     * has ended and crossed the 8-day grace. Aggregate counts remain.
     *
     * @return array{receipts:int,actors:int}
     */
    public function prune(DateTimeImmutable $now): array
    {
        $utc = $now->setTimezone(new DateTimeZone('UTC'));
        $cutoff = $utc->sub(new DateInterval('P8D'));
        return $this->db->transaction(function () use ($cutoff): array {
            $receipts = $this->db->table('telemetry_event_receipts')
                ->where('received_at', '<', $cutoff->format('Y-m-d\TH:i:s+00:00'))
                ->delete();
            $actors = 0;
            foreach ([
                'day' => $cutoff->format('Y-m-d'),
                'week' => $cutoff->format('o-\WW'),
                'month' => $cutoff->format('Y-m'),
            ] as $kind => $oldestRetainedPeriod) {
                $actors += $this->db->table('telemetry_active_tokens')
                    ->where('period_kind', $kind)
                    ->where('period_key', '<', $oldestRetainedPeriod)
                    ->delete();
            }
            return ['receipts' => $receipts, 'actors' => $actors];
        }, 3);
    }
}
