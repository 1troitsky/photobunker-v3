<?php
declare(strict_types=1);
return ['default'=>env('DB_CONNECTION','pgsql'),'connections'=>[
  'sqlite'=>['driver'=>'sqlite','database'=>env('DB_DATABASE',database_path('database.sqlite')),'prefix'=>'','foreign_key_constraints'=>true],
  'pgsql'=>['driver'=>'pgsql','host'=>env('DB_HOST','127.0.0.1'),'port'=>env('DB_PORT','5432'),
   'database'=>env('DB_DATABASE','pb3'),'username'=>env('DB_USERNAME','pb3'),'password'=>env('DB_PASSWORD',''),
   'charset'=>'utf8','prefix'=>'','prefix_indexes'=>true,'search_path'=>'public','sslmode'=>env('DB_SSLMODE','prefer')],
 ],'migrations'=>'migrations'];
