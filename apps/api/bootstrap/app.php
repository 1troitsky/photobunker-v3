<?php
declare(strict_types=1);
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
$id=PHP_VERSION_ID;
if (!(($id>=80427 && $id<80500)||($id>=80512 && $id<80600))) {
    throw new RuntimeException('PB3 rejects unpatched PHP runtime: '.PHP_VERSION);
}
return Application::configure(basePath:dirname(__DIR__))
 ->withRouting(
     web:__DIR__.'/../routes/web.php',
     commands:__DIR__.'/../routes/console.php',
     then: static function():void {
         // A separate, read-only backup rate route: do not edit the shared
         // web.php currently owned by the Notifications #198 agent.
         // Laravel 'web' middleware still supplies encrypted Identity session.
         \Illuminate\Support\Facades\Route::middleware('web')
             ->group(__DIR__.'/../routes/backup.php');
     },
 )
 ->withCommands([\App\Console\Commands\PhotoMaintain::class,\App\Console\Commands\MediaMaintain::class,\App\Console\Commands\StorageReconcile::class])
 ->withMiddleware(function(Middleware $middleware):void {
     // Configure trusted reverse proxies explicitly per deployment.
 })
 ->withExceptions(function(Exceptions $exceptions):void {})
 ->create();
