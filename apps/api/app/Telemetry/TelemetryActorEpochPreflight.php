<?php
declare(strict_types=1);

namespace App\Telemetry;

use Carbon\CarbonImmutable;
use DateTimeZone;
use Illuminate\Database\Connection;
use InvalidArgumentException;

/**
 * Unmounted, READ-ONLY per-period HMAC actor epoch preflight.
 *
 * Selecting a single key based on ingestion/processing time is UNSAFE:
 * a late event could land in a UTC day, ISO week or month whose HMAC
 * membership was already counted with another key.
 *
 * An epoch begins at a UTC midnight. Each period independently retains
 * OLD actor HMAC until that WHOLE period started at/after the boundary:
 * e.g. a new day may use candidate while current week/month remain OLD.
 * This diagnostic does not install a writer, switch keys, migrate counters
 * or grant access to account-level activity.
 *
 * We cannot assert release safety from a read-only DB scan: uncoordinated
 * legacy producers can continue writing OLD actor tokens after cutover.
 * Thus cutoverApproved is ALWAYS false even on an empty database.
 */
final readonly class TelemetryActorEpochPreflight
{
    private const EVENT_UUID = '00000000-0000-4000-8000-000000000000';

    public function __construct(private Connection $db) {}

    /**
     * Pure deterministic period boundary policy (no database reads).
     * Event OCCURRENCE time, NEVER server ingest time, selects the period.
     *
     * @return array{
     *   day:array{period:string,domain:string},
     *   week:array{period:string,domain:string},
     *   month:array{period:string,domain:string}
     * }
     */
    public static function periodPlan(int $eventAtMs, int $cutoverAtMs): array
    {
        if ($eventAtMs < 1 || $eventAtMs > 4102444799999
            || $cutoverAtMs < 1 || $cutoverAtMs > 4102444799999) {
            throw new InvalidArgumentException('telemetry.epoch_invalid_clock');
        }
        $event = CarbonImmutable::createFromTimestampMs($eventAtMs, 'UTC');
        $cutover = CarbonImmutable::createFromTimestampMs($cutoverAtMs, 'UTC');
        if ($cutover->format('H:i:s.u') !== '00:00:00.000000') {
            throw new InvalidArgumentException('telemetry.epoch_non_utc_boundary');
        }

        $starts = [
            'day' => $event->startOfDay(),
            'week' => $event->startOfWeek(\Carbon\CarbonInterface::MONDAY),
            'month' => $event->startOfMonth(),
        ];
        $periods = [
            'day' => $event->format('Y-m-d'),
            'week' => $event->format('o-\WW'),
            'month' => $event->format('Y-m'),
        ];
        $plan = [];
        foreach ($starts as $kind => $start) {
            $plan[$kind] = [
                'period' => $periods[$kind],
                'domain' => $start < $cutover ? 'old' : 'candidate',
            ];
        }
        return $plan;
    }

    /**
     * Query ONLY whether privacy-minimized actor tokens exist in each HMAC
     * domain; no actor IDs, HMAC bytes, secret values or raw event data return.
     * No snapshots/writer fence, so this is merely a risk flag.
     *
     * @return array{
     *   periods:array<string,array{
     *     period:string,domain:string,membership:string,crossDomainRisk:bool
     *   }>,
     *   anyCrossDomainRisk:bool,cutoverApproved:false,assessment:string
     * }
     */
    public function inspect(
        int $serverNowMs, int $occurredAtMs, int $cutoverAtMs,
        string $trustedAccountId, string $oldSecret, string $candidateSecret,
    ): array {
        if ($serverNowMs < 1 || $serverNowMs > 4102444799999
            || $serverNowMs > (int) floor(microtime(true) * 1000) + 300000) {
            throw new InvalidArgumentException('telemetry.epoch_invalid_clock');
        }
        if ($occurredAtMs < $serverNowMs - TelemetryCollector::MAX_PAST_MS
            || $occurredAtMs > $serverNowMs + TelemetryCollector::MAX_FUTURE_MS) {
            throw new InvalidArgumentException('telemetry.epoch_outside_window');
        }
        if (!TelemetryEvent::validAccountId($trustedAccountId)
            || strlen($oldSecret) < 32 || strlen($oldSecret) > 4096
            || strlen($candidateSecret) < 32 || strlen($candidateSecret) > 4096
            || hash_equals($oldSecret, $candidateSecret)
            || !in_array($this->db->getDriverName(), ['pgsql', 'sqlite'], true)) {
            throw new InvalidArgumentException('telemetry.epoch_invalid_context');
        }

        $plan = self::periodPlan($occurredAtMs, $cutoverAtMs);

        // Reuse the exact v1 TelemetryRecord actor-token HMAC contract.
        // The purely in-memory synthetic UUID is NEVER persisted or emitted.
        // Event ID cannot change period-scoped actor HMAC derivation.
        $event = TelemetryEvent::fromArray([
            'schemaVersion' => 1,
            'eventId' => self::EVENT_UUID,
            'eventType' => 'session.active',
            'occurredAtMs' => $occurredAtMs,
        ]);
        $old = TelemetryRecord::fromTrusted($event, $trustedAccountId, $oldSecret);
        $candidate = TelemetryRecord::fromTrusted($event, $trustedAccountId, $candidateSecret);
        $tokens = [
            'day' => [$old->dailyActorToken, $candidate->dailyActorToken],
            'week' => [$old->weeklyActorToken, $candidate->weeklyActorToken],
            'month' => [$old->monthlyActorToken, $candidate->monthlyActorToken],
        ];

        $risks = false;
        foreach ($plan as $kind => &$p) {
            [$oldToken, $candidateToken] = $tokens[$kind];
            if (!is_string($oldToken) || !is_string($candidateToken)
                || hash_equals($oldToken, $candidateToken)) {
                throw new \RuntimeException('telemetry.epoch_actor_collision');
            }
            $base = $this->db->table('telemetry_active_tokens')
                ->where('period_kind', $kind)->where('period_key', $p['period']);
            $oldPresent = (clone $base)->where('actor_token', $oldToken)->exists();
            $candidatePresent = (clone $base)->where('actor_token', $candidateToken)->exists();
            $p['membership'] = match (true) {
                $oldPresent && $candidatePresent => 'both',
                $oldPresent => 'old_only',
                $candidatePresent => 'candidate_only',
                default => 'none',
            };
            // Even one unexpected-domain membership can inflate distinct
            // if another writer later counts this same actor in the planned
            // domain. Both-domain presence is a confirmed split.
            $p['crossDomainRisk'] =
                ($p['domain'] === 'old' && $candidatePresent)
                || ($p['domain'] === 'candidate' && $oldPresent);
            $risks = $risks || $p['crossDomainRisk'];
        }
        unset($p);

        return [
            'periods' => $plan,
            'anyCrossDomainRisk' => $risks,
            'cutoverApproved' => false,
            'assessment' => 'legacy_writers_unfenced_and_policy_unapproved',
        ];
    }
}
