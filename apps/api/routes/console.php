<?php
declare(strict_types=1);

use Illuminate\Support\Facades\Schedule;

// Destructive cleanup stays DISABLED by default until lifecycle safety is
// accepted by the owner. Only disposable CI invokes it explicitly.
if (filter_var(env('PB3_ENABLE_PHOTO_CLEANUP',false),FILTER_VALIDATE_BOOL)){
  Schedule::command('pb3:photo-maintain')->everyMinute()->withoutOverlapping();
}

// Independent, default-OFF media TTL. Requires explicit operator approval.
if(filter_var(env('PB3_ENABLE_MEDIA_CLEANUP',false),FILTER_VALIDATE_BOOL)){
  Schedule::command('pb3:media-maintain')->everyMinute()->withoutOverlapping();
}

// Logical assignment tombstones only, NOT S3 deletion. Operator opt-in.
if(filter_var(env('PB3_ENABLE_ASSIGNMENT_RETENTION',false),FILTER_VALIDATE_BOOL)){
  Schedule::command('pb3:assignment-retain')->everyMinute()->withoutOverlapping();
}


// Browser archive 7-day expiry is explicitly opt-in AND independent of the
// separately operator-approved photo/media physical GC. Default OFF.
if(filter_var(env('PB3_ENABLE_BROWSER_ARCHIVE',false),FILTER_VALIDATE_BOOL)
  &&filter_var(env('PB3_ENABLE_ARCHIVE_AUTO_CLEANUP',false),FILTER_VALIDATE_BOOL)){
  Schedule::command('pb3:browser-archive-maintain')
    ->everyMinute()->withoutOverlapping();
}
