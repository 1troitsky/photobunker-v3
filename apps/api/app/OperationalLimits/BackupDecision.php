<?php

declare(strict_types=1);

namespace App\OperationalLimits;

/**
 * Server-only domain result. No HTTP route is registered by this issue.
 * Client integration must authenticate the account, bind operation ownership,
 * and expose Retry-After only for a real server rejection.
 */
final readonly class BackupDecision
{
    public function __construct(
        public string $code,
        public int $httpStatus,
        public bool $allowed,
        public bool $idempotent = false,
        public ?string $leaseId = null,
        public ?string $leaseExpiresAt = null,
        public ?string $nextAllowedAt = null,
        public ?int $retryAfter = null,
    ) {}

    /** @return array<string,string> */
    public function headers(): array
    {
        return $this->retryAfter === null ? [] : ['Retry-After' => (string) $this->retryAfter];
    }
}
