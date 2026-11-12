<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Billing\AccountUsage;
use App\Billing\EntitlementLedger;
use App\Photo\PhotoSync;
use App\Plans\PlanCatalog;
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
        return $this->identity->json([
            'schemaVersion'=>1,
            'entitlement'=>$this->entitlements->current((string)$account->id),
            'usage'=>$this->usage->measure((string)$account->id),
        ]);
    }
}
