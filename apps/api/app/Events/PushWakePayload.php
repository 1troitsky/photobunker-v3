<?php
declare(strict_types=1);

namespace App\Events;

/**
 * The ONLY permitted future Web Push body: an opaque "wake and fetch" hint.
 *
 * It carries no event metadata and grants no resource access. A recipient
 * must establish the normal authenticated same-origin device session and
 * fetch its durable inbox; opening a push must never navigate by payload.
 *
 * This is a payload CONTRACT, not a transport, subscription registration,
 * service worker or claim of successful push delivery.
 */
final class PushWakePayload
{
    private const BODY = '{"v":1,"action":"check-inbox"}';

    private function __construct() {}

    /**
     * Deliberately has no event, account, target or producer input. All
     * events, including security events, produce identical encrypted-transport
     * metadata; no recipient/account identity belongs in this body.
     */
    public static function body(): string
    {
        return self::BODY;
    }

    /** @return array{v:int,action:string} */
    public static function decode(string $body): array
    {
        if (!hash_equals(self::BODY, $body)) {
            throw new \InvalidArgumentException('notifications.push.invalid_payload');
        }
        return ['v' => 1, 'action' => 'check-inbox'];
    }
}
