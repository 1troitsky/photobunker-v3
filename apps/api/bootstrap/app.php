<?php
declare(strict_types=1);
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
// Never boot a potentially exposed application on an unapproved PHP patch level.
$id=PHP_VERSION_ID;
if (!(($id>=80427 && $id<80500)||($id>=80512 && $id<80600))) {
    throw new RuntimeException('PB3 rejects unpatched PHP runtime: '.PHP_VERSION);
}
return Application::configure(basePath:dirname(__DIR__))
 ->withRouting(web:__DIR__.'/../routes/web.php',commands:__DIR__.'/../routes/console.php')
 ->withMiddleware(function(Middleware $middleware):void {
     // Trusted proxies must be configured explicitly for the deployment.
 })
 ->withExceptions(function(Exceptions $exceptions):void {})
 ->create();
