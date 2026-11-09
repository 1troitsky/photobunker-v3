<?php
return ['default'=>env('LOG_CHANNEL','stderr'), 'channels'=>['stderr'=>['driver'=>'monolog','handler'=>Monolog\Handler\StreamHandler::class,'with'=>['stream'=>'php://stderr'],'level'=>'warning'],'single'=>['driver'=>'single','path'=>storage_path('logs/laravel.log'),'level'=>'warning']]];
