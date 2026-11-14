<?php
declare(strict_types=1);

namespace App\Telemetry;

use Carbon\CarbonImmutable;
use DateTimeZone;
use Illuminate\Database\Connection;
use InvalidArgumentException;

/**
 * INTERNAL diagnostics: compare a real authenticated server creation ledger
 * with admitted aggregate counts. This is NOT a proof of event membership or
 * safe authorization to disclose counts, especially in small cohorts.
 *
 * No raw rows, account/operation IDs, receipts, actor tokens, keys or private
 * assignment documents are read. Never mount this class as an HTTP/Admin
 * endpoint without separately accepted MFA/RBAC, consent and policy review.
 */
final readonly class AssignmentCoverageAudit
{
    public function __construct(
        private Connection $db,
        private InternalAggregateReader $aggregates,
    ) {}

    /**
     * Only fully elapsed UTC calendar days whose midnight lies strictly
     * AFTER the 7-day collector cutoff are comparable. The current partial
     * day and the earliest partial collector window are deliberately excluded.
     * At most 6 days; empty source is NOT evidence of full coverage.
     *
     * @return array{
     *   metric:string,from:string,to:string,coverageProven:false,
     *   consistency:string,
     *   days:list<array{
     *     day:string,sourceCount:int,observedCount:?int,status:string
     *   }>
     * }
     */
    public function compare(int $serverNowMs, string $from, string $to): array
    {
        if ($serverNowMs < 1 || $serverNowMs > 9007199254740991
            || $serverNowMs > (int) floor(microtime(true) * 1000) + 300000) {
            throw new InvalidArgumentException('telemetry.coverage_invalid_clock');
        }
        $utc = new DateTimeZone('UTC');
        $day = static function (string $value) use ($utc): CarbonImmutable {
            if (preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/D', $value) !== 1) {
                throw new InvalidArgumentException('telemetry.coverage_invalid_window');
            }
            $parsed = CarbonImmutable::createFromFormat('!Y-m-d', $value, $utc);
            if ($parsed === false || $parsed->format('Y-m-d') !== $value) {
                throw new InvalidArgumentException('telemetry.coverage_invalid_window');
            }
            return $parsed;
        };
        $start = $day($from);
        $end = $day($to);
        $now = CarbonImmutable::createFromTimestampMs($serverNowMs, 'UTC');
        $oldestFullDay = $now->subMilliseconds(TelemetryCollector::MAX_PAST_MS)
            ->startOfDay()->addDay();
        $latestFullDay = $now->startOfDay()->subDay();
        if ($start < $oldestFullDay || $end > $latestFullDay || $end < $start
            || ($end->getTimestamp() - $start->getTimestamp()) > 5 * 86400) {
            throw new InvalidArgumentException('telemetry.coverage_invalid_window');
        }

        // The existing reader independently validates the metric and reads
        // ONLY aggregate counters. Never derive "complete" from its points.
        $observed = $this->aggregates->read('assignment.created', 'day', $from, $to);
        $counts = [];
        foreach ($observed['points'] as $point) {
            $counts[$point['period']] = $point['count'];
        }
        $days = [];
        for ($cursor = $start; $cursor <= $end; $cursor = $cursor->addDay()) {
            $kind = $this->db->getDriverName();
            if (!in_array($kind, ['pgsql', 'sqlite'], true)) {
                throw new \RuntimeException('telemetry.coverage_unsupported_database');
            }
            // PostgreSQL timestampTz binds have EXPLICIT +00:00 to remain
            // invariant when the connection session timezone is non-UTC.
            // SQLite stored UTC values use the Laravel microsecond format.
            $format = $kind === 'pgsql' ? 'Y-m-d H:i:s.uP' : 'Y-m-d H:i:s.u';
            $sourceCount = $this->db->table('assignment_creation_meter_v1')
                ->where('created_at', '>=', $cursor->format($format))
                ->where('created_at', '<', $cursor->addDay()->format($format))
                ->count();
            $key = $cursor->format('Y-m-d');
            $amount = $counts[$key] ?? null;
            $status = match (true) {
                $amount === null && $sourceCount === 0 => 'no_evidence',
                $amount === null => 'missing_ingestion',
                $amount < $sourceCount => 'shortfall_provisional',
                $amount > $sourceCount => 'excess_untrusted',
                default => 'counts_match_unverified',
            };
            $days[] = [
                'day' => $key, 'sourceCount' => $sourceCount,
                // Missing != a confirmed zero.
                'observedCount' => $amount, 'status' => $status,
            ];
        }
        return [
            'metric' => 'assignment.created', 'from' => $from, 'to' => $to,
            'coverageProven' => false,
            // An equal count is NOT a receipt-level proof: unrelated or
            // duplicate sources could coincidentally hide dropped events.
            // SQL reads may reflect concurrent writes; differences are
            // indicators, not final audited reconciliation verdicts.
            'consistency' => 'provisional_count_comparison',
            'days' => $days,
        ];
    }
}
