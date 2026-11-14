<?php
declare(strict_types=1);

namespace App\Telemetry;

use Carbon\CarbonImmutable;
use Illuminate\Database\Connection;
use InvalidArgumentException;
use RuntimeException;

/**
 * Bounded, read-only INTERNAL diagnostic for authoritative assignment ledger
 * rows and their exact privacy-minimized durable telemetry receipts.
 *
 * Source UUIDs and HMAC event tokens exist in local memory only; this class
 * returns NO identifiers, tokens, fingerprints, timestamps, secret or rows.
 * A matched receipt is stronger evidence than an equal daily counter, but
 * does not prove accurate aggregate counters, all-source coverage, legal
 * consent, key continuity, or an atomic snapshot against concurrent writers.
 * Not a publicly authorized Admin endpoint.
 */
final readonly class AssignmentReceiptLineageAudit
{
    public function __construct(
        private Connection $db,
        private string $hmacSecret,
    ) {
        if (strlen($hmacSecret) < 32 || strlen($hmacSecret) > 4096) {
            throw new InvalidArgumentException('telemetry.lineage_invalid_secret');
        }
    }

    /**
     * One *fully completed* UTC day, wholly within the Collector's past
     * acceptance window. No cursor leaves this process. A truncated scan is
     * only a diagnostic sample, never evidence of completeness.
     *
     * @return array{
     *  scanned:int,matched:int,missing:int,conflicting:int,
     *  scanComplete:bool,coverageProven:false,consistency:string
     * }
     */
    public function inspect(int $serverNowMs, string $utcDay, int $maxRows = 100): array
    {
        if ($serverNowMs < 1 || $serverNowMs > 9007199254740991
            || $serverNowMs > (int) floor(microtime(true) * 1000) + 300000) {
            throw new InvalidArgumentException('telemetry.lineage_invalid_clock');
        }
        if ($maxRows < 1 || $maxRows > 200
            || preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/D', $utcDay) !== 1) {
            throw new InvalidArgumentException('telemetry.lineage_invalid_window');
        }

        $start = CarbonImmutable::createFromFormat('!Y-m-d', $utcDay, 'UTC');
        if ($start === false || $start->format('Y-m-d') !== $utcDay) {
            throw new InvalidArgumentException('telemetry.lineage_invalid_window');
        }
        $now = CarbonImmutable::createFromTimestampMs($serverNowMs, 'UTC');
        $earliestWhole = $now->subMilliseconds(TelemetryCollector::MAX_PAST_MS)
            ->startOfDay()->addDay();
        if ($start < $earliestWhole || $start >= $now->startOfDay()) {
            throw new InvalidArgumentException('telemetry.lineage_invalid_window');
        }
        $driver = $this->db->getDriverName();
        if ($driver !== 'pgsql' && $driver !== 'sqlite') {
            throw new RuntimeException('telemetry.lineage_unsupported_database');
        }

        // PG timestamptz comparisons always use explicit UTC offsets even if
        // the SQL session timezone is configured differently. SQLite's
        // canonical test storage uses timezone-free UTC microseconds.
        $format = $driver === 'pgsql' ? 'Y-m-d H:i:s.uP' : 'Y-m-d H:i:s.u';
        $rows = $this->db->table('assignment_creation_meter_v1')
            ->select(['owner_account_id', 'operation_id', 'created_at'])
            ->where('created_at', '>=', $start->format($format))
            ->where('created_at', '<', $start->addDay()->format($format))
            ->orderBy('created_at')->orderBy('operation_id')
            ->limit($maxRows + 1)->get();

        $truncated = $rows->count() > $maxRows;
        $expectedByToken = [];
        foreach ($rows->take($maxRows) as $source) {
            if (!is_string($source->owner_account_id)
                || !TelemetryEvent::validAccountId($source->owner_account_id)
                || !is_string($source->operation_id)) {
                throw new RuntimeException('telemetry.lineage_invalid_source');
            }
            try {
                $at = CarbonImmutable::parse((string) $source->created_at, 'UTC');
                if ($at->format('Y-m-d') !== $utcDay) {
                    throw new RuntimeException('telemetry.lineage_invalid_source');
                }
                $event = TelemetryEvent::fromArray([
                    'schemaVersion' => 1,
                    'eventId' => $source->operation_id,
                    'eventType' => 'assignment.created',
                    'occurredAtMs' => $at->getTimestampMs(),
                ]);
            } catch (\Throwable) {
                throw new RuntimeException('telemetry.lineage_invalid_source');
            }

            $record = TelemetryRecord::fromTrusted(
                $event, $source->owner_account_id, $this->hmacSecret,
            );
            if (array_key_exists($record->eventToken, $expectedByToken)) {
                throw new RuntimeException('telemetry.lineage_duplicate_source');
            }
            $expectedByToken[$record->eventToken] = $record->fingerprint();
        }

        $receipts = [];
        if ($expectedByToken !== []) {
            // Single bounded lookup. Only HMAC-indexed receipt and hash
            // columns: no users, raw IDs, actor tokens or private metadata.
            $saved = $this->db->table('telemetry_event_receipts')
                ->select(['event_token', 'fingerprint'])
                ->whereIn('event_token', array_keys($expectedByToken))->get();
            foreach ($saved as $row) {
                $receipts[$row->event_token] = $row->fingerprint;
            }
        }

        $matched = 0;
        $missing = 0;
        $conflicting = 0;
        foreach ($expectedByToken as $token => $fingerprint) {
            if (!array_key_exists($token, $receipts)) {
                $missing++;
            } elseif (!is_string($receipts[$token])
                || !hash_equals($fingerprint, $receipts[$token])) {
                $conflicting++;
            } else {
                $matched++;
            }
        }
        return [
            'scanned' => count($expectedByToken),
            'matched' => $matched,
            'missing' => $missing,
            'conflicting' => $conflicting,
            'scanComplete' => !$truncated,
            'coverageProven' => false,
            'consistency' => 'receipt_lineage_provisional',
        ];
    }
}
