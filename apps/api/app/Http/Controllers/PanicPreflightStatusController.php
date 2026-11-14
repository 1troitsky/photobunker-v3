<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Panic\PreparedIntentStatusReader;
use App\Photo\PhotoSync;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P3 #221: owner-device authenticated, READ-ONLY preflight status.
 *
 * No mutation method exists. This cannot execute Panic, revoke sessions,
 * delete live/backup data, sign an ACK or claim S3/Matrix deletion.
 *
 * The standalone route file is intentionally NOT mounted in production
 * while routes/web.php (#198) and bootstrap/app.php (#231) have other CLAIMs.
 */
final class PanicPreflightStatusController extends Controller
{
    public function __construct(
        private readonly PhotoSync $identity,
        private readonly PreparedIntentStatusReader $status,
    ) {}

    public function show(Request $request, string $operationId): JsonResponse
    {
        // Laravel web session actor: 24h lease, registered device, not revoked.
        [$account, $device] = $this->identity->actor($request);

        // Strictly one opaque ID. Never accept a client-selected account,
        // device, phase, storage location, or plaintext credentials.
        abort_unless($request->query() === [], 422);

        $row = DB::table('panic_preflight_intents_v1')
            ->where('operation_id', $operationId)
            ->where('account_id', $account->id)
            ->where('device_id', $device->id)
            ->first(['contract_json', 'signature']);

        // A foreign account, missing row or malformed source are identical
        // from the caller's perspective. Never leak a signing envelope.
        abort_unless($row !== null
            && is_string($row->contract_json)
            && is_string($row->signature), 404);

        try {
            $data = $this->status->read(
                ['contract' => $row->contract_json, 'signature' => $row->signature],
                (string) $account->id,
                (string) $device->id,
            );
        } catch (DomainException) {
            // Stale/revoked/tampered prepared commands must never surface
            // as server accepted, acknowledged or completed.
            abort(404);
        }

        return $this->identity->json($data)
            ->header('Cache-Control', 'private, no-store')
            ->header('Vary', 'Cookie')
            ->header('X-Robots-Tag', 'noindex, nofollow');
    }
}
