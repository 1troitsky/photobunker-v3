<?php
declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\PhotoCleanupJob;
use App\Photo\Lifecycle;
use App\Photo\PhotoSync;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class PhotoMaintain extends Command
{
    protected $signature='pb3:photo-maintain';
    protected $description='Bounded expired-photo maintenance, orphans and tombstones';

    public function handle(Lifecycle $lifecycle): int
    {
        $batch=min(500,max(1,(int)config('photo_sync.cleanup_batch',100)));
        $ids=DB::table('photo_records')->where(function($query) {
            $query->where('expires_at','<=',PhotoSync::nowMs())
                  ->orWhere('state','deleting');
        })->where(function($query) {
            $query->whereNull('cleanup_next_at')->orWhere('cleanup_next_at','<=',now());
        })->orderBy('expires_at')->orderBy('id')->limit($batch)->pluck('id');
        foreach($ids as $id){
            $lifecycle->mark($id);
            PhotoCleanupJob::dispatch($id);
        }
        $lifecycle->recoverOrphans($batch);
        $lifecycle->sweepTombstones($batch);
        $this->line('P1 photo maintenance enqueued '.count($ids).' cleanup jobs.');
        return self::SUCCESS;
    }
}
