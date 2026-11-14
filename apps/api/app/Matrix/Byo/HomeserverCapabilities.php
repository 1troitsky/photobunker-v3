<?php
declare(strict_types=1);

namespace App\Matrix\Byo;

/**
 * Matrix protocol reply validation only. Inputs MUST originate from a
 * certificate-verified, pinned, redirect-disabled internal transport,
 * never request JSON. $trustedPlanId MUST be checked against a current
 * server-owned entitlement. No network I/O, credential store or E2EE here.
 */
final class HomeserverCapabilities
{
    /**
     * @param array<string,mixed> $versions GET /_matrix/client/versions
     * @param array<string,mixed> $capabilities GET /_matrix/client/v3/capabilities
     * @param array<string,mixed> $whoami GET /_matrix/client/v3/account/whoami
     * @return array{apiVersion:string,defaultRoomVersion:string,matrixUserId:string,matrixDeviceId:string}
     */
    public function verify(
        string $trustedPlanId,
        string $expectedUserId,
        string $expectedDeviceId,
        array $versions,
        array $capabilities,
        array $whoami,
    ): array {
        if ($trustedPlanId !== 'unlimited_plus') {
            throw new \DomainException('matrix.byo_entitlement_denied');
        }

        if (preg_match('~\A@[A-Za-z0-9._=+/-]{1,120}:[A-Za-z0-9.-]{1,100}\z~', $expectedUserId) !== 1
            || preg_match('/\A[\x21-\x7e]{1,128}\z/', $expectedDeviceId) !== 1
            || !isset($whoami['user_id'], $whoami['device_id'])
            || !is_string($whoami['user_id']) || !is_string($whoami['device_id'])
            || !hash_equals($expectedUserId, $whoami['user_id'])
            || !hash_equals($expectedDeviceId, $whoami['device_id'])
            || ($whoami['is_guest'] ?? false) !== false) {
            throw new \DomainException('matrix.byo_identity_mismatch');
        }

        $list = $versions['versions'] ?? null;
        if (!is_array($list) || !array_is_list($list)
            || $list === [] || count($list) > 64) {
            throw new \DomainException('matrix.byo_versions_unsupported');
        }

        $bestMinor = -1;
        foreach ($list as $version) {
            if (!is_string($version) || strlen($version) > 12) {
                throw new \DomainException('matrix.byo_versions_unsupported');
            }
            if (preg_match('/\Av1\.(\d+)\z/', $version, $matches) === 1) {
                $bestMinor = max($bestMinor, (int) $matches[1]);
            }
        }
        if ($bestMinor < 1) {
            throw new \DomainException('matrix.byo_versions_unsupported');
        }

        $room = $capabilities['capabilities']['m.room_versions'] ?? null;
        if (!is_array($room)
            || !isset($room['default'], $room['available'])
            || !is_string($room['default'])
            || strlen($room['default']) === 0 || strlen($room['default']) > 64
            || !is_array($room['available']) || count($room['available']) > 64
            || ($room['available'][$room['default']] ?? null) !== 'stable') {
            throw new \DomainException('matrix.byo_capabilities_unsupported');
        }

        return [
            'apiVersion' => 'v1.' . $bestMinor,
            'defaultRoomVersion' => $room['default'],
            'matrixUserId' => $expectedUserId,
            'matrixDeviceId' => $expectedDeviceId,
        ];
    }
}
