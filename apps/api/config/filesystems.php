<?php
declare(strict_types=1);
return [
 'default'=>'local',
 'disks'=>[
    'local'=>['driver'=>'local','root'=>storage_path('app/private'),'serve'=>false,'throw'=>true],
    'ciphertext'=>[
        'driver'=>'s3','key'=>env('S3_ACCESS_KEY',''),'secret'=>env('S3_SECRET_KEY',''),
        'region'=>env('S3_REGION','garage'),'bucket'=>env('S3_BUCKET','pb3-local'),
        'endpoint'=>env('S3_ENDPOINT'),'use_path_style_endpoint'=>true,
        'throw'=>true,'report'=>false,'http'=>['connect_timeout'=>3,'timeout'=>25],
    ],
 ],
 'links'=>[],
];
