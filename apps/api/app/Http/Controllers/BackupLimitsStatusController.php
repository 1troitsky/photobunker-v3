<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\OperationalLimits\BackupRateStatus;
use App\Photo\PhotoSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Owner-device authenticated technical status only. No start/confirm/finish
 * route until the real backup worker persists and verifies encrypted data.
 */
final class BackupLimitsStatusController extends Controller
{
    public function __construct(
        private readonly PhotoSync $identity,
        private readonly BackupRateStatus $status,
    ) {}

    public function show(Request $request): JsonResponse
    {
        [$account] = $this->identity->actor($request);
        // accountId query/path is not an input: never read another account.
        return $this->identity->json($this->status->forAccount((string) $account->id));
    }
}
