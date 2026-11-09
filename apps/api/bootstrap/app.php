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
 ->withRouting(web:__DIR__.'/../routes/web.php',commands:__DIR__.'/../routes/console.php')
 ->withCommands([\App\Console\Commands\PhotoMaintain::class,\App\Console\Commands\MediaMaintain::class])
 ->withMiddleware(function(Middleware $middleware):void {
     // Configure trusted reverse proxies explicitly per deployment.
 })
 ->withExceptions(function(Exceptions $exceptions):void {})
 ->create();
