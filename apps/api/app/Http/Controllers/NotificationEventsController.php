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

    /**
     * Read-only target resolution immediately before click/navigation.
     * A locally cached targetId is never a grant. All unknown/foreign/expired
     * events return identical 404 without disclosing object existence.
     * This response is NOT a file-read capability or a public URL.
     */
    /**
     * The event is a signal, not permission: re-check CURRENT recipient
     * invitation, removal proof, assignment state and all access deadlines.
     */
    private static function currentTargetAllowed(string $account, string $type, string $subject): bool
    {
        if ($type === 'media') {
            return DB::table('media_files_v1')
                ->where('account_id', $account)->where('id', $subject)
                ->where('state', 'active')
                ->where('expires_at', '>', PhotoSync::nowMs())->exists();
        }
        if ($type !== 'assignment_invite') {
            return false;
        }
        $now = PhotoSync::nowMs();
        return DB::table('assignment_invites_v1 as i')
            ->join('assignment_records_v1 as a', 'a.id', '=', 'i.assignment_id')
            ->where('i.id', $subject)
            ->where('i.recipient_account_id', $account)
            ->where('i.state', 'pending')
            ->where('i.expires_at', '>', $now)
            ->where('a.state', 'active')
            ->where(function ($q) use ($now):void {
                $q->whereNull('a.assignment_access_until')
                    ->orWhere('a.assignment_access_until', '>', $now);
            })
            ->where(function ($q) use ($now):void {
                $q->whereNull('a.files_access_until')
                    ->orWhere('a.files_access_until', '>', $now);
            })
            ->whereNotExists(static function ($q):void {
                $q->selectRaw('1')
                    ->from('assignment_member_removals_v1 as rm')
                    ->whereColumn('rm.invite_id', 'i.id');
            })->exists();
    }

    public function target(Request $request, string $eventId): JsonResponse
    {
        [$actor] = $this->identity->actor($request);
        abort_unless($request->query() === [], 422);
        abort_unless(EventEnvelope::isCanonicalUuid($eventId), 404);
        $accountId = (string) $actor->id;
        $row = DB::table('notification_event_ledger_v1')
            ->where('account_id', $accountId)
            ->where('event_id', $eventId)
            ->where('admission_state', 'sequenced')
            ->whereNotNull('delivery_sequence')
            ->first(['envelope_json']);
        abort_unless($row !== null, 404);

        $event = EventEnvelope::fromArray(json_decode(
            $row->envelope_json, true, 512, JSON_THROW_ON_ERROR,
        ));
        // Both media and pending assignment invites require FRESH server ACL.
        // A revoked/expired invite is never a navigation capability.
        abort_unless(in_array($event->eventType,[
            'MediaCommitted','AssignmentInvitationCreated',
        ],true),404);
        $candidate = NotificationProjection::project(
            $event, $accountId,
            static fn(string $account,string $type,string $subject):bool =>
                self::currentTargetAllowed($account,$type,$subject),
        );
        abort_unless($candidate !== null && $candidate['targetId'] !== null, 404);
        return $this->identity->json([
            'schemaVersion' => 1,
            'kind' => $candidate['kind'],
            'targetId' => $candidate['targetId'],
            // Client MUST independently use media manifest/read auth; no grant.
        ])->header('Cache-Control', 'no-store');
    }

    /**
     * Server-side receipt of the client's scanned cursor, scoped to the
     * authenticated device. Not "read", not proof of client persistence,
     * not a license to delete or withhold anything on future replays.
     */
    public function acknowledge(Request $request): JsonResponse
    {
        $this->identity->origin($request);
        [$actor, $device] = $this->identity->actor($request);
        $body = $request->json()->all();
        abort_unless(is_array($body) && array_keys($body) === ['cursor'], 422);
        $raw = $body['cursor'];
        abort_unless(is_string($raw)
            && preg_match('/\A(?:0|[1-9][0-9]{0,14})\z/D', $raw) === 1
            && (float) $raw <= 9007199254740991, 422);
        $cursor = (int) $raw;
        $accountId = (string) $actor->id;
        $deviceId = (string) $device->id;

        $result = DB::transaction(static function () use ($accountId, $deviceId, $cursor):array {
            // Event publisher and device revoke use account-first locking.
            $account = DB::table('identity_accounts')
                ->where('id', $accountId)->lockForUpdate()->first(['status']);
            abort_unless($account && $account->status === 'ready', 401);
            $currentDevice = DB::table('identity_devices')
                ->where('id', $deviceId)->where('account_id', $accountId)
                ->lockForUpdate()->first(['revoked_at']);
            abort_unless($currentDevice && $currentDevice->revoked_at === null, 401);
            $published = DB::table('notification_account_delivery_v1')
                ->where('account_id', $accountId)->value('last_sequence');
            $max = (int) ($published ?? 0);
            abort_if($cursor > $max, 409, 'notifications.ack_future_cursor');

            $query = DB::table('notification_device_ack_v1')
                ->where('account_id', $accountId)->where('device_id', $deviceId);
            $existing = $query->first();
            $previous = (int) ($existing->ack_cursor ?? 0);
            $next = max($previous, $cursor);
            if ($existing === null) {
                DB::table('notification_device_ack_v1')->insert([
                    'account_id' => $accountId, 'device_id' => $deviceId,
                    'ack_cursor' => $next, 'updated_at' => now(),
                ]);
            } elseif ($next > $previous) {
                $query->update(['ack_cursor' => $next, 'updated_at' => now()]);
            }
            return ['schemaVersion' => 1, 'acknowledgedCursor' => (string) $next,
                'advanced' => $next > $previous];
        }, 3);

        return $this->identity->json($result);
    }

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
                static fn(string $account,string $type,string $subject):bool =>
                    self::currentTargetAllowed($account,$type,$subject),
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
