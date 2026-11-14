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
// Combine middleware in ONE declaration; a second RouteRegistrar::middleware()
// call overwrites the first group and would silently drop StartSession.
Route::middleware(['web', 'throttle:40,1'])
    ->prefix('panic/v1')
    ->group(static function (): void {
        Route::get('/preflight/{operationId}', [PanicPreflightStatusController::class, 'show'])
            ->whereUuid('operationId');
    });
