<?php
declare(strict_types=1);

namespace App\Telemetry;

use JsonSerializable;

/**
 * Only this privacy-minimized record is passed to persistent ingestion.
 *
 * activity tokens are period-scoped HMACs. These tokens are not anonymous in
 * the formal sense: administrators of the HMAC secret and identity database
 * could recompute them. Never expose them in UI, logs or API responses.
 */
final readonly class TelemetryRecord implements JsonSerializable
{
    private function __construct(
        public string $eventToken,
        public string $eventType,
        public string $utcDay,
        public string $isoWeek,
        public string $calendarMonth,
        public ?string $dailyActorToken,
        public ?string $weeklyActorToken,
        public ?string $monthlyActorToken,
    ) {}

    /**
     * Trusted accountId must be derived from a server-authenticated context.
     * Neither it nor raw eventId, event time, or HMAC key is persisted here.
     */
    public static function fromTrusted(
        TelemetryEvent $event, string $trustedAccountId, string $secret,
    ): self {
        $epoch = intdiv($event->occurredAtMs, 1000);
        $day = gmdate('Y-m-d', $epoch);
        $week = gmdate('o-\WW', $epoch); // ISO week-year, not calendar year
        $month = gmdate('Y-m', $epoch);
        $token = static function (string $domain, string $material) use ($secret): string {
            return hash_hmac(
                'sha256', "pb3.telemetry.v1\0" . $domain . "\0" . $material, $secret,
            );
        };

        $actor = $event->eventType === 'session.active';
        return new self(
            $token('event', $trustedAccountId . "\0" . $event->eventId),
            $event->eventType,
            $day,
            $week,
            $month,
            $actor ? $token('actor.day', $day . "\0" . $trustedAccountId) : null,
            $actor ? $token('actor.week', $week . "\0" . $trustedAccountId) : null,
            $actor ? $token('actor.month', $month . "\0" . $trustedAccountId) : null,
        );
    }

    public function jsonSerialize(): array
    {
        return [
            'version' => 1,
            'eventToken' => $this->eventToken,
            'eventType' => $this->eventType,
            'utcDay' => $this->utcDay,
            'isoWeek' => $this->isoWeek,
            'calendarMonth' => $this->calendarMonth,
            'dailyActorToken' => $this->dailyActorToken,
            'weeklyActorToken' => $this->weeklyActorToken,
            'monthlyActorToken' => $this->monthlyActorToken,
        ];
    }

    /** Event identity conflicts must not silently add to aggregate counters. */
    public function fingerprint(): string
    {
        return hash('sha256', json_encode(
            $this, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
        ));
    }
}
