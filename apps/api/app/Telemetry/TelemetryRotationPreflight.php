<?php
declare(strict_types=1);

namespace App\Telemetry;

use Carbon\CarbonImmutable;
use Illuminate\Database\Connection;
use InvalidArgumentException;
use RuntimeException;

/**
 * Internal read-only HMAC rotation + retention threat preflight.
 *
 * Tests whether the SAME authoritative source operation has durable
 * receipts under old/candidate secrets, and whether relevant pseudonymous
 * state remains. Never rotates a key, purges receipts, schedules a job or
 * treats a clean preflight as permission to change a production secret.
 *
 * Key material and raw identifiers are ephemeral PHP values only. Results
 * are restricted to aggregate counts and booleans, and MUST NOT become
 * public or Admin output without privacy review and real MFA/RBAC.
 */
final readonly class TelemetryRotationPreflight
{
    public function __construct(private Connection $db) {}

    /**
     * Fully completed, still Collector-eligible UTC day, bounded to 200 rows.
     * Separate source/receipt/retention reads are NOT an atomic snapshot.
     *
     * @return array{
     *   inspected:int,oldOnly:int,candidateOnly:int,both:int,
     *   missing:int,conflicting:int,scanComplete:bool,
     *   retainedState:array{
     *     activeReceiptsPresent:bool,expiredReceiptsPresent:bool,
     *     actorMembershipsPresent:bool,expiredActorMembershipsPresent:bool,
     *     recentTrustedSourcePresent:bool
     *   },rotationApproved:false,assessment:string
     * }
     */
    public function assess(
        int $serverNowMs, string $utcDay,
        string $oldSecret, string $candidateSecret,
        int $maxRows = 100,
    ): array {
        if ($serverNowMs <= 0 || $serverNowMs > 9007199254740991
            || $serverNowMs > (int) floor(microtime(true) * 1000) + 300000) {
            throw new InvalidArgumentException('telemetry.rotation_invalid_clock');
        }
        if ($maxRows < 1 || $maxRows > 200
            || strlen($oldSecret) < 32 || strlen($oldSecret) > 4096
            || strlen($candidateSecret) < 32 || strlen($candidateSecret) > 4096
            || hash_equals($oldSecret, $candidateSecret)) {
            throw new InvalidArgumentException('telemetry.rotation_invalid_keys_or_bounds');
        }
        if (preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/D', $utcDay) !== 1) {
            throw new InvalidArgumentException('telemetry.rotation_invalid_day');
        }
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $utcDay, 'UTC');
        if ($start === false || $start->format('Y-m-d') !== $utcDay) {
            throw new InvalidArgumentException('telemetry.rotation_invalid_day');
        }

        $now = CarbonImmutable::createFromTimestampMs($serverNowMs, 'UTC');
        $earliest = $now->subMilliseconds(TelemetryCollector::MAX_PAST_MS)
            ->startOfDay()->addDay();
        if ($start < $earliest || $start >= $now->startOfDay()) {
            throw new InvalidArgumentException('telemetry.rotation_invalid_day');
        }

        $driver = $this->db->getDriverName();
        if ($driver !== 'pgsql' && $driver !== 'sqlite') {
            throw new RuntimeException('telemetry.rotation_unsupported_database');
        }
        $fmt = $driver === 'pgsql' ? 'Y-m-d H:i:s.uP' : 'Y-m-d H:i:s.u';
        $sourceRows = $this->db->table('assignment_creation_meter_v1')
            ->select(['owner_account_id', 'operation_id', 'created_at'])
            ->where('created_at', '>=', $start->format($fmt))
            ->where('created_at', '<', $start->addDay()->format($fmt))
            ->orderBy('created_at')->orderBy('operation_id')
            ->limit($maxRows + 1)->get();
        $truncated = $sourceRows->count() > $maxRows;

        $entries = [];
        $tokens = [];
        foreach ($sourceRows->take($maxRows) as $source) {
            if (!is_string($source->owner_account_id)
                || !TelemetryEvent::validAccountId($source->owner_account_id)
                || !is_string($source->operation_id)) {
                throw new RuntimeException('telemetry.rotation_invalid_source');
            }
            try {
                $time = CarbonImmutable::parse((string) $source->created_at, 'UTC');
                if ($time->format('Y-m-d') !== $utcDay) {
                    throw new RuntimeException('telemetry.rotation_invalid_source');
                }
                $event = TelemetryEvent::fromArray([
                    'schemaVersion' => 1,
                    'eventId' => $source->operation_id,
                    'eventType' => 'assignment.created',
                    'occurredAtMs' => $time->getTimestampMs(),
                ]);
            } catch (\Throwable) {
                throw new RuntimeException('telemetry.rotation_invalid_source');
            }
            $old = TelemetryRecord::fromTrusted(
                $event, $source->owner_account_id, $oldSecret,
            );
            $candidate = TelemetryRecord::fromTrusted(
                $event, $source->owner_account_id, $candidateSecret,
            );
            $entries[] = [
                $old->eventToken, $old->fingerprint(),
                $candidate->eventToken, $candidate->fingerprint(),
            ];
            $tokens[$old->eventToken] = true;
            $tokens[$candidate->eventToken] = true;
        }

        $saved = [];
        if ($tokens !== []) {
            foreach ($this->db->table('telemetry_event_receipts')
                ->select(['event_token', 'fingerprint'])
                ->whereIn('event_token', array_keys($tokens))->get() as $row) {
                $saved[$row->event_token] = $row->fingerprint;
            }
        }
        $oldOnly = $candidateOnly = $both = $missing = $conflicting = 0;
        foreach ($entries as [$oldToken, $oldFingerprint, $newToken, $newFingerprint]) {
            $oldPresent = array_key_exists($oldToken, $saved);
            $newPresent = array_key_exists($newToken, $saved);
            $oldValid = $oldPresent && is_string($saved[$oldToken])
                && hash_equals($oldFingerprint, $saved[$oldToken]);
            $newValid = $newPresent && is_string($saved[$newToken])
                && hash_equals($newFingerprint, $saved[$newToken]);
            if (($oldPresent && !$oldValid) || ($newPresent && !$newValid)) {
                $conflicting++;
            } elseif ($oldValid && $newValid) {
                $both++;
            } elseif ($oldValid) {
                $oldOnly++;
            } elseif ($newValid) {
                $candidateOnly++;
            } else {
                $missing++;
            }
        }

        // EXACTLY the existing DatabaseTelemetrySink::prune cutoff for
        // receipts (received_at strictly before UTC now-8d), and whole
        // UTC day/ISO-week/month membership periods with the 8d grace.
        // This is an advisory EXISTS preview. No row is pruned or modified.
        $cutoff = $now->subDays(8);
        $receiptCutoff = $cutoff->format('Y-m-d\TH:i:s+00:00');
        $actorThresholds = [
            'day' => $cutoff->format('Y-m-d'),
            'week' => $cutoff->format('o-\WW'),
            'month' => $cutoff->format('Y-m'),
        ];
        $eligibleActors = false;
        foreach ($actorThresholds as $kind => $period) {
            if ($this->db->table('telemetry_active_tokens')
                ->where('period_kind', $kind)
                ->where('period_key', '<', $period)->exists()) {
                $eligibleActors = true;
                break;
            }
        }
        $lower = $now->subMilliseconds(TelemetryCollector::MAX_PAST_MS);
        $retained = [
            'activeReceiptsPresent' => $this->db->table('telemetry_event_receipts')
                ->where('received_at', '>=', $receiptCutoff)->exists(),
            'expiredReceiptsPresent' => $this->db->table('telemetry_event_receipts')
                ->where('received_at', '<', $receiptCutoff)->exists(),
            'actorMembershipsPresent' => $this->db->table('telemetry_active_tokens')
                ->exists(),
            'expiredActorMembershipsPresent' => $eligibleActors,
            'recentTrustedSourcePresent' => $this->db->table('assignment_creation_meter_v1')
                ->where('created_at', '>=', $lower->format($fmt))->exists(),
        ];
        return [
            'inspected' => count($entries),
            'oldOnly' => $oldOnly,
            'candidateOnly' => $candidateOnly,
            'both' => $both,
            'missing' => $missing,
            'conflicting' => $conflicting,
            'scanComplete' => !$truncated,
            'retainedState' => $retained,
            // Concurrent producers, sampling, consent, other source families
            // and existing receipt/actor retention prevent a sound automated
            // yes/no permission to rotate. Even an EMPTY DB is not proof.
            'rotationApproved' => false,
            'assessment' => 'owner_quiescence_and_policy_required',
        ];
    }
}
