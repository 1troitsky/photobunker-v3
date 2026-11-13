<?php
declare(strict_types=1);

namespace App\Events;

use InvalidArgumentException;
use JsonSerializable;

/**
 * Minimal account-scoped event metadata. No arbitrary event payload is allowed:
 * especially no filenames, GPS, plaintext media, PIN, Recovery Key or crypto.
 *
 * This DTO does not prove a producer's signature or grant access to its subject.
 * Producers must be authenticated and authorized outside this module.
 */
final readonly class EventEnvelope implements JsonSerializable
{
    private const MAX_SAFE_INTEGER = 9007199254740991;
    private const UUID_PATTERN =
        '/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/D';

    /** Event type => opaque subject category; this is an exhaustive allowlist. */
    private const SUBJECTS = [
        'AccountCreated' => 'account',
        'DeviceRevoked' => 'device',
        'AssignmentChanged' => 'assignment',
        'MediaCommitted' => 'media',
        'MediaExpired' => 'media',
        'GrantRevoked' => 'grant',
        'BackupVerified' => 'backup',
        'PanicIntentCreated' => 'panic_intent',
        'SubscriptionEntitlementChanged' => 'entitlement',
    ];

    private function __construct(
        public int $schemaVersion,
        public string $eventId,
        public string $eventType,
        public string $accountId,
        public string $subjectType,
        public string $subjectId,
        public int $occurredAtMs,
        public int $revision,
    ) {}

    /**
     * Strict decoding: reject extra/missing keys, nested arbitrary data, coerced
     * strings, Unicode lookalikes and UUIDs outside canonical RFC 4122 form.
     *
     * @param array<mixed> $input
     */
    public static function fromArray(array $input): self
    {
        $keys = array_keys($input);
        sort($keys, SORT_STRING);
        if ($keys !== [
            'accountId', 'eventId', 'eventType', 'occurredAtMs',
            'revision', 'schemaVersion', 'subjectId', 'subjectType',
        ]) {
            throw new InvalidArgumentException('events.invalid_envelope');
        }

        if ($input['schemaVersion'] !== 1
            || !is_string($input['eventId']) || !self::uuid($input['eventId'])
            || !is_string($input['accountId']) || !self::uuid($input['accountId'])
            || !is_string($input['subjectId']) || !self::uuid($input['subjectId'])
            || !is_string($input['eventType'])
            || !array_key_exists($input['eventType'], self::SUBJECTS)
            || !is_string($input['subjectType'])
            || self::SUBJECTS[$input['eventType']] !== $input['subjectType']
            || !is_int($input['occurredAtMs'])
            || $input['occurredAtMs'] <= 0
            || $input['occurredAtMs'] > self::MAX_SAFE_INTEGER
            || !is_int($input['revision'])
            || $input['revision'] < 1
            || $input['revision'] > 2147483647
            || ($input['eventType'] === 'AccountCreated'
                && $input['subjectId'] !== $input['accountId'])) {
            throw new InvalidArgumentException('events.invalid_envelope');
        }

        return new self(
            $input['schemaVersion'],
            $input['eventId'],
            $input['eventType'],
            $input['accountId'],
            $input['subjectType'],
            $input['subjectId'],
            $input['occurredAtMs'],
            $input['revision'],
        );
    }

    public static function isCanonicalUuid(string $value): bool
    {
        return self::uuid($value);
    }

    private static function uuid(string $value): bool
    {
        return preg_match(self::UUID_PATTERN, $value) === 1;
    }

    /** Canonical, bounded metadata only. Never include server-supplied payload. */
    public function jsonSerialize(): array
    {
        return [
            'schemaVersion' => $this->schemaVersion,
            'eventId' => $this->eventId,
            'eventType' => $this->eventType,
            'accountId' => $this->accountId,
            'subjectType' => $this->subjectType,
            'subjectId' => $this->subjectId,
            'occurredAtMs' => $this->occurredAtMs,
            'revision' => $this->revision,
        ];
    }

    /** Identical eventId with different content must be rejected, not deduped. */
    public function fingerprint(): string
    {
        return hash('sha256', json_encode(
            $this,
            JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
        ));
    }

    /** Tenant-scoped revision stream; never an authorization capability. */
    public function streamKey(): string
    {
        return $this->accountId . ':' . $this->subjectType . ':' . $this->subjectId;
    }
}
