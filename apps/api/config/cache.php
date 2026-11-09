<?php
declare(strict_types=1);
return [
 'default'=>env('CACHE_STORE','file'),
 'stores'=>['file'=>['driver'=>'file','path'=>storage_path('framework/cache/data')],'array'=>['driver'=>'array']],
 'prefix'=>env('CACHE_PREFIX','pb3'),
];
