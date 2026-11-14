<?php
declare(strict_types=1);

namespace App\Administration\Restrictions;

use DomainException;
use Illuminate\Support\Facades\DB;

/**
 * INTERNAL, DB-ONLY admission precondition for an ALREADY authenticated
 * customer identity/session. This class does NOT authenticate the caller,
 * mint a token, inspect keys, mount a route or enforce remote S3 requests.
 *
 * Call only INSIDE the SAME open default Laravel DB transaction as the
 * protected SQL work. In PostgreSQL18 READ COMMITTED, the existing policy
 * check's SELECT .. FOR SHARE identity row locks are retained until that
 * OUTER transaction finishes. This prevents administrative account/device
 * restriction from being committed between admission and protected SQL.
 *
 * A middleware-only check (autocommit) is NOT equivalent and is rejected.
 * Never hold this transaction across S3/network/other external side effects.
 * Integration belongs to Identity and Remote Wipe owners after real verified
 * session and device proofs are available.
 */
final readonly class TransactionBoundRestrictionAdmission
{
    public function __construct(
        private TemporaryRestrictionLedger $restrictions,
    ) {}

    /**
     * @throws DomainException Unauthenticated/banned/unknown/revoked session
     *                         or missing caller-owned SQL transaction.
     */
    public function assertForTrustedDatabaseTransaction(
        string $verifiedAccountId,
        string $verifiedDeviceId,
    ): void {
        if (DB::transactionLevel() < 1) {
            throw new DomainException('admin.restriction_transaction_required');
        }

        // This method begins a NESTED transaction/savepoint and obtains
        // shared locks; the OUTER caller transaction retains them.
        $this->restrictions->assertNotRestrictedForTrustedSession(
            $verifiedAccountId, $verifiedDeviceId,
        );

        // Do not issue a "permit" or a transferable lease. The caller must
        // perform its protected SQL on the SAME default DB transaction.
        if (DB::transactionLevel() < 1) {
            throw new DomainException('admin.restriction_transaction_required');
        }
    }
}
