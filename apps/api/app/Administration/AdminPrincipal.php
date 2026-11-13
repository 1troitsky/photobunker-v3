<?php
declare(strict_types=1);

namespace App\Administration;

/**
 * A trusted server-side adapter must construct this from independently
 * authenticated identity + MFA + audited role grants. NEVER from request JSON.
 */
final readonly class AdminPrincipal
{
    public function __construct(
        public string $accountId,
        public string $role,
        public int $expiresAtMs,
        public ?int $mfaVerifiedAtMs
    ) {
        if (preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D', $accountId) !== 1
            || !in_array($role, ['auditor', 'operator', 'owner'], true)
            || $expiresAtMs <= 0
            || ($mfaVerifiedAtMs !== null && $mfaVerifiedAtMs < 0)) {
            throw new \InvalidArgumentException('admin.invalid_principal');
        }
    }
}
