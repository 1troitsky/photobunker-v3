<?php
declare(strict_types=1);

namespace App\Events;

use InvalidArgumentException;

/**
 * Strict transport-independent admission facade.
 *
 * The trusted account ID MUST come from verified server-side identity/scope,
 * not from event JSON or an unverified client header. An accepted event is
 * metadata only; it is NOT proof of ACL, producer authenticity or delivery.
 */
final readonly class EventConsumer
{
    public function __construct(private EventInboxLedger $ledger) {}

    /**
     * Invalid and cross-tenant inputs fail closed without writing or logging
     * their potentially sensitive raw values. Callers may increment an
     * aggregate rejection counter, but must not persist the rejected payload.
     */
    public function ingest(mixed $input, string $trustedAccountId): EventAdmission
    {
        if (!is_array($input)
            || !EventEnvelope::isCanonicalUuid($trustedAccountId)) {
            return EventAdmission::Quarantined;
        }

        try {
            $envelope = EventEnvelope::fromArray($input);
        } catch (InvalidArgumentException) {
            return EventAdmission::Quarantined;
        }

        if (!hash_equals($trustedAccountId, $envelope->accountId)) {
            return EventAdmission::Quarantined;
        }

        return $this->ledger->admit($envelope);
    }
}
