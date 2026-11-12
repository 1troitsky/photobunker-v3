<?php
declare(strict_types=1);

namespace App\Telemetry;

use InvalidArgumentException;

/**
 * Strict, opt-in internal telemetry ingestion; not an API route.
 *
 * Call only from server-authorized domain actions. An event's presence is
 * NOT an authorization proof or evidence that the underlying action succeeded.
 */
final readonly class TelemetryCollector
{
    public const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;
    public const MAX_FUTURE_MS = 5 * 60 * 1000;

    private string $secret;

    public function __construct(private TelemetrySink $sink, string $hmacSecret)
    {
        if (strlen($hmacSecret) < 32) {
            throw new InvalidArgumentException('telemetry.weak_secret');
        }
        $this->secret = $hmacSecret;
    }

    /**
     * Caller-supplied account is considered verified ONLY by the hosting
     * application. Never pass client JSON accountId as trustedAccountId.
     * Return only a coarse disposition; do not echo rejected raw inputs.
     */
    public function ingest(
        mixed $rawEvent, string $trustedAccountId, int $serverNowMs,
    ): TelemetryDecision {
        if (!is_array($rawEvent)
            || !TelemetryEvent::validAccountId($trustedAccountId)
            || $serverNowMs <= 0
            || $serverNowMs > 9007199254740991) {
            return TelemetryDecision::Rejected;
        }

        try {
            $event = TelemetryEvent::fromArray($rawEvent);
        } catch (InvalidArgumentException) {
            return TelemetryDecision::Rejected;
        }

        if ($event->occurredAtMs < $serverNowMs - self::MAX_PAST_MS
            || $event->occurredAtMs > $serverNowMs + self::MAX_FUTURE_MS) {
            return TelemetryDecision::OutsideWindow;
        }

        return $this->sink->admit(
            TelemetryRecord::fromTrusted($event, $trustedAccountId, $this->secret),
        );
    }
}
