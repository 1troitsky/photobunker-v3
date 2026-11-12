<?php
declare(strict_types=1);

namespace App\Telemetry;

use InvalidArgumentException;

/**
 * Internal event *intent*, never a public HTTP contract.
 *
 * Zero arbitrary properties: no names, coordinates, user IDs, IP addresses,
 * messages, recovery material, URLs, media IDs or nested metadata.
 */
final readonly class TelemetryEvent
{
    private const UUID = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/D';

    private const EVENT_TYPES = [
        'session.active' => true,
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

    private function __construct(
        public string $eventId,
        public string $eventType,
        public int $occurredAtMs,
    ) {}

    /**
     * All 4 keys are mandatory. No string coercion, extra properties or
     * plausible-looking JSON payloads are accepted.
     */
    public static function fromArray(array $input): self
    {
        $keys = array_keys($input);
        sort($keys, SORT_STRING);
        if ($keys !== ['eventId', 'eventType', 'occurredAtMs', 'schemaVersion']
            || $input['schemaVersion'] !== 1
            || !is_string($input['eventId'])
            || preg_match(self::UUID, $input['eventId']) !== 1
            || !is_string($input['eventType'])
            || !array_key_exists($input['eventType'], self::EVENT_TYPES)
            || !is_int($input['occurredAtMs'])
            || $input['occurredAtMs'] < 1
            || $input['occurredAtMs'] > 9007199254740991) {
            throw new InvalidArgumentException('telemetry.invalid_event');
        }

        return new self(
            $input['eventId'], $input['eventType'], $input['occurredAtMs'],
        );
    }

    public static function validAccountId(string $accountId): bool
    {
        return preg_match(self::UUID, $accountId) === 1;
    }
}
