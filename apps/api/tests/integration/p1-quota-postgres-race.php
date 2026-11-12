<?php
declare(strict_types=1);

/**
 * #279 QA-only: REAL independent PostgreSQL connections contending for one
 * quota slot. Synthetic SQL rows model a pending reservation; these are NOT
 * signed HTTP requests and do NOT represent bytes uploaded to Garage.
 *
 * Absolute safety gate: this script may run ONLY against the disposable CI
 * database, not against a developer's, staging or production environment.
 */
use App\Assignments\MonthlyCreationQuota;
use App\Billing\AccountUsage;
use App\Billing\EntitlementLedger;
use App\Billing\QuotaAdmission;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

function requireIsolated():void
{
    $vars=[
        'GITHUB_ACTIONS'=>'true',
        'PB3_ISOLATED_STORAGE_SMOKE'=>'1',
        'APP_ENV'=>'testing',
        'DB_CONNECTION'=>'pgsql',
        'DB_HOST'=>'127.0.0.1',
        'DB_DATABASE'=>'pb3_ci_p0',
        'S3_ENDPOINT'=>'http://127.0.0.1:3900',
        'S3_BUCKET'=>'pb3-ci-p0',
    ];
    foreach($vars as $key=>$value){
        if(getenv($key)!==$value)throw new RuntimeException(
            'Refusing quota race outside isolated GitHub CI: '.$key
        );
    }
    if(getenv('PB3_ENABLE_PHOTO_CLEANUP')==='true')
        throw new RuntimeException('Refusing concurrency fixture with cleanup enabled');
}

