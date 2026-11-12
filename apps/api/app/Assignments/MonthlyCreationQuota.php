<?php
declare(strict_types=1);

namespace App\Assignments;

use App\Billing\EntitlementLedger;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * One authoritative UTC calendar-month creation allowance per account.
 *
 * The caller MUST lock identity_accounts before calling usage() and inserting
 * the signed assignment + immutable creation meter in the same transaction.
 * Do not trust a client plan, startsAt, or deletion status. Removed records
 * still consume the month in the append-only meter.
 */
final class MonthlyCreationQuota
{
    public function __construct(private readonly EntitlementLedger $entitlements){}

    /**
     * @return array{planId:string,catalogVersion:string,periodStart:string,
     * periodEnd:string,limit:?int,used:int,remaining:?int}
     */
    public function usage(string $accountId,?CarbonImmutable $asOf=null):array
    {
        // For a create transaction use the exact SAME server UTC instant for
        // admission and persisted created_at, including month-boundary races.
        $now=($asOf??CarbonImmutable::now('UTC'))->utc();
        $ent=$this->entitlements->current($accountId,$now);
        $limit=$ent['effectiveLimits']['assignmentCreationsPerMonth']??null;
        if(!array_key_exists('assignmentCreationsPerMonth',$ent['effectiveLimits'])
            ||($limit!==null&&(!is_int($limit)||$limit<0))) {
            throw new \RuntimeException('assignments.entitlement_quota_invalid');
        }
        $start=$now->startOfMonth();
        $end=$start->addMonth();
        $used=DB::table('assignment_creation_meter_v1')
            ->where('owner_account_id',$accountId)
            ->where('created_at','>=',$start)
            ->where('created_at','<',$end)
            ->count();

        return [
            'planId'=>(string)$ent['effectivePlanId'],
            'catalogVersion'=>(string)$ent['catalogVersion'],
            'periodStart'=>$start->toIso8601String(),
            'periodEnd'=>$end->toIso8601String(),
            'limit'=>$limit,
            'used'=>$used,
            'remaining'=>$limit===null?null:max(0,$limit-$used),
        ];
    }
}
