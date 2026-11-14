<?php

declare(strict_types=1);

use App\Http\Controllers\BackupLimitsStatusController;
use Illuminate\Support\Facades\Route;

// Isolated from routes/web.php claimed by the Notifications #198 agent.
// The 'web' middleware is attached in bootstrap/app.php (session, CSRF).
// Do not expose POST /start while no accepted backup worker exists.
Route::prefix('backup/v1')->middleware('throttle:40,1')->group(function (): void {
    Route::get('/limits', [BackupLimitsStatusController::class, 'show']);
});
