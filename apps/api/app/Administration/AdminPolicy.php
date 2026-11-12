<?php
declare(strict_types=1);

namespace App\Administration;

/**
 * Pure fail-closed RBAC/MFA decision. This is NOT an authentication endpoint;
 * integration must verify identity, MFA proof and grant expiry independently.
 * Operators never receive decryption keys or E2EE plaintext.
 */
final class AdminPolicy
{
    private const MFA_MAX_AGE_MS = 300_000; // 5 minutes

    /** Explicit allowlist; an unknown permission can never be granted. */
    private const PERMISSIONS = [
        'analytics.read' => ['auditor', 'operator', 'owner'],
        'accounts.suspend' => ['operator', 'owner'],
        'devices.revoke' => ['operator', 'owner'],
        'ip.block' => ['operator', 'owner'],
        'grants.issue' => ['owner'],
        'roles.change' => ['owner'],
    ];

    public static function requireAllowed(?AdminPrincipal $actor, string $permission, int $nowMs): void
    {
        if ($actor === null || $nowMs < 0
            || !array_key_exists($permission, self::PERMISSIONS)
            || !in_array($actor->role, self::PERMISSIONS[$permission], true)
            || $actor->expiresAtMs <= $nowMs
            || $actor->mfaVerifiedAtMs === null
            || $actor->mfaVerifiedAtMs > $nowMs
            || $nowMs - $actor->mfaVerifiedAtMs > self::MFA_MAX_AGE_MS) {
            throw new \DomainException('admin.access_denied');
        }
    }
}
