<?php
declare(strict_types=1);

namespace App\Console\Commands;

use App\Assignments\AssignmentRetentionLifecycle;
use Illuminate\Console\Command;

/**
 * Records due assignment ASSOCIATION tombstones only, NEVER S3 deletion.
 * An operator must explicitly enable this command. Even with it off,
 * endpoint authorization enforces the deadlines at request time.
 */
final class AssignmentRetain extends Command
{
    protected $signature='pb3:assignment-retain {--batch=100}';
    protected $description='Gated assignment logical-cutoff/tombstone reconciliation (no file deletion)';

    public function handle(AssignmentRetentionLifecycle $lifecycle):int
    {
        if(!config('assignment_retention.enabled',false)){
            $this->error('Assignment retention maintenance is disabled (PB3_ENABLE_ASSIGNMENT_RETENTION).');
            return self::FAILURE;
        }
        $batch=min(500,max(1,(int)$this->option('batch')));
        $ids=$lifecycle->dueIds($batch);
        $files=0;$assignments=0;
        foreach($ids as $id){
            $marked=$lifecycle->mark($id);
            if($marked['files'])$files++;
            if($marked['assignment'])$assignments++;
        }
        $this->line(sprintf(
            'Due assignments reconciled: %d; files-access cutoffs: %d; assignment cutoffs: %d; physical media deletion: 0 (not authorized)',
            count($ids),$files,$assignments
        ));
        return self::SUCCESS;
    }
}
