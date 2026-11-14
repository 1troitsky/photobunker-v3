<?php
declare(strict_types=1);

namespace App\Telemetry;

use Carbon\CarbonImmutable;
use Illuminate\Database\Connection;
use InvalidArgumentException;
use RuntimeException;

/**
 * Opt-in, INTERNAL replay of real, server-admitted assignment creations.
 *
 * The append-only assignment_creation_meter_v1 is written in the same
 * authenticated account-locked transaction as a new signed assignment.
 * Neither the browser nor an event JSON caller supplies the actor or event.
 * There is deliberately NO public route, scheduler or automatic producer.
 *
 * Only ID columns are held ephemerally in PHP. TelemetryCollector HMACs them
 * before storing; titles, descriptions, encrypted envelopes, IPs and GPS
 * are neither read nor persisted in analytics.
 */
final readonly class AssignmentCreationReplay
{
    public function __construct(
        private Connection $db,
        private TelemetryCollector $collector,
    ) {}

    /**
     * Scan an immutable server ledger in a bounded UTC/keyset page. The
     * returned cursor is PRIVATE to the trusted internal caller: never log,
     * cache in analytics, expose via API or pass from a browser request.
     * Replay from NULL after a crash: the durable sink dedupes receipts.
     *
     * @param array{createdAt:string,assignmentId:string}|null $after
     * @return array{accepted:int,duplicate:int,hasMore:bool,next:?array}
     */
    public function replayPage(int $serverNowMs, int $limit = 100, ?array $after = null): array
    {
        if ($serverNowMs <= 0 || $serverNowMs > 9007199254740991
            || $limit < 1 || $limit > 200) {
            throw new InvalidArgumentException('telemetry.source_invalid_bounds');
        }
        if ($after !== null) {
            $keys = array_keys($after);
            sort($keys, SORT_STRING);
            if ($keys !== ['assignmentId', 'createdAt']
                || !is_string($after['assignmentId'])
                || !TelemetryEvent::validAccountId($after['assignmentId'])
                || !is_string($after['createdAt'])
                || preg_match('/\A\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}\z/D', $after['createdAt']) !== 1) {
                throw new InvalidArgumentException('telemetry.source_invalid_cursor');
            }
        }

        $now = CarbonImmutable::createFromTimestampMs($serverNowMs, 'UTC');
        $lower = $now->subMilliseconds(TelemetryCollector::MAX_PAST_MS)
            ->format('Y-m-d H:i:s.u');
        $upper = $now->addMilliseconds(TelemetryCollector::MAX_FUTURE_MS)
            ->format('Y-m-d H:i:s.u');
        $query = $this->db->table('assignment_creation_meter_v1')
            ->select(['assignment_id', 'owner_account_id', 'operation_id', 'created_at'])
            ->where('created_at', '>=', $lower)
            ->where('created_at', '<=', $upper);
        if ($after !== null) {
            // Keyset (not OFFSET) preserves rows across concurrent inserts.
            $query->where(static function ($q) use ($after): void {
                $q->where('created_at', '>', $after['createdAt'])
                    ->orWhere(static function ($tie) use ($after): void {
                        $tie->where('created_at', '=', $after['createdAt'])
                            ->where('assignment_id', '>', $after['assignmentId']);
                    });
            });
        }
        $rows = $query->orderBy('created_at')->orderBy('assignment_id')
            ->limit($limit + 1)->get();

        $accepted = 0;
        $duplicate = 0;
        $last = null;
        foreach ($rows->take($limit) as $row) {
            if (!is_string($row->owner_account_id)
                || !is_string($row->operation_id)
                || !is_string($row->assignment_id)) {
                throw new RuntimeException('telemetry.source_invalid_row');
            }
            try {
                $instant = CarbonImmutable::parse((string) $row->created_at, 'UTC');
            } catch (\Throwable) {
                throw new RuntimeException('telemetry.source_invalid_time');
            }
            // Do not derive an event from a UI timestamp, contract_json or
            // mutable assignment_records_v1; this immutable ledger survives GC.
            $decision = $this->collector->ingest([
                'schemaVersion' => 1,
                'eventId' => $row->operation_id,
                'eventType' => 'assignment.created',
                'occurredAtMs' => $instant->getTimestampMs(),
            ], $row->owner_account_id, $serverNowMs);
            if ($decision === TelemetryDecision::Accepted) {
                $accepted++;
            } elseif ($decision === TelemetryDecision::Duplicate) {
                $duplicate++;
            } else {
                // Corruption, conflicting idempotency or out-of-range signals
                // require operator attention; never silently advance cursor.
                throw new RuntimeException('telemetry.source_admission_'.$decision->value);
            }
            $last = [
                'createdAt' => $instant->format('Y-m-d H:i:s.u'),
                'assignmentId' => $row->assignment_id,
            ];
        }

        $hasMore = $rows->count() > $limit;
        return [
            'accepted' => $accepted,
            'duplicate' => $duplicate,
            'hasMore' => $hasMore,
            'next' => $hasMore ? $last : null,
        ];
    }
}
