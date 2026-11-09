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
    protected $signature = 'pb3:photo-maintain';
    protected $description = 'Gated, bounded photo TTL cleanup and stalled-upload reconciliation';

    public function handle(Lifecycle $lifecycle): int
    {
        if (!config('photo_sync.cleanup_enabled', false)) {
            $this->error('Photo maintenance disabled: requires explicit PB3_ENABLE_PHOTO_CLEANUP=true');
            return self::FAILURE;
        }

        $batch = min(500, max(1, (int) config('photo_sync.cleanup_batch', 100)));
        $ids = DB::table('photo_records')->where(function ($query): void {
            $query->where('expires_at', '<=', PhotoSync::nowMs())
                ->orWhere('state', 'deleting');
        })->where(function ($query): void {
            $query->whereNull('cleanup_next_at')->orWhere('cleanup_next_at', '<=', now());
        })->orderBy('expires_at')->orderBy('id')->limit($batch)->pluck('id');

        foreach ($ids as $id) {
            $lifecycle->mark($id);
            PhotoCleanupJob::dispatch($id);
        }

        $reconciled = $lifecycle->reconcileStalledUploads($batch);
        $swept = $lifecycle->sweepTombstones($batch);
        $this->line(sprintf(
            'Queued %d expired/deleting; upload reconciliation verified=%d reset=%d deferred=%d errors=%d; tombstone sweeps=%d',
            $ids->count(), $reconciled['verified'], $reconciled['reset'], $reconciled['deferred'],
            $reconciled['errors'], $swept
        ));
        return self::SUCCESS;
    }
}
