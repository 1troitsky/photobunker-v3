<?php
declare(strict_types=1);

namespace App\Telemetry;

use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\Connection;
use InvalidArgumentException;
use RuntimeException;

/**
 * INTERNAL read-only verification of durable UTC counters.
 *
 * Not an admin API, an ACL decision, a dashboard, or permission to export data.
 * Admin MFA/RBAC, consent and an approved privacy/retention policy are required
 * before exposing any of these potentially sensitive small-cohort counts.
 *
 * Missing periods are OMITTED, never invented as zeros. Counts represent
 * what has been admitted, not independently verified source completeness.
 */
final readonly class InternalAggregateReader
{
    private const METRICS = [
        'session.active' => true,
        'session.active.distinct' => true,
        'assignment.created' => true,
        'media.photo.committed' => true,
        'media.video.committed' => true,
        'media.audio.committed' => true,
        'upload.queued' => true,
        'upload.failed' => true,
        'backup.verified' => true,
        'backup.failed' => true,
        'matrix.message.sent' => true,
        'matrix.delivery.failed' => true,
        'storage.request.failed' => true,
        'api.request.failed' => true,
        'device.revoked' => true,
        'subscription.changed' => true,
    ];

    public function __construct(private Connection $db) {}

    /**
     * @return array{
     *   metric:string,periodKind:string,from:string,to:string,
     *   sourceCoverage:string,points:list<array{period:string,count:int}>
     * }
     */
    public function read(string $metric, string $periodKind, string $from, string $to): array
    {
        if (!isset(self::METRICS[$metric])) {
            throw new InvalidArgumentException('telemetry.reader_invalid_metric');
        }

        $start = self::parsePeriod($periodKind, $from);
        $end = self::parsePeriod($periodKind, $to);
        $bounds = match ($periodKind) {
            'day' => ['+30 days', 31],
            'week' => ['+12 weeks', 13],
            'month' => ['+11 months', 12],
            default => throw new InvalidArgumentException('telemetry.reader_invalid_period'),
        };
        if ($end < $start || $end > $start->modify($bounds[0])) {
            throw new InvalidArgumentException('telemetry.reader_invalid_window');
        }

        // Counter table ONLY. Do not query raw source ledgers, receipts,
        // period HMAC actor tokens or any identifiers.
        $rows = $this->db->table('telemetry_counters')
            ->select(['period_key', 'total'])
            ->where('metric', $metric)
            ->where('period_kind', $periodKind)
            ->whereBetween('period_key', [$from, $to])
            ->orderBy('period_key')
            ->limit($bounds[1] + 1)
            ->get();

        if ($rows->count() > $bounds[1]) {
            throw new RuntimeException('telemetry.reader_invalid_counter');
        }
        $points = [];
        foreach ($rows as $row) {
            $period = $row->period_key;
            $raw = $row->total;
            if (!is_string($period)
                || self::parsePeriod($periodKind, $period) < $start
                || self::parsePeriod($periodKind, $period) > $end
                || (!is_int($raw) && !is_string($raw))
                || preg_match('/\A(?:0|[1-9][0-9]*)\z/D', (string) $raw) !== 1) {
                throw new RuntimeException('telemetry.reader_invalid_counter');
            }
            // No platform-dependent integer wrap or silently rounded counts.
            $value = filter_var((string) $raw, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 0],
            ]);
            if ($value === false) {
                throw new RuntimeException('telemetry.reader_invalid_counter');
            }
            $points[] = ['period' => $period, 'count' => $value];
        }
        return [
            'metric' => $metric,
            'periodKind' => $periodKind,
            'from' => $from,
            'to' => $to,
            // This cannot assert the source event pipeline has been enabled
            // or fully replayed; consumers must not show "complete" totals.
            'sourceCoverage' => 'not_proven',
            'points' => $points,
        ];
    }

    private static function parsePeriod(string $kind, string $value): DateTimeImmutable
    {
        $utc = new DateTimeZone('UTC');
        if ($kind === 'day'
            && preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/D', $value) === 1) {
            $day = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $utc);
            if ($day !== false && $day->format('Y-m-d') === $value) {
                return $day;
            }
        } elseif ($kind === 'month'
            && preg_match('/\A[0-9]{4}-[0-9]{2}\z/D', $value) === 1) {
            $month = DateTimeImmutable::createFromFormat('!Y-m', $value, $utc);
            if ($month !== false && $month->format('Y-m') === $value) {
                return $month;
            }
        } elseif ($kind === 'week'
            && preg_match('/\A([0-9]{4})-W([0-9]{2})\z/D', $value, $parts) === 1) {
            $year = (int) $parts[1];
            $week = (int) $parts[2];
            if ($year >= 1 && $week >= 1 && $week <= 53) {
                $monday = (new DateTimeImmutable('2000-01-03', $utc))
                    ->setISODate($year, $week, 1)->setTime(0, 0);
                if ($monday->format('o-\WW') === $value) {
                    return $monday;
                }
            }
        }
        throw new InvalidArgumentException('telemetry.reader_invalid_period');
    }
}
