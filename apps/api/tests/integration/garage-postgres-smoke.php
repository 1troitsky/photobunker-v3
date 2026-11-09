<?php
declare(strict_types=1);
// Explicitly refuse to touch anything except a disposable Garage/PostgreSQL fixture.
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
if (getenv('PB3_ISOLATED_STORAGE_SMOKE')!=='1')throw new RuntimeException('Only isolated CI may run S3 smoke');
require dirname(__DIR__,2).'/vendor/autoload.php';
$app=require dirname(__DIR__,2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$d=config('filesystems.disks.ciphertext');
if(config('database.default')!=='pgsql'
  ||($d['endpoint']??'')!=='http://127.0.0.1:3900'
  ||($d['bucket']??'')!=='pb3-ci-p0')throw new RuntimeException('Refusing non-test storage');
DB::select('SELECT 1');
if (!DB::getSchemaBuilder()->hasTable('jobs'))throw new RuntimeException('Queue migration missing');
$bytes=random_bytes(4096);$key='p0-ci/'.bin2hex(random_bytes(16)).'.bin';
$disk=Storage::disk('ciphertext');
try{
 if($disk->put($key,$bytes)===false)throw new RuntimeException('S3 PUT failed');
 $copy=$disk->get($key);
 if(!is_string($copy)||!hash_equals(hash('sha256',$bytes),hash('sha256',$copy)))
  throw new RuntimeException('S3 SHA-256 mismatch');
 fwrite(STDOUT,"P0 PostgreSQL 18 + Garage S3 readback verified\n");
} finally {
 if($disk->exists($key))$disk->delete($key);
}
