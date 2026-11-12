<?php
declare(strict_types=1);

namespace App\Console\Commands;

use App\Storage\StorageManager;
use App\Storage\StorageProviderHealth;
use App\Storage\StorageRetryLedger;
use Illuminate\Console\Command;

/**
 * Safe, non-destructive upload ACK-loss reconciliation. Scheduler is bounded
 * and never resends bytes it does not possess, nor creates server receipts.
 */
final class StorageReconcile extends Command
{
    protected $signature='pb3:storage-reconcile {--batch= : Maximum opaque tickets (1..500)}';
    protected $description='Lease and reconcile encrypted S3 ACK-loss tickets (no plaintext/GC)';

    public function handle(
        StorageRetryLedger $ledger,StorageManager $storage,
        StorageProviderHealth $health,
    ):int{
        if(!config('storage_resilience.reconcile_enabled',true)){
            $this->error('Storage reconciliation disabled by operator');
            return self::FAILURE;
        }
        $configured=(int)config('storage_resilience.reconcile_batch',100);
        $batch=$this->option('batch');
        if($batch!==null && (!ctype_digit((string)$batch)
            ||(int)$batch<1||(int)$batch>500)){
            $this->error('Storage reconciliation batch must be 1..500');
            return self::FAILURE;
        }
        $limit=$batch===null?$configured:(int)$batch;
        $results=$ledger->reconcile($storage,$limit);
        $status=$health->status('app_s3');
        $pending=$ledger->status();
        // Operational counters only, no tenant IDs, keys, paths or GPS.
        $this->line(sprintf(
            'Storage app_s3=%s failures=%d retry_after=%ds; verified=%d await_client=%d deferred=%d retired=%d; pending=%d awaiting_client=%d',
            $status['state'],$status['failures'],$status['retry_after_seconds'],
            $results['verified'],$results['await_client'],$results['retry'],
            $results['retired'],$pending['pending'],$pending['await_client']));
        return self::SUCCESS;
    }
}
