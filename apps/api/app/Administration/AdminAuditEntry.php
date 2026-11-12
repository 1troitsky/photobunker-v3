<?php
declare(strict_types=1);

namespace App\Administration;

/**
 * Strict audit-event *draft*. It does not write to the database, authenticate
 * a caller, or guarantee tamper evidence. A production append-only store must
 * anchor/sign digests outside the server before such guarantees are made.
 *
 * Never accept arbitrary reason text, IP strings, message bodies, photo IDs
 * mixed with plaintext metadata, or keys as audit fields.
 */
final readonly class AdminAuditEntry implements \JsonSerializable
{
    private const UUID = '/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$/D';
    private const HEX = '/^[a-f0-9]{64}$/D';
    private const TEMPORARY_MS = 90 * 24 * 60 * 60 * 1000;
    private const TRIAL_MS = 365 * 24 * 60 * 60 * 1000;

    private function __construct(
        public string $operationId,
        public string $actorId,
        public string $action,
        public string $targetType,
        public string $targetReference,
        public string $reasonCode,
        public int $issuedAtMs,
        public ?int $expiresAtMs,
        public string $previousDigest,
        public string $digest
    ) {}

    public static function draft(
        ?AdminPrincipal $actor,
        string $operationId,
        string $action,
        string $targetType,
        string $targetReference,
        string $reasonCode,
        int $issuedAtMs,
        ?int $expiresAtMs,
        string $previousDigest
    ): self {
        AdminPolicy::requireAllowed($actor, $action, $issuedAtMs);
        // Unknown action/target combinations are denied, not coerced.
        $targetForAction = [
            'analytics.read' => 'system',
            'accounts.suspend' => 'account',
            'devices.revoke' => 'device',
            'ip.block' => 'ip_digest',
            'grants.issue' => 'account',
            'roles.change' => 'account',
        ];
        if (preg_match(self::UUID, $operationId) !== 1
            || ($targetForAction[$action] ?? null) !== $targetType
            || preg_match('/^[a-z][a-z0-9_.-]{2,63}$/D', $reasonCode) !== 1
            || preg_match(self::HEX, $previousDigest) !== 1) {
            throw new \InvalidArgumentException('admin.invalid_audit');
        }
        if ($targetType === 'ip_digest') {
            if (preg_match(self::HEX, $targetReference) !== 1) {
                throw new \InvalidArgumentException('admin.invalid_audit');
            }
        } elseif ($targetType === 'system') {
            if ($targetReference !== 'analytics') {
                throw new \InvalidArgumentException('admin.invalid_audit');
            }
        } elseif (preg_match(self::UUID, $targetReference) !== 1) {
            throw new \InvalidArgumentException('admin.invalid_audit');
        }

        $limit = match ($action) {
            'accounts.suspend', 'ip.block' => self::TEMPORARY_MS,
            'grants.issue' => self::TRIAL_MS,
            default => null,
        };
        if ($limit !== null) {
            if ($expiresAtMs === null || $expiresAtMs <= $issuedAtMs
                || $expiresAtMs - $issuedAtMs > $limit) {
                throw new \InvalidArgumentException('admin.invalid_expiry');
            }
        } elseif ($expiresAtMs !== null) {
            throw new \InvalidArgumentException('admin.invalid_expiry');
        }
        $fields = [
            'version' => 1,
            'operationId' => $operationId,
            'actorId' => $actor->accountId,
            'action' => $action,
            'targetType' => $targetType,
            'targetReference' => $targetReference,
            'reasonCode' => $reasonCode,
            'issuedAtMs' => $issuedAtMs,
            'expiresAtMs' => $expiresAtMs,
            'previousDigest' => $previousDigest,
        ];
        // Hash is a consistency aid until an independent signed anchor exists.
        $digest = hash('sha256', json_encode($fields, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
        return new self($operationId, $actor->accountId, $action, $targetType,
            $targetReference, $reasonCode, $issuedAtMs, $expiresAtMs, $previousDigest, $digest);
    }

    public function jsonSerialize(): array
    {
        return [
            'version' => 1,
            'operationId' => $this->operationId,
            'actorId' => $this->actorId,
            'action' => $this->action,
            'targetType' => $this->targetType,
            'targetReference' => $this->targetReference,
            'reasonCode' => $this->reasonCode,
            'issuedAtMs' => $this->issuedAtMs,
            'expiresAtMs' => $this->expiresAtMs,
            'previousDigest' => $this->previousDigest,
            'digest' => $this->digest,
        ];
    }
}
