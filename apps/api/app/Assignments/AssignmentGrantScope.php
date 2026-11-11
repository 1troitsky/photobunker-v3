<?php
declare(strict_types=1);

namespace App\Assignments;

use App\Photo\PhotoSync;
use Illuminate\Support\Facades\DB;

/**
 * A new v2 recipient E2EE grant can be explicitly and immutably bound to
 * one assignment. It is signed by the MEDIA UPLOADER, not by the Fieldwork
 * owner. The latter can close assignment access but never delete the
 * contributor's originals or revoke unrelated personal v1 shares.
 */
final class AssignmentGrantScope
{
    public static function creation(
        string $assignmentId,string $contributorId,
        string $recipientId,int $grantExpiresAt
    ):void {
        $assignment=DB::table('assignment_records_v1')
            ->where('id',$assignmentId)->lockForUpdate()->first();
        abort_unless($assignment,404);
        abort_unless($assignment->owner_account_id===$recipientId,403);
        abort_unless($assignment->state==='active'
            &&AssignmentRetention::filesOpen($assignment)
            &&AssignmentSchedule::permitsNow($assignment),409);
        $member=DB::table('assignment_invites_v1')
            ->where('assignment_id',$assignmentId)
            ->where('recipient_account_id',$contributorId)
            ->where('role','contributor')
            ->where('state','accepted')
            ->whereNotExists(static function($rev){
                $rev->selectRaw('1')->from('assignment_member_removals_v1 as removed')
                    ->whereColumn('removed.invite_id','assignment_invites_v1.id');
            })->exists();
        abort_unless($member,403);
        foreach([
            $assignment->files_access_until,
            $assignment->assignment_access_until,
        ] as $cutoff){
            abort_unless($cutoff===null
                ||$grantExpiresAt<=(int)$cutoff,422);
        }
    }

    /** An immutable owner-signed removal outranks stale mutable invite state. */
    public static function requireAccepted(
        string $assignmentId,string $ownerAccountId,string $contributorId
    ):void {
        abort_unless(DB::table('assignment_invites_v1 as i')
            ->where('i.assignment_id',$assignmentId)
            ->where('i.owner_account_id',$ownerAccountId)
            ->where('i.recipient_account_id',$contributorId)
            ->where('i.role','contributor')
            ->where('i.state','accepted')
            ->whereNotExists(static function($rev){
                $rev->selectRaw('1')->from('assignment_member_removals_v1 as rm')
                    ->whereColumn('rm.invite_id','i.id');
            })->exists(),410);
    }

    public static function requireReadable(?string $assignmentId):void
    {
        if($assignmentId===null)return; // independent signed v1 grant
        $assignment=DB::table('assignment_records_v1')
            ->where('id',$assignmentId)->first();
        // No fallback to an independent grant if the bound association has
        // disappeared, even if its original E2EE envelope is still readable.
        abort_unless($assignment,410);
        abort_unless(AssignmentRetention::filesOpen(
            $assignment,PhotoSync::nowMs()),410);
    }
}
