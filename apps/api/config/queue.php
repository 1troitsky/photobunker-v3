<?php
declare(strict_types=1);
return [
 'default'=>env('QUEUE_CONNECTION','database'),
 'connections'=>['sync'=>['driver'=>'sync'],'database'=>[
    'driver'=>'database','connection'=>env('DB_QUEUE_CONNECTION',env('DB_CONNECTION','pgsql')),
    'table'=>'jobs','queue'=>env('DB_QUEUE','default'),'retry_after'=>180,'after_commit'=>true]],
 'failed'=>['driver'=>'database-uuids','database'=>env('DB_CONNECTION','pgsql'),'table'=>'failed_jobs'],
];
