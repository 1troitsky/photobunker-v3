<?php
declare(strict_types=1);

namespace App\Events;

/**
 * A production implementation MUST admit events atomically in persistent
 * storage. Within one database transaction it must:
 *
 * 1. enforce a UNIQUE account-scoped eventId with its canonical fingerprint;
 *    exact replay => Duplicate; changed replay => Conflict.
 * 2. fence UNIQUE (accountId, subjectType, subjectId, revision); two different
 *    events at one revision => Conflict.
 * 3. accept the next stream revision, defer gaps (no silent dropping), and
 *    retain a bounded durable retry/quarantine policy for deferred revisions.
 * 4. NOT advance a consumer checkpoint when downstream side effects fail.
 *
 * An in-memory ledger is insufficient in production: this issue intentionally
 * does NOT ship routes, a DB ledger or asynchronous processing infrastructure.
 */
interface EventInboxLedger
{
    public function admit(EventEnvelope $envelope): EventAdmission;
}
