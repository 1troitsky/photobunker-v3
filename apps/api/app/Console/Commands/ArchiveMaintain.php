<?php
declare(strict_types=1);

namespace App\Console\Commands;

use App\Browser\ArchiveLifecycle;
use Illuminate\Console\Command;

/**
 * Explicit, bounded, operator-gated archive expiry marking. This command
 * NEVER calls S3 delete. Existing separately gated P1 photo/media workers
 * perform actual per-location deletion with durable tombstones and retries.
 */
final class ArchiveMaintain extends Command
{
    protected $signature='pb3:browser-archive-maintain';
    protected $description='Gated 7-day Browser archive expiry marking (not physical GC)';

    public function handle(ArchiveLifecycle $lifecycle):int
    {
        if(!config('browser_archive.auto_cleanup_enabled',false)){
            $this->error('Browser archive expiry disabled: PB3_ENABLE_ARCHIVE_AUTO_CLEANUP=true required');
            return self::FAILURE;
        }
        if(!config('browser_archive.write_enabled',false)){
            $this->error('Browser archive mutation disabled: PB3_ENABLE_BROWSER_ARCHIVE=true required');
            return self::FAILURE;
        }
        $batch=min(500,max(1,(int)config('browser_archive.sweep_batch',50)));
        $result=$lifecycle->sweepDue($batch);
        $this->line(sprintf(
            'Archive expiry: tombstones marked=%d, deferred=%d, errors=%d; physical GC is independently gated and NOT confirmed',
            $result['marked'],$result['deferred'],$result['errors'],
        ));
        return $result['errors']===0?self::SUCCESS:self::FAILURE;
    }
}
