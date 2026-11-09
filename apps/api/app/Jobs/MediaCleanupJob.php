<?php
declare(strict_types=1);

namespace App\Jobs;

use App\Media\MediaLifecycle;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;

final class MediaCleanupJob implements ShouldQueue
{
    use Dispatchable,InteractsWithQueue,Queueable,SerializesModels;

    public int $tries=10;
    public int $timeout=360;
    public function backoff():array{
        return [30,60,120,300,900,1800,3600,7200,14400];
    }
    public function __construct(public readonly string $mediaId)
    {
        $this->onQueue('media-cleanup');
    }
    public function handle(MediaLifecycle $lifecycle):void
    {
        // A queued job must not bypass a later operator disable.
        if(!config('media_sync.cleanup_enabled',false))
            throw new \RuntimeException('media.cleanup_disabled');
        try{$lifecycle->cleanup($this->mediaId);}
        catch(\Throwable $e){
            DB::table('media_files_v1')->where('id',$this->mediaId)
                ->update(['cleanup_next_at'=>now()->addMinutes(5)]);
            throw $e;
        }
    }
}
