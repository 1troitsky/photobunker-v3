<?php
declare(strict_types=1);

// Destructive test of SYNTHETIC ciphertext only. All safety guards are required.
// This file must never be invoked against an arbitrary bucket or production DB.
use App\Photo\Lifecycle;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

if (getenv('PB3_ISOLATED_STORAGE_SMOKE') !== '1'
    || getenv('APP_ENV') !== 'testing'
    || getenv('DB_DATABASE') !== 'pb3_ci_p0'
    || getenv('DB_HOST') !== '127.0.0.1'
    || getenv('S3_ENDPOINT') !== 'http://127.0.0.1:3900'
    || getenv('S3_BUCKET') !== 'pb3-ci-p0'
    || getenv('PB3_ENABLE_PHOTO_CLEANUP') === 'true') {
    throw new RuntimeException('Refusing lifecycle fixture outside isolated CI');
}

require dirname(__DIR__, 2) . '/vendor/autoload.php';
$app = require dirname(__DIR__, 2) . '/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$config=config('filesystems.disks.ciphertext');
if (config('database.default') !== 'pgsql'
    || config('app.env') !== 'testing'
    || $config['endpoint'] !== 'http://127.0.0.1:3900'
    || $config['bucket'] !== 'pb3-ci-p0'
    || config('photo_sync.cleanup_enabled', false)) {
    throw new RuntimeException('Refusing lifecycle fixture on non-isolated storage');
}
if (!DB::getSchemaBuilder()->hasTable('storage_locations')) {
    throw new RuntimeException('Missing storage location schema');
}

$account=(string) Str::uuid();
$device=(string) Str::uuid();
$photo=(string) Str::uuid();
$asset=(string) Str::uuid();
$objectKey='cipher/v1/'.$account.'/'.$photo.'/'.$asset;
$bytes=random_bytes(1024);
$now=now();

DB::table('identity_accounts')->insert([
    'id'=>$account,'operation_id'=>(string) Str::uuid(),
    'prepare_hash'=>str_repeat('f',64),'status'=>'ready',
    'reserved_until'=>now()->addDay(),'created_at'=>$now,'updated_at'=>$now,
]);
DB::table('identity_devices')->insert([
    'id'=>$device,'account_id'=>$account,'signing_spki'=>'isolated-test-only',
    'created_at'=>$now,'updated_at'=>$now,
]);
DB::table('photo_records')->insert([
    'id'=>$photo,'account_id'=>$account,'device_id'=>$device,
    'operation_id'=>(string) Str::uuid(),'state'=>'pending',
    'expires_at'=>now()->subMinute()->getTimestampMs(),
    'contract_hash'=>str_repeat('c',64),'contract_json'=>'{}','signature'=>'fixture',
    'created_at'=>$now,'updated_at'=>$now,
]);
DB::table('photo_objects')->insert([
    'id'=>$asset,'photo_id'=>$photo,'kind'=>'master','revision'=>1,
    'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes),
    'manifest_json'=>'{}','object_key'=>$objectKey,
    'state'=>'verified','created_at'=>$now,'updated_at'=>$now,
]);
DB::table('storage_locations')->insert([
    'id'=>(string) Str::uuid(),'asset_id'=>$asset,'provider'=>'app_s3',
    'object_key'=>$objectKey,'sha256'=>hash('sha256',$bytes),
    'bytes'=>strlen($bytes),'state'=>'verified',
    'created_at'=>$now,'updated_at'=>$now,
]);

$disk=Storage::disk('ciphertext');
if($disk->put($objectKey,$bytes)===false || !$disk->exists($objectKey)) {
    throw new RuntimeException('Test fixture upload did not reach Garage');
}

$lifecycle=app(Lifecycle::class);
$lifecycle->cleanup($photo);
if ($disk->exists($objectKey)
    || DB::table('photo_records')->where('id',$photo)->exists()
    || DB::table('photo_objects')->where('id',$asset)->exists()
    || DB::table('storage_locations')->where('asset_id',$asset)->exists()) {
    throw new RuntimeException('Unconfirmed S3 cleanup or retained DB placement');
}
if (!DB::table('photo_tombstones')->where('photo_id',$photo)->exists()) {
    throw new RuntimeException('Durable tombstone missing after expiry');
}

// Simulate two delayed PUTs, separated by a successful sweep. The second
// must not become an untracked permanent orphan after the first sweep.
for ($attempt=1;$attempt<=2;$attempt++) {
    if($disk->put($objectKey,$bytes)===false)throw new RuntimeException('Late PUT fixture failed');
    DB::table('photo_tombstones')->where('photo_id',$photo)->update([
        'cleanup_until'=>now()->subSecond(),
    ]);
    if($lifecycle->sweepTombstones(10)!==1 || $disk->exists($objectKey)) {
        throw new RuntimeException('Late-write reconciliation failed on pass '.$attempt);
    }
    $tombstone=DB::table('photo_tombstones')->where('photo_id',$photo)->first();
    $keys=json_decode($tombstone->object_keys??'',true);
    if(!is_array($keys)||!in_array($objectKey,$keys,true)){
        throw new RuntimeException('Tombstone lost registered location keys');
    }
}

fwrite(STDOUT,"P1 isolated Garage lifecycle: expiry, physical delete, durable repeated late-write sweeps OK\n");
