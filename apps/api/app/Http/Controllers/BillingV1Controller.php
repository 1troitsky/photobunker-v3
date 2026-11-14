<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Billing\AccountUsage;
use App\Billing\EntitlementLedger;
use App\Billing\GraceLifecycle;
use App\Billing\QuotaAdmission;
use App\Photo\PhotoSync;
use App\Plans\PlanCatalog;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public PRICE definitions; authenticated own-account entitlement only.
 * Intentionally no POST, payment activation, admin role or account ID input.
 */
final class BillingV1Controller extends Controller
{
    public function __construct(
        private readonly PlanCatalog $plans,
        private readonly EntitlementLedger $entitlements,
        private readonly GraceLifecycle $lifecycle,
        private readonly AccountUsage $usage,
        private readonly PhotoSync $identity,
    ) {}

    public function plans():JsonResponse
    {
        return $this->identity->json($this->plans->publicCatalog());
    }

    public function me(Request $request):JsonResponse
    {
        [$account]=$this->identity->actor($request);
        $id=(string)$account->id;
        // The entitlement and its deadline projection share one server UTC
        // instant: never disagree across an expiry/grace clock boundary.
        $now=CarbonImmutable::now('UTC');
        $entitlement=$this->entitlements->current($id,$now);
        $lifecycle=$this->lifecycle->describe($entitlement,$now);
        $usage=$this->usage->measure($id);
        // Measurement remains read-only; expose the *same* quota policy that
        // both server-side signed reserve paths actually enforce.
        $policy=QuotaAdmission::storagePolicy($entitlement);
        $usage['enforcedByteCeiling']=$policy['enforcedByteCeiling'];
        $usage['byteUnitPolicy']=$policy['unitPolicy'];
        $usage['quotaSource']=$policy['source'];
        return $this->identity->json([
            'schemaVersion'=>1,
            'entitlement'=>$entitlement,
            'lifecycle'=>$lifecycle,
            'usage'=>$usage,
        ]);
    }
}
