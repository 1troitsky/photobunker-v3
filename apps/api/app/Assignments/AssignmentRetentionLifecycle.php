<?php
declare(strict_types=1);

namespace App\Assignments;

use App\Photo\PhotoSync;
use Illuminate\Support\Facades\DB;

/**
 * Durable, idempotent LOGICAL cutoff reconciliation only.
 *
 * IMPORTANT: a file contributed to an assignment belongs to the contributor.
 * Neither the owner-signed assignment schedule nor retention policy authorizes
 * destroying the contributor's photo/media S3 objects. This reconciler MUST
 * NOT delete media, grants, storage locations or original assignment history.
 */
final class AssignmentRetentionLifecycle
{
    public function dueIds(int $batch):array
    {
        $now=PhotoSync::nowMs();
        // Select each due *unrecorded* cutoff independently. A completed
        // file-only tombstone must not monopolize batches forever when the
        // assignment itself has no deadline (and vice versa).
        return DB::table('assignment_records_v1')->where(function($q)use($now){
            $q->where(function($files)use($now){
                $files->whereNotNull('files_access_until')
                    ->where('files_access_until','<=',$now)
                    ->whereNotIn('id',DB::table('assignment_retention_tombstones_v1')
                        ->whereNotNull('files_marked_at')
                        ->select('assignment_id'));
            })->orWhere(function($assignment)use($now){
                $assignment->whereNotNull('assignment_access_until')
                    ->where('assignment_access_until','<=',$now)
                    ->whereNotIn('id',DB::table('assignment_retention_tombstones_v1')
                        ->whereNotNull('assignment_marked_at')
                        ->select('assignment_id'));
            });
        })->orderBy('id')->limit(max(1,min(500,$batch)))->pluck('id')->all();
    }

    public function mark(string $assignmentId):array
    {
        return DB::transaction(function()use($assignmentId){
            $a=DB::table('assignment_records_v1')->where('id',$assignmentId)
                ->lockForUpdate()->first();
            if(!$a)return ['files'=>false,'assignment'=>false];
            $now=PhotoSync::nowMs();
            $files=$a->files_access_until!==null
                &&(int)$a->files_access_until<=$now;
            $assignment=$a->assignment_access_until!==null
                &&(int)$a->assignment_access_until<=$now;
            if(!$files&&!$assignment)return ['files'=>false,'assignment'=>false];
            DB::table('assignment_retention_tombstones_v1')->insertOrIgnore([
                'assignment_id'=>$a->id,
                'owner_account_id'=>$a->owner_account_id,
                'root_policy_hash'=>hash('sha256',$a->contract_json),
                'files_access_until'=>$a->files_access_until,
                'assignment_access_until'=>$a->assignment_access_until,
                'files_marked_at'=>$files?now():null,
                'assignment_marked_at'=>$assignment?now():null,
                'physical_status'=>'not_authorized',
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            $t=DB::table('assignment_retention_tombstones_v1')
                ->where('assignment_id',$assignmentId)->lockForUpdate()->first();
            $updates=[];
            if($files&&$t->files_marked_at===null)
                $updates['files_marked_at']=now();
            if($assignment&&$t->assignment_marked_at===null)
                $updates['assignment_marked_at']=now();
            if($updates!==[]){
                $updates['updated_at']=now();
                DB::table('assignment_retention_tombstones_v1')
                    ->where('assignment_id',$assignmentId)->update($updates);
            }
            return [
                'files'=>$files,
                'assignment'=>$assignment,
            ];
        },3);
    }
}
