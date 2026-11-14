<?php
declare(strict_types=1);

namespace App\Panic;

use App\Identity\Protocol;
use DateTimeImmutable;
use DateTimeZone;
use DomainException;
use JsonException;
use Throwable;

/**
 * #221 non-destructive, VERIFY-ONLY parser for WebCrypto P-256 signed Panic intent.
 *
 * DO NOT wire this to a route or an executor. A valid signature does NOT imply
 * an active registered device, an authorized Emergency PIN, a persisted server
 * operation, revocation, deletion or an authenticated ACK.
 *
 * The eventual server transaction MUST load its trusted current account/device
 * binding, device SPKI and key revision from authoritative storage, verify
 * active/non-revoked session, atomically deduplicate operationId, preserve the
 * last verified Recovery Vault snapshot and separately confirm live S3/Matrix GC.
 */
final class SignedIntentPreflight
{
    private const DOMAIN = "photobunker.panic.intent.v1\n";
    private const FIELDS = [
        'accountId', 'deviceId', 'issuedAt', 'keyRevision', 'liveScope',
        'nonce', 'operationId', 'purpose', 'vault', 'version',
    ];
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D';
    private const MAX_FUTURE_SKEW_MS = 120_000;

    /**
     * @param array<string,mixed> $signed untrusted wire {contract,signature}
     * @param array<string,mixed> $trustedScope authoritative accountId,deviceId,keyRevision
     * @param string $trustedDeviceSpki registered device SPKI from authoritative server state
     * @return array{operationId:string,accountId:string,deviceId:string,keyRevision:int,contractHash:string}
     *         Signature/shape proof ONLY; never a deletion authorization or receipt.
     */
    public static function inspect(
        array $signed,
        array $trustedScope,
        string $trustedDeviceSpki,
        int $serverNowMs,
    ): array {
        try {
            self::exact($signed, ['contract', 'signature']);
            self::exact($trustedScope, ['accountId', 'deviceId', 'keyRevision']);
            self::assertUuid($trustedScope['accountId']);
            self::assertUuid($trustedScope['deviceId']);
            self::require(is_int($trustedScope['keyRevision']) && $trustedScope['keyRevision'] >= 1);
            self::require($serverNowMs >= 0 && $serverNowMs <= 8_640_000_000_000_000);
            self::require(is_string($signed['contract'])
                && strlen($signed['contract']) >= 120
                && strlen($signed['contract']) <= 1024
                && is_string($signed['signature']));

            $contract = $signed['contract'];
            $parsed = json_decode($contract, true, 16, JSON_THROW_ON_ERROR);
            self::require(is_array($parsed));
            self::exact($parsed, self::FIELDS);
            self::require(($parsed['version'] ?? null) === 1
                && ($parsed['purpose'] ?? null) === 'panic.live-delete'
                && ($parsed['liveScope'] ?? null) === 'all-live-locations'
                && ($parsed['vault'] ?? null) === 'preserve-existing-verified');
            self::assertUuid($parsed['operationId']);
            self::assertUuid($parsed['accountId']);
            self::assertUuid($parsed['deviceId']);
            self::require(is_int($parsed['keyRevision']) && $parsed['keyRevision'] >= 1
                && $parsed['accountId'] === $trustedScope['accountId']
                && $parsed['deviceId'] === $trustedScope['deviceId']
                && $parsed['keyRevision'] === $trustedScope['keyRevision']);

            // Enforce canonical *bytes*: rejects extra/duplicate keys, altered
            // JSON types, reordered fields, whitespace, hidden expansions.
            $ordered = $parsed;
            ksort($ordered, SORT_STRING);
            self::require(json_encode($ordered, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) === $contract);

            self::require(is_string($parsed['nonce']));
            Protocol::b64($parsed['nonce'], 32);
            self::require(is_string($parsed['issuedAt'])
                && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D', $parsed['issuedAt']) === 1);
            $date = DateTimeImmutable::createFromFormat(
                '!Y-m-d\TH:i:s.v\Z', $parsed['issuedAt'], new DateTimeZone('UTC'),
            );
            self::require($date instanceof DateTimeImmutable
                && $date->format('Y-m-d\TH:i:s.v\Z') === $parsed['issuedAt']);
            $issuedMs = ((int) $date->format('U')) * 1000 + (int) $date->format('v');
            // Offline intents may be old. Never treat an old offline signature
            // as sufficient server authority; current device checks are external.
            self::require($issuedMs <= $serverNowMs + self::MAX_FUTURE_SKEW_MS);

            // Protocol::verify handles WebCrypto IEEE-P1363 64-byte r||s
            // signatures against an external P-256 public key.
            self::require(Protocol::verify(
                $trustedDeviceSpki,
                self::DOMAIN.$contract,
                $signed['signature'],
            ));

            return [
                'operationId' => $parsed['operationId'],
                'accountId' => $parsed['accountId'],
                'deviceId' => $parsed['deviceId'],
                'keyRevision' => $parsed['keyRevision'],
                'contractHash' => hash('sha256', $contract),
            ];
        } catch (Throwable $exception) {
            // Uniform denial, including malformed public keys, unsupported
            // crypto, invalid UTF-8, JSON and base64; no partial receipt.
            throw new DomainException('panic.invalid_intent', previous: $exception);
        }
    }

    /** @param mixed $id */
    private static function assertUuid(mixed $id): void
    {
        self::require(is_string($id) && preg_match(self::UUID, $id) === 1);
    }

    /** @param array<mixed,mixed> $actual @param list<string> $keys */
    private static function exact(array $actual, array $keys): void
    {
        $received = array_keys($actual);
        sort($received, SORT_STRING);
        sort($keys, SORT_STRING);
        self::require($received === $keys);
    }

    private static function require(bool $ok): void
    {
        if (!$ok) {
            throw new DomainException('panic.invalid_intent');
        }
    }
}
