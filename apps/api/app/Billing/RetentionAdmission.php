<?php
declare(strict_types=1);

namespace App\Billing;

use App\Photo\PhotoSync;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * #281: account-scoped, immutable signed deadline admission for NEW media.
 *
 * Must run inside the reserve transaction, after the identity account row
 * has been locked and after idempotent replay of a pre-existing reservation
 * has been handled. It never rewrites existing signed expiresAt or ciphertext.
 *
 * Retention v1 is explicitly bounded at 90 days for the signed wire format.
 * Unlimited's "while paid" renewal/grace policy is OPEN in #203; a temporary
 * 14-day technical bound remains until that contract has been approved.
 */
final class RetentionAdmission
{
    public const MAX_SIGNED_DAYS_V1=90;
    private const DAY_MS=86400000;

    public function __construct(private readonly EntitlementLedger $ledger){}

    /**
     * @return array{effectivePlanId:string,entitlementRevision:int,maxDays:int,source:string}
     */
    public function assertNew(string $accountId,int $expiresAt):array
    {
        // Every signed Photo and MediaFile reserve already uses this same
        // account row lock; reacquiring it here retains cross-protocol order.
        $account=DB::table('identity_accounts')->where('id',$accountId)
            ->lockForUpdate()->first();
        abort_unless($account&&$account->status==='ready',401);
        $e=$this->ledger->current($accountId);
        $plan=$e['effectivePlanId']??null;
        $limits=$e['effectiveLimits']??null;
        $retention=is_array($limits)?($limits['retention']??null):null;
        if(!is_array($retention)||!is_string($plan))
            throw new RuntimeException('retention.invalid_entitlement');

        $freeGuard=config('photo_sync.bootstrap_free_retention_days');
        if(!is_int($freeGuard)||$freeGuard<1
            ||$freeGuard>self::MAX_SIGNED_DAYS_V1)
            throw new RuntimeException('retention.invalid_free_guard');

        if(in_array($plan,['free','go','pro'],true)){
            $days=$retention['days']??null;
            if(!is_int($days)||$days<1
                ||$days>self::MAX_SIGNED_DAYS_V1
                ||array_key_exists('mode',$retention))
                throw new RuntimeException('retention.invalid_plan_cap');
            if($plan!=='free'&&($e['paidPrivilegesActive']??false)!==true)
                throw new RuntimeException('retention.invalid_paid_entitlement');
            $maxDays=$plan==='free'?min($days,$freeGuard):$days;
            $source=$plan==='free'?'free_plus_bootstrap_guard':'verified_plan_days';
        }elseif(in_array($plan,['unlimited','unlimited_plus'],true)){
            if(($retention['mode']??null)!=='while_plan_active_with_assignment_policy'
                ||array_key_exists('days',$retention)
                ||($e['paidPrivilegesActive']??false)!==true)
                throw new RuntimeException('retention.invalid_unlimited_policy');
            // Never turn "Unlimited" into an unbounded immutable signed TTL.
            // Payment renewal, signed revision, grace and GC policy are #203.
            $maxDays=$freeGuard;
            $source='unlimited_unresolved_technical_guard';
        }else{
            throw new RuntimeException('retention.invalid_plan');
        }

        $now=PhotoSync::nowMs();
        abort_unless($expiresAt>$now
            &&$expiresAt<=$now+$maxDays*self::DAY_MS,422,'retention.plan_cap');
        return [
            'effectivePlanId'=>$plan,
            'entitlementRevision'=>(int)$e['revision'],
            'maxDays'=>$maxDays,
            'source'=>$source,
        ];
    }
}
