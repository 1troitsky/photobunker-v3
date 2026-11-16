<?php
declare(strict_types=1);

namespace App\Events;

use Throwable;

/**
 * Server-owned metadata -> privacy-safe local notification candidate.
 *
 * This is NOT an event producer, notification delivery, inbox ACK, or an ACL
 * authority. Call only after verified producer authentication and durable
 * event admission. Client-supplied event JSON must never reach this boundary.
 */
final class NotificationProjection
{
    /**
     * Maps only event types with unambiguous, already-approved UI meanings.
     * No invitation/deadline is synthesized from a generic "changed" event.
     *
     * @param callable(string, string, string):bool $canReadSubject
     *        Must re-check CURRENT server ACL for account/type/id (fail closed).
     * @return array{id:string,kind:string,targetId:?string,occurredAt:int}|null
     */
    public static function project(
        EventEnvelope $event,
        string $trustedAccountId,
        callable $canReadSubject,
    ): ?array {
        if (!EventEnvelope::isCanonicalUuid($trustedAccountId)
            || !hash_equals($trustedAccountId, $event->accountId)) {
            return null;
        }

        // These types can be shown without dereferencing a private object.
        $nonNavigable = [
            'AccountCreated' => 'security',
            'DeviceRevoked' => 'security',
            'GrantRevoked' => 'security',
            'PanicIntentCreated' => 'security',
            'BackupVerified' => 'backup',
            // Retention deadline was reached; never expose a deleted media target.
            'MediaRetentionExpired' => 'file-expiry',
            'SubscriptionEntitlementChanged' => 'subscription',
        ];
        $kind = $nonNavigable[$event->eventType] ?? null;
        if ($kind !== null) {
            return self::candidate($event, $kind, null);
        }

        $navigable = [
            'AssignmentInvitationCreated' => 'assignment-invite',
            'TeamEpochInvitationCreated' => 'team-invite',
            'TeamInitialInvitationCreated' => 'team-invite',
            'MediaCommitted' => 'new-file',
            'MediaExpired' => 'file-expiry',
        ];
        $kind = $navigable[$event->eventType] ?? null;
        if ($kind === null) {
            return null;
        }

        try {
            if ($canReadSubject(
                $trustedAccountId,
                $event->subjectType,
                $event->subjectId,
            ) !== true) {
                return null;
            }
        } catch (Throwable) {
            // Never surface stale/revoked objects on authorization failures.
            return null;
        }

        return self::candidate($event, $kind, $event->subjectId);
    }

    /** @return array{id:string,kind:string,targetId:?string,occurredAt:int} */
    private static function candidate(
        EventEnvelope $event,
        string $kind,
        ?string $targetId,
    ): array {
        return [
            'id' => $event->eventId,
            'kind' => $kind,
            'targetId' => $targetId,
            'occurredAt' => $event->occurredAtMs,
        ];
    }
}
