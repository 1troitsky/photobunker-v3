<?php
declare(strict_types=1);

return [
    // Deliberately off until owner's storage/GC safety acceptance. A Draft
    // PR must never silently make real S3 deletion reachable in production.
    'write_enabled'=>filter_var(env('PB3_ENABLE_BROWSER_ARCHIVE',false),
        FILTER_VALIDATE_BOOL),
    'auto_cleanup_enabled'=>filter_var(env('PB3_ENABLE_ARCHIVE_AUTO_CLEANUP',false),
        FILTER_VALIDATE_BOOL),
    'archive_days'=>7,
    'sweep_batch'=>50,
];
