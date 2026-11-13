<?php
declare(strict_types=1);

namespace App\Browser;

use App\Media\MediaLifecycle;
use App\Photo\Lifecycle as PhotoLifecycle;
use App\Photo\PhotoSync;
use Illuminate\Support\Facades\DB;

/**
 * Bounded, operator-gated archive expiry. Each row is server-authoritatively
 * due and was originally authorized by a signed owner archive command.
 * This stage marks tombstones only; separate P1 queue workers verify S3
 * deletion on EVERY registered location before removing any pointer.
 */
final class ArchiveLifecycle
{
    public function __construct(
        private readonly PhotoLifecycle $photos,
        private readonly MediaLifecycle $media,
    ) {}

    public function sweepDue(int $batch):array
    {
        if(!config('browser_archive.auto_cleanup_enabled',false))
            throw new \RuntimeException('browser.archive_cleanup_disabled');
        $now=PhotoSync::nowMs();
        $rows=DB::table('browser_archive_entries_v1')
            ->where('state','archived')
            ->whereNotNull('archive_until_ms')
            ->where('archive_until_ms','<=',$now)
            ->orderBy('archive_until_ms')->orderBy('id')
            ->limit(min(500,max(1,$batch)))->get();
        $out=['marked'=>0,'deferred'=>0,'errors'=>0];
        foreach($rows as $entry){
            try{
                $marked=DB::transaction(function()use($entry):bool{
                    // Same lock order as signed mutator and grant creators.
                    $owner=DB::table('identity_accounts')
                        ->where('id',$entry->account_id)->lockForUpdate()->first();
                    if(!$owner)return false;
                    // Archive preference controls only optional 7-day sweep;
                    // original asset TTL remains an independent P1 policy.
                    $preferences=\App\Http\Controllers\BrowserArchivePreferencesController::settings(
                        $entry->account_id);
                    if(!$preferences['autoDeleteAfter7Days'])return false;
                    $row=DB::table('browser_archive_entries_v1')
                        ->where('id',$entry->id)->lockForUpdate()->first();
                    if(!$row||$row->state!=='archived'
                        ||$row->archive_until_ms===null
                        ||(int)$row->archive_until_ms>PhotoSync::nowMs())
                        return false;
                    $isPhoto=$row->kind==='photo';
                    if(!$isPhoto&&$row->kind!=='media')
                        throw new \RuntimeException('browser.archive_invalid_kind');
                    $table=$isPhoto?'photo_records':'media_files_v1';
                    $asset=DB::table($table)->where('id',$row->asset_id)
                        ->where('account_id',$row->account_id)
                        ->lockForUpdate()->first();
                    if($isPhoto){
                        if(DB::table('assignment_submissions_v1')
                            ->where('photo_id',$row->asset_id)->exists()
                          ||DB::table('photo_access_grants')
                            ->where('photo_id',$row->asset_id)->exists())
                            return false;
                    }else{
                        if(DB::table('assignment_media_submissions_v1')
                            ->where('media_id',$row->asset_id)->exists()
                          ||DB::table('media_recipient_grants_v1')
                            ->where('media_id',$row->asset_id)->exists())
                            return false;
                    }
                    if($asset){
                        if($isPhoto)$this->photos->mark($asset->id,'archived_delete');
                        else $this->media->mark($asset->id);
                    }else{
                        // Only an already present immutable tombstone may
                        // justify transitioning an absent source to deleting.
                        $tomb=$isPhoto?'photo_tombstones':'media_tombstones_v1';
                        $pk=$isPhoto?'photo_id':'media_id';
                        if(!DB::table($tomb)->where($pk,$row->asset_id)
                            ->where('account_id',$row->account_id)->exists())
                            return false;
                    }
                    DB::table('browser_archive_entries_v1')
                        ->where('id',$row->id)->update([
                            'state'=>'deleting','archive_until_ms'=>PhotoSync::nowMs(),
                            'updated_at'=>now(),
                        ]);
                    return true;
                },3);
                $out[$marked?'marked':'deferred']++;
            }catch(\Throwable){
                // A lock/S3/SQL failure must never be reported as verified GC.
                $out['errors']++;
            }
        }
        return $out;
    }
}
