<?php
declare(strict_types=1);

namespace App\Telemetry;

use Illuminate\Database\Connection;
use InvalidArgumentException;
use RuntimeException;

/**
 * UNMOUNTED, INTERNAL old-key canonical shadow receipt bridge.
 *
 * Transitional proof-of-concept ONLY, never a live HMAC key cutover.
 * The OLD v1 record is the sole source of counters/actor distinct membership.
 * An uncounted CANDIDATE v1 receipt is atomically inserted as a shadow alias.
 * Both receipts use existing HMAC domains, not raw IDs or user content.
 *
 * All writers MUST continue admitting with OLD canonical or THIS bridge.
 * Concurrent candidate-only writers, partial alias backfill, old-key removal,
 * actor-token changes, multi-key rotation and privacy consent remain BLOCKED.
 * Raw event/account inputs MUST come from a trusted server context, never HTTP.
 */
final readonly class TelemetryShadowKeyBridge
{
    public function __construct(
        private Connection $db,
        private string $oldSecret,
        private string $candidateSecret,
    ) {
        if (strlen($oldSecret) < 32 || strlen($oldSecret) > 4096
            || strlen($candidateSecret) < 32 || strlen($candidateSecret) > 4096
            || hash_equals($oldSecret, $candidateSecret)) {
            throw new InvalidArgumentException('telemetry.shadow_invalid_secrets');
        }
        // In-memory SQLite only for isolated PHPUnit acceptance, never a
        // production alternative to PostgreSQL 18 transactional uniqueness.
        if (!in_array($db->getDriverName(), ['pgsql', 'sqlite'], true)) {
            throw new InvalidArgumentException('telemetry.shadow_invalid_database');
        }
    }

    /**
     * @param mixed $rawEvent only internally constructed allowlisted intent
     */
    public function admit(
        mixed $rawEvent, string $trustedAccountId, int $serverNowMs,
    ): TelemetryDecision {
        if (!is_array($rawEvent)
            || !TelemetryEvent::validAccountId($trustedAccountId)
            || $serverNowMs < 1 || $serverNowMs > 9007199254740991) {
            return TelemetryDecision::Rejected;
        }
        try {
            $event = TelemetryEvent::fromArray($rawEvent);
        } catch (InvalidArgumentException) {
            return TelemetryDecision::Rejected;
        }
        if ($event->occurredAtMs < $serverNowMs - TelemetryCollector::MAX_PAST_MS
            || $event->occurredAtMs > $serverNowMs + TelemetryCollector::MAX_FUTURE_MS) {
            return TelemetryDecision::OutsideWindow;
        }
        $canonical = TelemetryRecord::fromTrusted(
            $event, $trustedAccountId, $this->oldSecret,
        );
        $shadow = TelemetryRecord::fromTrusted(
            $event, $trustedAccountId, $this->candidateSecret,
        );
        if (hash_equals($canonical->eventToken, $shadow->eventToken)) {
            throw new RuntimeException('telemetry.shadow_domain_collision');
        }

        return $this->db->transaction(function () use ($canonical, $shadow): TelemetryDecision {
            $oldFingerprint = $this->db->table('telemetry_event_receipts')
                ->where('event_token', $canonical->eventToken)->value('fingerprint');
            $shadowFingerprint = $this->db->table('telemetry_event_receipts')
                ->where('event_token', $shadow->eventToken)->value('fingerprint');

            // A candidate receipt WITHOUT the old canonical is unsafe: a
            // candidate-only writer may already have incremented counters.
            // Refuse to create a competing old receipt or inflate totals.
            if ($shadowFingerprint !== null && $oldFingerprint === null) {
                throw new RuntimeException('telemetry.shadow_orphan_candidate');
            }
            if (($oldFingerprint !== null
                && (!is_string($oldFingerprint)
                    || !hash_equals($canonical->fingerprint(), $oldFingerprint)))
                || ($shadowFingerprint !== null
                    && (!is_string($shadowFingerprint)
                        || !hash_equals($shadow->fingerprint(), $shadowFingerprint)))) {
                return TelemetryDecision::Conflict;
            }

            // UNIQUE old receipt serializes this bridge against legacy
            // old-key writers; inner sink transaction is a savepoint.
            // Counters AND distinct membership MUST be old-domain only.
            $result = (new DatabaseTelemetrySink($this->db))->admit($canonical);
            if ($result === TelemetryDecision::Conflict) {
                return $result;
            }

            // Candidate receipt is an alias, not a second admitted event.
            // It lives in the SAME outer transaction as canonical count.
            $inserted = $this->db->table('telemetry_event_receipts')->insertOrIgnore([
                'event_token' => $shadow->eventToken,
                'fingerprint' => $shadow->fingerprint(),
                'received_at' => gmdate('Y-m-d\TH:i:s+00:00'),
            ]);
            if ($inserted !== 1) {
                $existing = $this->db->table('telemetry_event_receipts')
                    ->where('event_token', $shadow->eventToken)->value('fingerprint');
                if (!is_string($existing)
                    || !hash_equals($shadow->fingerprint(), $existing)) {
                    // Roll back canonical admission and counter increment.
                    throw new RuntimeException('telemetry.shadow_alias_collision');
                }
            }

            return $result;
        }, 3);
    }
}