requireIsolated();
require dirname(__DIR__,2).'/vendor/autoload.php';
$app=require dirname(__DIR__,2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if(config('database.default')!=='pgsql'
    ||config('app.env')!=='testing'
    ||config('database.connections.pgsql.database')!=='pb3_ci_p0'
    ||config('database.connections.pgsql.host')!=='127.0.0.1'
    ||!DB::getSchemaBuilder()->hasTable('assignment_creation_meter_v1')
    ||!DB::getSchemaBuilder()->hasTable('media_files_v1')
    ||!DB::getSchemaBuilder()->hasTable('photo_records')){
    throw new RuntimeException('Refusing non-isolated or unmigrated PostgreSQL');
}

function must(bool $ok,string $message):void
{
    if(!$ok)throw new RuntimeException('P1 PG quota race FAIL: '.$message);
}

function waitFor(string $file,int $milliseconds=25000):void
{
    $start=microtime(true);
    while(!is_file($file)){
        if((microtime(true)-$start)*1000>$milliseconds)
            throw new RuntimeException('P1 PG quota race timeout: '.$file);
        usleep(25000);
    }
}

function newAccount():array
{
    $account=(string)Str::uuid();
    $devices=[(string)Str::uuid(),(string)Str::uuid()];
    $now=CarbonImmutable::now('UTC');
    DB::table('identity_accounts')->insert([
        'id'=>$account,'operation_id'=>(string)Str::uuid(),
        'prepare_hash'=>str_repeat('b',64),'status'=>'ready',
        'reserved_until'=>$now->addDay(),
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    foreach($devices as $device)DB::table('identity_devices')->insert([
        'id'=>$device,'account_id'=>$account,
        'signing_spki'=>'p1-279-synthetic-not-a-signature',
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    // Initialize the real, verified immutable Free entitlement before
    // releasing the competing transactions.
    app(EntitlementLedger::class)->current($account);
    return [$account,$devices];
}

function trustedGo(string $account):void
{
    // Only synthetic CI account. This bypasses payment settlement by design;
    // it is not evidence that a production payment flow is implemented.
    app(EntitlementLedger::class)->advanceTrusted(
        $account,'go',1,hash('sha256','p1-279-isolated-go:'.$account),
        'settlement_verified',
        CarbonImmutable::now('UTC')->subMinute()->startOfSecond(),
        CarbonImmutable::now('UTC')->addDay()->startOfSecond(),
    );
}

function photo(string $account,string $device,int $cipherBytes):void
{
    $id=(string)Str::uuid();
    $now=CarbonImmutable::now('UTC');
    DB::table('photo_records')->insert([
        'id'=>$id,'account_id'=>$account,'device_id'=>$device,
        'operation_id'=>(string)Str::uuid(),'state'=>'pending',
        'expires_at'=>$now->addDay()->getTimestampMs(),
        'contract_hash'=>str_repeat('c',64),'contract_json'=>'{}',
        'signature'=>'p1-279-synthetic',
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    if($cipherBytes>0){
        $asset=(string)Str::uuid();
        $key='cipher/v1/'.$account.'/'.$id.'/'.$asset;
        DB::table('photo_objects')->insert([
            'id'=>$asset,'photo_id'=>$id,'kind'=>'master','revision'=>1,
            'bytes'=>$cipherBytes,'sha256'=>str_repeat('d',64),
            'manifest_json'=>'{}','object_key'=>$key,'state'=>'pending',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('storage_locations')->insert([
            'id'=>(string)Str::uuid(),'asset_id'=>$asset,
            'provider'=>'app_s3','object_key'=>$key,
            'sha256'=>str_repeat('d',64),'bytes'=>$cipherBytes,
            'state'=>'reserved','created_at'=>$now,'updated_at'=>$now,
        ]);
    }
}

function media(string $account,string $device,int $cipherBytes):void
{
    $now=CarbonImmutable::now('UTC');
    DB::table('media_files_v1')->insert([
        'id'=>(string)Str::uuid(),'account_id'=>$account,
        'device_id'=>$device,'operation_id'=>(string)Str::uuid(),
        'media_type'=>'video','state'=>'pending',
        'expires_at'=>$now->addDay()->getTimestampMs(),
        'plain_bytes'=>max(128,$cipherBytes-16),
        'cipher_bytes'=>$cipherBytes,
        'contract_hash'=>str_repeat('a',64),'contract_json'=>'{}',
        'signature'=>'p1-279-synthetic',
        'created_at'=>$now,'updated_at'=>$now,
    ]);
}

function assignment(string $account):void
{
    $now=CarbonImmutable::now('UTC');
    $id=(string)Str::uuid();
    $op=(string)Str::uuid();
    DB::table('assignment_records_v1')->insert([
        'id'=>$id,'owner_account_id'=>$account,'operation_id'=>$op,
        'contract_hash'=>str_repeat('e',64),
        'contract_json'=>'{}','owner_signature'=>'p1-279-synthetic',
        'private_envelope_json'=>'{}',
        'state'=>'active','revision'=>1,'policy_revision'=>1,
        'photo_goal'=>null,'starts_at'=>$now->getTimestampMs(),
        'ends_at'=>null,'created_at'=>$now,'updated_at'=>$now,
    ]);
    DB::table('assignment_creation_meter_v1')->insert([
        'assignment_id'=>$id,'owner_account_id'=>$account,
        'operation_id'=>$op,'created_at'=>$now,
    ]);
}

function seedPhotos(string $account,string $device,int $count):void
{
    // Identical required schema to production pending rows, without fake S3
    // receipts or ciphertext. Bulk SQL keeps the QA setup bounded.
    $now=CarbonImmutable::now('UTC');
    $rows=[];
    for($i=0;$i<$count;$i++)$rows[]=[
        'id'=>(string)Str::uuid(),'account_id'=>$account,
        'device_id'=>$device,'operation_id'=>(string)Str::uuid(),
        'state'=>'pending','expires_at'=>$now->addDay()->getTimestampMs(),
        'contract_hash'=>str_repeat('a',64),'contract_json'=>'{}',
        'signature'=>'p1-279-synthetic',
        'created_at'=>$now,'updated_at'=>$now,
    ];
    foreach(array_chunk($rows,100) as $part)DB::table('photo_records')->insert($part);
}

function admission(string $kind,string $account,int $bytes):void
{
    if($kind==='assignment'){
        // This mirrors AssignmentV1Controller::create's account-row lock.
        DB::table('identity_accounts')->where('id',$account)->lockForUpdate()->first();
        $usage=app(MonthlyCreationQuota::class)->usage($account);
        if($usage['remaining']===0)abort(403,'assignment.monthly_quota_exceeded');
        return;
    }
    // Exact production admission service used by BOTH signed Photo and
    // MediaFile reservation handlers, not a copied quota implementation.
    app(QuotaAdmission::class)->admit($account,$bytes);
}

function runWorker(array $args):never
{
    // worker, scenario, owner|challenger, kind, account, device, bytes,
    // ownerReady, challengerReady, output
    must(count($args)===10,'invalid worker CLI');
    [, $scenario,$role,$kind,$account,$device,$bytesString,
        $ownerReady,$challengerReady,$output]=$args;
    must(in_array($scenario,['free-count','go-count','go-bytes',
        'free-assignment','go-assignment'],true),'invalid scenario');
    must(in_array($role,['owner','challenger'],true),'invalid role');
    must(in_array($kind,['photo','media','assignment'],true),'invalid kind');
    must(ctype_digit($bytesString),'invalid byte amount');
    $bytes=(int)$bytesString;
    must(Str::isUuid($account)&&Str::isUuid($device),'invalid IDs');
    $started=microtime(true);
    $outcome='unknown';
    try{
        if($role==='challenger')file_put_contents($challengerReady,'ready');
        DB::transaction(function()use($role,$kind,$account,$device,$bytes,
            $ownerReady,$challengerReady){
            admission($kind,$account,$bytes);
            if($role==='owner'){
                // Keep the real DB row lock held until the second process
                // has begun attempting the *same* account's admission.
                file_put_contents($ownerReady,'locked');
                waitFor($challengerReady);
                usleep(700000);
            }
            match($kind){
                'photo'=>photo($account,$device,$bytes),
                'media'=>media($account,$device,$bytes),
                'assignment'=>assignment($account),
            };
        },1);
        $outcome='accepted';
    }catch(HttpException $error){
        if($error->getStatusCode()!==($kind==='assignment'?403:413))
            throw $error;
        $outcome='rejected_'.$error->getStatusCode();
    }
    file_put_contents($output,json_encode([
        'outcome'=>$outcome,
        'elapsedMs'=>(int)round((microtime(true)-$started)*1000),
    ],JSON_THROW_ON_ERROR));
    exit(0);
}

function spawn(string $scenario,string $role,string $kind,string $account,
    string $device,int $bytes,string $ownerReady,string $challengerReady,
    string $out,string $dir)
{
    $command=[PHP_BINARY,__FILE__,'worker',$scenario,$role,$kind,$account,
        $device,(string)$bytes,$ownerReady,$challengerReady,$out];
    $logs=[
        0=>['pipe','r'],1=>['file',$dir.'/'.$role.'.stdout','w'],
        2=>['file',$dir.'/'.$role.'.stderr','w'],
    ];
    $process=proc_open($command,$logs,$pipes,dirname(__DIR__,2),null,
        ['bypass_shell'=>true]);
    must(is_resource($process),'unable to launch independent worker');
    fclose($pipes[0]);
    return $process;
}

function race(string $scenario,string $account,array $devices,
    string $ownerKind,string $challengerKind,int $bytes):array
{
    $dir=sys_get_temp_dir().'/pb3-p1-279-'.bin2hex(random_bytes(8));
    must(mkdir($dir,0700),'unable to allocate private test directory');
    $ownerReady=$dir.'/owner.locked';
    $challengerReady=$dir.'/challenger.ready';
    $ownerResult=$dir.'/owner.json';
    $challengerResult=$dir.'/challenger.json';
    $owner=null;$challenger=null;
    try{
        $owner=spawn($scenario,'owner',$ownerKind,$account,$devices[0],$bytes,
            $ownerReady,$challengerReady,$ownerResult,$dir);
        waitFor($ownerReady);
        $challenger=spawn($scenario,'challenger',$challengerKind,
            $account,$devices[1],$bytes,
            $ownerReady,$challengerReady,$challengerResult,$dir);
        waitFor($ownerResult);
        waitFor($challengerResult);
        $ownerExit=proc_close($owner);$owner=null;
        $challengerExit=proc_close($challenger);$challenger=null;
        must($ownerExit===0&&$challengerExit===0,
            $scenario.' worker exit != 0');
        $first=json_decode((string)file_get_contents($ownerResult),
            true,8,JSON_THROW_ON_ERROR);
        $second=json_decode((string)file_get_contents($challengerResult),
            true,8,JSON_THROW_ON_ERROR);
        $reject=$ownerKind==='assignment'?'rejected_403':'rejected_413';
        must(($first['outcome']??null)==='accepted'
            &&($second['outcome']??null)===$reject,
            $scenario.' did not enforce exactly one committed reservation');
        must(($first['elapsedMs']??0)>=700
            &&($second['elapsedMs']??0)>=300,
            $scenario.' did not demonstrate overlapping transaction lock wait');
        return ['accepted'=>$first,'rejected'=>$second];
    }finally{
        foreach([$owner,$challenger] as $process){
            if(is_resource($process)){
                proc_terminate($process);
                proc_close($process);
            }
        }
        foreach(glob($dir.'/*')?:[] as $path)@unlink($path);
        @rmdir($dir);
    }
}

if(($argv[1]??'')==='worker'){
    runWorker(array_slice($argv,1));
}
must(($argv[1]??'')==='','unexpected CI harness arguments');

$other= newAccount();
seedPhotos($other[0],$other[1][0],2);
$otherBaseline=app(AccountUsage::class)->measure($other[0]);

// Two *actual independent* PostgreSQL transactions from distinct PHP
// processes, different device rows, one authenticated account row lock.
[$account,$devices]=newAccount();
seedPhotos($account,$devices[0],49);
$one=race('free-count',$account,$devices,'photo','media',256);
$usage=app(AccountUsage::class)->measure($account);
must($usage['activeLogicalMediaFiles']===50
    &&$usage['recordedCipherBytes']===256,
    'Free 49/50 last slot over/under-admitted');
fwrite(STDOUT,"P1 PG FREE 49/50 PHOTO↔MEDIA RACE PASS: 1 accept, 1 HTTP 413, durable single slot\n");

[$account,$devices]=newAccount();
trustedGo($account);
seedPhotos($account,$devices[0],249);
race('go-count',$account,$devices,'media','photo',256);
$usage=app(AccountUsage::class)->measure($account);
must($usage['activeLogicalMediaFiles']===250
    &&$usage['recordedCipherBytes']===256,
    'verified Go 249/250 count over/under-admitted');
fwrite(STDOUT,"P1 PG GO 249/250 MEDIA↔PHOTO RACE PASS: 1 accept, 1 HTTP 413, paid snapshot\n");

[$account,$devices]=newAccount();
trustedGo($account);
media($account,$devices[0],30000000000-256);
race('go-bytes',$account,$devices,'photo','media',256);
$usage=app(AccountUsage::class)->measure($account);
must($usage['activeLogicalMediaFiles']===2
    &&$usage['recordedCipherBytes']===30000000000,
    'Go decimal 30GB last 256 ciphertext bytes over/under-admitted');
fwrite(STDOUT,"P1 PG GO DECIMAL 30GB BYTE RACE PASS: no over-reserve, 1 HTTP 413\n");

[$account,$devices]=newAccount();
assignment($account);assignment($account);
race('free-assignment',$account,$devices,'assignment','assignment',0);
$usage=app(MonthlyCreationQuota::class)->usage($account);
must($usage['used']===3&&$usage['remaining']===0
    &&$usage['planId']==='free',
    'Free 2/3 monthly assignment slot double-spent');
fwrite(STDOUT,"P1 PG FREE 2/3 MONTHLY ASSIGNMENT RACE PASS: 1 accept, 1 HTTP 403\n");

[$account,$devices]=newAccount();
trustedGo($account);
for($i=0;$i<29;$i++)assignment($account);
race('go-assignment',$account,$devices,'assignment','assignment',0);
$usage=app(MonthlyCreationQuota::class)->usage($account);
must($usage['used']===30&&$usage['remaining']===0
    &&$usage['planId']==='go',
    'Go 29/30 monthly assignment slot double-spent');
fwrite(STDOUT,"P1 PG GO 29/30 MONTHLY ASSIGNMENT RACE PASS: 1 accept, 1 HTTP 403\n");

$otherAfter=app(AccountUsage::class)->measure($other[0]);
foreach(['assignmentsCreatedThisUtcMonth','activeLogicalMediaFiles',
    'recordedCipherBytes'] as $field){
    must($otherAfter[$field]===$otherBaseline[$field],
        'cross-account quota isolation changed the unrelated account '.$field);
}
fwrite(STDOUT,"P1 PG QUOTA RACE COMPLETE: 5 genuine two-process PostgreSQL interleavings, 5/5 fail-closed; unrelated account unchanged\n");
