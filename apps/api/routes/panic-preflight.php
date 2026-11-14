<?php

declare(strict_types=1);

use App\Http\Controllers\PanicPreflightStatusController;
use Illuminate\Support\Facades\Route;

/**
 * #221 standalone READ-ONLY route DEFINITION — NOT YET MOUNTED IN PRODUCTION.
 *
 * Explicitly loaded in its isolated Feature tests. Production stitching is
 * blocked until #198 (routes/web.php) and #231 (bootstrap/app.php) route
 * owners complete their CLAIMs and an independent session/CSRF QA approves it.
 *
 * Browser 'web' middleware provides an encrypted, secure session cookie.
 * Never place this in routes/api.php or behind a bearer token.
 * There is deliberately NO POST route for Panic, revoke, purge, GC or ACK.
 */
Route::middleware('web')
    ->prefix('panic/v1')
    ->middleware('throttle:40,1')
    ->group(static function (): void {
        Route::get('/preflight/{operationId}', [PanicPreflightStatusController::class, 'show'])
            ->whereUuid('operationId');
    });
