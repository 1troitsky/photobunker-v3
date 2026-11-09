<?php
declare(strict_types=1);

use Illuminate\Support\Facades\Schedule;

// Destructive cleanup stays DISABLED by default until lifecycle safety is
// accepted by the owner. Only disposable CI invokes it explicitly.
if (filter_var(env('PB3_ENABLE_PHOTO_CLEANUP',false),FILTER_VALIDATE_BOOL)){
  Schedule::command('pb3:photo-maintain')->everyMinute()->withoutOverlapping();
}
