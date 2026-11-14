<?php
declare(strict_types=1);

namespace App\Events;

use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * P1 #406 — persistent admission only. "Accepted" means stored in the inbox,
 * never delivered to subscribers or applied to an encrypted asset.
 *
 * All writers MUST enter via this account-scoped PostgreSQL transaction.
 * Unique DB constraints remain a last line of defense against rogue writers.
 * No arbitrary event payload, location, filename or secret is persisted.
 */
final class PostgresEventInboxLedger implements EventInboxLedger
{
    private const TABLE = 'event_inbox_receipts_v1';
    private const MAX_AHEAD_REVISIONS = 64;
    private const MAX_DEFERRED_PER_ACCOUNT = 512;

    private Connection $connection;

    public function __construct(?Connection $connection = null)
    {
        $this->connection = $connection ?? DB::connection();
        if ($this->connection->getDriverName() !== 'pgsql') {
            throw new RuntimeException('events.postgres_required');
        }
    }

    public function admit(EventEnvelope $event): EventAdmission
    {
        // PostgreSQL transaction-scoped account lock serializes concurrent
        // claims of an event ID or stream revision, even across PHP processes.
        // A hash collision can slow independent tenants but cannot authorize
        // cross-account access: every subsequent query remains account-scoped.
        return $this->connection->transaction(function () use ($event): EventAdmission {
            $this->connection->select(
                'SELECT pg_advisory_xact_lock(hashtextextended(?, 0))',
                ['pb3.event-inbox.v1.'.$event->accountId]
            );

            $events = $this->connection->table(self::TABLE);
            $existing = (clone $events)
                ->where('account_id', $event->accountId)
                ->where('event_id', $event->eventId)
                ->first();

            $fingerprint = $event->fingerprint();
            if ($existing !== null && !hash_equals((string) $existing->fingerprint, $fingerprint)) {
                return EventAdmission::Conflict;
            }
            if ($existing !== null && $existing->admission_state === 'accepted') {
                return EventAdmission::Duplicate;
            }

            // One account/subject/revision may have exactly one eventId,
            // regardless of arrival order or event type.
            $atRevision = (clone $events)
                ->where('account_id', $event->accountId)
                ->where('subject_type', $event->subjectType)
                ->where('subject_id', $event->subjectId)
                ->where('revision', $event->revision)
                ->first();
            if ($atRevision !== null && $atRevision->event_id !== $event->eventId) {
                return EventAdmission::Conflict;
            }

            $head = (int) ((clone $events)
                ->where('account_id', $event->accountId)
                ->where('subject_type', $event->subjectType)
                ->where('subject_id', $event->subjectId)
                ->where('admission_state', 'accepted')
                ->max('revision') ?? 0);

            if ($event->revision <= $head) {
                return EventAdmission::Conflict;
            }

            $isNext = $event->revision === $head + 1;
            if (!$isNext && $event->revision - $head > self::MAX_AHEAD_REVISIONS) {
                return EventAdmission::Quarantined; // Too distant: no unbounded queue.
            }
            if ($existing !== null) {
                // A genuinely deferred receipt is NOT a duplicate ACK. It
                // remains deferred until its predecessor is admitted and this
                // exact event is replayed by an eventual trusted dispatcher.
                if (!$isNext) {
                    return EventAdmission::Deferred;
                }
                (clone $events)
                    ->where('account_id', $event->accountId)
                    ->where('event_id', $event->eventId)
                    ->update([
                        'admission_state' => 'accepted',
                        'updated_at' => now(),
                    ]);
                return EventAdmission::Accepted;
            }

            if (!$isNext) {
                $pending = (clone $events)
                    ->where('account_id', $event->accountId)
                    ->where('admission_state', 'deferred')
                    ->count();
                if ($pending >= self::MAX_DEFERRED_PER_ACCOUNT) {
                    return EventAdmission::Quarantined;
                }
            }

            $now = now();
            (clone $events)->insert([
                'account_id' => $event->accountId,
                'event_id' => $event->eventId,
                'subject_type' => $event->subjectType,
                'subject_id' => $event->subjectId,
                'event_type' => $event->eventType,
                'schema_version' => $event->schemaVersion,
                'revision' => $event->revision,
                'occurred_at_ms' => $event->occurredAtMs,
                'fingerprint' => $fingerprint,
                'admission_state' => $isNext ? 'accepted' : 'deferred',
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            return $isNext ? EventAdmission::Accepted : EventAdmission::Deferred;
        }, 1);
    }
}
