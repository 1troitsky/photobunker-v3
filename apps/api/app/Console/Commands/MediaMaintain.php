<?php
declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\MediaCleanupJob;
use App\Media\MediaLifecycle;
use App\Photo\PhotoSync;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class MediaMaintain extends Command
{
    protected $signature='pb3:media-maintain';
    protected $description='Gated MediaFile/v1 TTL, stalled chunk and tombstone reconciliation';

    public function handle(MediaLifecycle $lifecycle):int
    {
        if(!config('media_sync.cleanup_enabled',false)){
            $this->error('Media cleanup disabled: PB3_ENABLE_MEDIA_CLEANUP=true required');
            return self::FAILURE;
        }
        $batch=min(500,max(1,(int)config('media_sync.cleanup_batch',100)));
        $ids=DB::table('media_files_v1')
            ->where(function($q){
                $q->where('expires_at','<=',PhotoSync::nowMs())
                    ->orWhere('state','deleting');
            })
            ->where(function($q){
                $q->whereNull('cleanup_next_at')
                    ->orWhere('cleanup_next_at','<=',now());
            })
            ->orderBy('expires_at')->orderBy('id')
            ->limit($batch)->pluck('id');
        foreach($ids as $id){
            $lifecycle->mark($id);
            MediaCleanupJob::dispatch($id);
        }
        $reconcile=$lifecycle->reconcileStalledChunks($batch);
        $sweep=$lifecycle->sweepTombstones($batch);
        // Non-destructive, retryable event outbox drain. It never gates
        // StorageManager cleanup, even on event DB/transport outage.
        $notice=$lifecycle->publishExpiredNotices($batch);
        $this->line(sprintf(
            'Media TTL queued=%d, chunk reconciliation verified=%d reset=%d deferred=%d errors=%d, tombstones=%d, retention notices published=%d errors=%d',
            $ids->count(),$reconcile['verified'],$reconcile['reset'],
            $reconcile['deferred'],$reconcile['errors'],$sweep,
            $notice['published'],$notice['errors']));
        return self::SUCCESS;
    }
}
