<?php
declare(strict_types=1);

namespace App\Jobs;

use App\Photo\Lifecycle;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;

final class PhotoCleanupJob implements ShouldQueue
{
    use Dispatchable,InteractsWithQueue,Queueable,SerializesModels;

    public int $tries=10;
    public int $timeout=120;
    public function backoff():array {return [30,60,120,300,900,1800,3600,7200,14400];}
    public function __construct(public readonly string $photoId)
    {
        $this->onQueue('photo-cleanup');
    }
    public function handle(Lifecycle $lifecycle):void
    {
        try {
            $lifecycle->cleanup($this->photoId);
        } catch(\Throwable $error) {
            DB::table('photo_records')->where('id',$this->photoId)
                ->increment('cleanup_attempts',1,['cleanup_next_at'=>now()->addMinutes(5)]);
            throw $error;
        }
    }
}
