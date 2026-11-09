<?php
declare(strict_types=1);

namespace App\Assignments;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * P1 Free bootstrap only: all enrolled accounts are on the Free entitlement
 * until verified billing/subscription lifecycle is implemented.
 *
 * The server's UTC created_at (not a client-signed startsAt) is the authority
 * for calendar-month billing. Creation callers MUST lock identity_accounts
 * before checking this usage and inserting a new assignment in one transaction.
 */
final class MonthlyCreationQuota
{
    /** @return array{planId:string,catalogVersion:string,periodStart:string,
     * periodEnd:string,limit:int,used:int,remaining:int} */
    public function usage(string $accountId): array
    {
        $limit=config('plans.plans.free.assignment_creations_per_month');
        if (!is_int($limit) || $limit<0) {
            throw new \RuntimeException('assignments.free_quota_unconfigured');
        }
        $version=config('plans.catalog_version');
        if (!is_string($version) || $version==='') {
            throw new \RuntimeException('assignments.plan_catalog_unconfigured');
        }
        $start=Carbon::now('UTC')->startOfMonth();
        $end=$start->copy()->addMonth();
        $used=DB::table('assignment_records_v1')
            ->where('owner_account_id',$accountId)
            ->where('created_at','>=',$start)
            ->where('created_at','<',$end)
            ->count();

        return [
            'planId'=>'free',
            'catalogVersion'=>$version,
            'periodStart'=>$start->toIso8601String(),
            'periodEnd'=>$end->toIso8601String(),
            'limit'=>$limit,
            'used'=>$used,
            'remaining'=>max(0,$limit-$used),
        ];
    }
}
