<?php
declare(strict_types=1);

namespace App\Events;

use Illuminate\Support\Facades\DB;

/**
 * Durable tenant-scoped sequence admission, not a delivery queue or UI ACK.
 *
 * Lock a verified account row to serialize cross-worker writers, including the
 * very first write to a stream. UNIQUE keys fence both event ID and revision.
 * Gapped events remain durable and become sequenced once their gap is filled.
 * The contiguous revision is NOT a downstream consumer/transport checkpoint.
 */
final class DatabaseEventInboxLedger implements EventInboxLedger
{
    private const MAX_PENDING_GAP = 128;
    private const EVENTS = 'notification_event_ledger_v1';
    private const STREAMS = 'notification_event_streams_v1';

    public function admit(EventEnvelope $event): EventAdmission
    {
        return DB::transaction(function () use ($event): EventAdmission {
            // This service is internal: trusted producer identity/scope must
            // already be verified by EventConsumer and the calling producer.
            $account = DB::table('identity_accounts')
                ->where('id', $event->accountId)->lockForUpdate()->first();
            if ($account === null || $account->status !== 'ready') {
                return EventAdmission::Quarantined;
            }
            $byId = DB::table(self::EVENTS)
                ->where('account_id', $event->accountId)
                ->where('event_id', $event->eventId)->first();
            if ($byId !== null) {
                return hash_equals($byId->fingerprint, $event->fingerprint())
                    ? EventAdmission::Duplicate : EventAdmission::Conflict;
            }

            $stream = $this->streamQuery($event);
            $state = $stream->first();
            if ($state === null) {
                DB::table(self::STREAMS)->insert([
                    'account_id' => $event->accountId,
                    'subject_type' => $event->subjectType,
                    'subject_id' => $event->subjectId,
                    'contiguous_revision' => 0,
                ]);
                $revision = 0;
            } else {
                $revision = (int) $state->contiguous_revision;
            }

            // Bound the number of durable deferred revisions per stream. A producer
            // with a huge revision jump cannot exhaust persistent storage.
            if ($event->revision > $revision + self::MAX_PENDING_GAP) {
                return EventAdmission::Quarantined;
            }

            if ($event->revision <= $revision ||
                DB::table(self::EVENTS)->where('account_id', $event->accountId)
                    ->where('subject_type', $event->subjectType)
                    ->where('subject_id', $event->subjectId)
                    ->where('revision', $event->revision)->exists()) {
                return EventAdmission::Conflict;
            }

            $inOrder = $event->revision === $revision + 1;
            DB::table(self::EVENTS)->insert([
                'account_id' => $event->accountId,
                'event_id' => $event->eventId,
                'subject_type' => $event->subjectType,
                'subject_id' => $event->subjectId,
                'revision' => $event->revision,
                'fingerprint' => $event->fingerprint(),
                'envelope_json' => json_encode($event, JSON_THROW_ON_ERROR),
                'admission_state' => $inOrder ? 'sequenced' : 'deferred',
                'received_at' => now(),
            ]);

            if (!$inOrder) {
                return EventAdmission::Deferred;
            }

            // Fill contiguous holes; no external side effects inside the
            // transaction. Pending rows remain queryable after worker restart.
            $next = $event->revision + 1;
            while ($next <= 2147483647) {
                $pending = DB::table(self::EVENTS)
                    ->where('account_id', $event->accountId)
                    ->where('subject_type', $event->subjectType)
                    ->where('subject_id', $event->subjectId)
                    ->where('revision', $next)
                    ->where('admission_state', 'deferred')->first();
                if ($pending === null) {
                    break;
                }
                DB::table(self::EVENTS)
                    ->where('account_id', $event->accountId)
                    ->where('event_id', $pending->event_id)
                    ->update(['admission_state' => 'sequenced']);
                $next++;
            }
            $this->streamQuery($event)->update([
                'contiguous_revision' => $next - 1,
            ]);
            return EventAdmission::Accepted;
        }, 3);
    }

    private function streamQuery(EventEnvelope $event): \Illuminate\Database\Query\Builder
    {
        return DB::table(self::STREAMS)
            ->where('account_id', $event->accountId)
            ->where('subject_type', $event->subjectType)
            ->where('subject_id', $event->subjectId);
    }
}
