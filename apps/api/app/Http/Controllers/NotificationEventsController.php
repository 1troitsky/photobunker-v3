<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Events\EventEnvelope;
use App\Events\NotificationProjection;
use App\Photo\PhotoSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Authenticated account-scoped metadata polling, not a server ACK.
 * The browser must persist encrypted local rows BEFORE advancing its cursor.
 * No user-controlled account, event producer, target or arbitrary offset.
 */
final class NotificationEventsController extends Controller
{
    public function __construct(private readonly PhotoSync $identity) {}

    public function index(Request $request): JsonResponse
    {
        [$actor] = $this->identity->actor($request);
        $query = $request->query();
        abort_unless(array_keys($query) === [] || array_keys($query) === ['after'], 422);
        $raw = $query['after'] ?? '0';
        abort_unless(is_string($raw)
            && preg_match('/\A(?:0|[1-9][0-9]{0,14})\z/D', $raw) === 1
            && (float) $raw <= 9007199254740991, 422);
        $after = (int) $raw;
        $accountId = (string) $actor->id;

        // A delivery sequence is assigned inside the commit transaction only
        // after all stream gaps close. Therefore late arrivals cannot appear
        // behind an already acknowledged (client-side) cursor.
        $rows = DB::table('notification_event_ledger_v1')
            ->where('account_id', $accountId)
            ->where('admission_state', 'sequenced')
            ->where('delivery_sequence', '>', $after)
            ->orderBy('delivery_sequence')
            ->limit(51)->get();
        $items = [];
        $next = $after;
        foreach ($rows->take(50) as $row) {
            $next = (int) $row->delivery_sequence;
            $event = EventEnvelope::fromArray(json_decode(
                $row->envelope_json, true, 512, JSON_THROW_ON_ERROR,
            ));
            // Trusted server-stored ledger still does not confer media ACL.
            $candidate = NotificationProjection::project(
                $event, $accountId,
                static function (string $account, string $type, string $subject): bool {
                    if ($type !== 'media') {
                        return false;
                    }
                    return DB::table('media_files_v1')
                        ->where('account_id', $account)
                        ->where('id', $subject)
                        ->where('state', 'active')
                        ->where('expires_at', '>', PhotoSync::nowMs())
                        ->exists();
                },
            );
            if ($candidate !== null) {
                $items[] = $candidate;
            }
        }
        return $this->identity->json([
            'schemaVersion' => 1,
            'items' => $items,
            'nextCursor' => (string) $next,
            'hasMore' => $rows->count() > 50,
            // No delivery/processing/read ACK is claimed by this response.
        ])->header('Cache-Control', 'no-store');
    }
}
