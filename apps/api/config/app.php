<?php
declare(strict_types=1);
return [
 'name'=>env('APP_NAME','Example Application'),'env'=>env('APP_ENV','production'),
 'debug'=>(bool)env('APP_DEBUG',false),'url'=>env('APP_URL','https://localhost'),
 'key'=>env('APP_KEY'),'cipher'=>'AES-256-CBC','timezone'=>'UTC',
 'locale'=>'ru','fallback_locale'=>'en','faker_locale'=>'en_US',
];
