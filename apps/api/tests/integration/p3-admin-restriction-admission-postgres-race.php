<?php
declare(strict_types=1);

/**
 * P3 #228 - REAL PostgreSQL18 2-OS-PHP process policy-admission vs
 * administrative-account-restriction race.
 *
 * This is an INTERNAL integration proof, NOT session authentication, public
 * route, live HTTP ban, device cryptographic revoke or external S3 barrier.
 * Runs ONLY on disposable CI PostgreSQL18 with synthetic accounts/devices.
 */

use App\Administration\AdminPrincipal;
use App\Administration\Restrictions\AuditedAccountRestrictionExecutor;
use App\Administration\Restrictions\TransactionBoundRestrictionAdmission;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function mustPass(bool $ok, string $message): void
{
    if (!$ok) {
        fwrite(STDERR, 'P3 #228 PG18 admission race FAIL: '.$message."\n");
        exit(70);
    }
}

foreach ([
    'GITHUB_ACTIONS' => 'true',
    'PB3_ADMIN_228_PG_RACE' => '1',
    'APP_ENV' => 'testing',
    'DB_CONNECTION' => 'pgsql',
    'DB_HOST' => '127.0.0.1',
    'DB_DATABASE' => 'pb3_admin_trial_228_ci',
    'DB_USERNAME' => 'pb3_admin_228_ci',
] as $key => $expected) {
    mustPass(getenv($key) === $expected, 'REFUSED unsafe environment '.$key);
}
mustPass(extension_loaded('pdo_pgsql'), 'requires real PDO pgsql');

require dirname(__DIR__,2).'/vendor/autoload.php';
$app = require dirname(__DIR__,2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
mustPass(config('app.env') === 'testing'
    && config('database.default') === 'pgsql'
    && config('database.connections.pgsql.host') === '127.0.0.1'
    && config('database.connections.pgsql.database') === 'pb3_admin_trial_228_ci'
    && DB::getSchemaBuilder()->hasTable('identity_accounts')
    && DB::getSchemaBuilder()->hasTable('identity_devices')
    && DB::getSchemaBuilder()->hasTable('admin_audit_records_v1')
    && DB::getSchemaBuilder()->hasTable('admin_temporary_restriction_events_v1'),
    'refuse unmigrated/non-disposable DB');

function awaitFile(string $path, int $timeoutMs = 24000): void
{
    $start = microtime(true);
    while (!is_file($path)) {
        mustPass((microtime(true)-$start)*1000 < $timeoutMs,
            'timeout waiting '.basename($path));
        usleep(20000);
    }
}

function accountFixture(): string
{
    $id=(string)Str::uuid();
    DB::table('identity_accounts')->insert([
        'id'=>$id,'operation_id'=>(string)Str::uuid(),
        'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
        'reserved_until'=>now()->addDay(),
        'created_at'=>now(),'updated_at'=>now(),
    ]);
    return $id;
}

function deviceFixture(string $account): string
{
    $id=(string)Str::uuid();
    DB::table('identity_devices')->insert([
        'id'=>$id,'account_id'=>$account,
        'signing_spki'=>'synthetic-key-no-real-customer',
        'created_at'=>now(),'updated_at'=>now(),
    ]);
    return $id;
}

function action(array $f, string $which): array
{
    if ($which === 'admin') {
        $principal=new AdminPrincipal(
            $f['operatorId'], 'operator',
            (int)$f['operatorExpiryMs'], (int)$f['operatorMfaMs'],
        );
        return app(AuditedAccountRestrictionExecutor::class)->restrictTrusted(
            $principal, $f['operationId'], $f['accountId'], 0,
            'abuse_report', CarbonImmutable::parse($f['restrictUntil'],'UTC'),
        );
    }
    mustPass($which==='admission', 'unknown worker action');
    app(TransactionBoundRestrictionAdmission::class)
        ->assertForTrustedDatabaseTransaction($f['accountId'],$f['deviceId']);
    // Strictly technical synthetic SQL in disposable CI. Proof that the
    // guard has completed BEFORE any protected DB mutation.
    $affected=DB::table('identity_devices')
        ->where('id',$f['deviceId'])
        ->update(['updated_at'=>CarbonImmutable::parse($f['writeAt'],'UTC')]);
    mustPass($affected===1, 'expected protected synthetic SQL update');
    return ['state'=>'internal_trusted_database_write'];
}

function runWorker(array $args): never
{
    mustPass(count($args)===6, 'worker args');
    [$cmd,$actionType,$fixturePath,$ownerReady,$contenderReady,$out]=$args;
    mustPass($cmd==='worker' && in_array($actionType,['admission','admin'],true),
        'wrong worker args');
    $f=json_decode((string)file_get_contents($fixturePath),true,16,JSON_THROW_ON_ERROR);
    mustPass(is_array($f) && isset($f['accountId'],$f['deviceId'],
        $f['operationId'],$f['operatorId']), 'broken fixture');
    $pid=(int)DB::selectOne('SELECT pg_backend_pid() AS pid')->pid;
    $start=microtime(true);
    $isOwner=($f['isOwner'] ?? false)===true;
    try {
        if ($isOwner) {
            $result=DB::transaction(function () use (
                $f,$actionType,$ownerReady,$contenderReady,$pid,
            ): array {
                // Authorization and protected SQL stay in SAME TX. If admin
                // owns this transaction, the global audit and account
                // restriction also stay uncommitted until deliberate hold.
                $result=action($f,$actionType);
                file_put_contents($ownerReady,(string)$pid);
                awaitFile($contenderReady);
                usleep(1900000);
                return $result;
            },1);
        } else {
            file_put_contents($contenderReady,(string)$pid);
            $result=DB::transaction(fn()=>action($f,$actionType),1);
        }
        $result['outcome']='allowed';
    } catch (DomainException $e) {
        $result=['outcome'=>'denied','reason'=>$e->getMessage()];
    } catch (Throwable $e) {
        $result=[
            'outcome'=>'unexpected_error',
            'type'=>get_class($e),'reason'=>$e->getMessage(),
        ];
    }
    $result['backend']=$pid;
    $result['osPid']=getmypid();
    $result['elapsedMs']=(int)round((microtime(true)-$start)*1000);
    file_put_contents($out,json_encode($result,JSON_THROW_ON_ERROR));
    exit($result['outcome']==='unexpected_error'?2:0);
}

function startProcess(
    string $actionType,string $fixture,string $ownerReady,
    string $contenderReady,string $out,string $log,
): mixed {
    $proc=proc_open([
        PHP_BINARY,__FILE__,'worker',$actionType,$fixture,
        $ownerReady,$contenderReady,$out,
    ],[
        0=>['pipe','r'],
        1=>['file',$log.'.stdout','w'],
        2=>['file',$log.'.stderr','w'],
    ],$pipes,dirname(__DIR__,2),null,['bypass_shell'=>true]);
    mustPass(is_resource($proc),'spawn PHP OS process');
    fclose($pipes[0]);
    return $proc;
}

function observedDatabaseLock(int $pid,int $timeoutMs=1550): bool
{
    $start=microtime(true);
    while ((microtime(true)-$start)*1000 < $timeoutMs) {
        $row=DB::selectOne(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid = ?',[$pid]);
        if($row !== null && $row->wait_event_type === 'Lock'){
            return true;
        }
        usleep(25000);
    }
    return false;
}

function race(string $name,array $ownerInput,string $ownerAction,
    array $contenderInput,string $contenderAction): array
{
    $dir=sys_get_temp_dir().'/pb3-txbound-admission-'.bin2hex(random_bytes(8));
    mustPass(mkdir($dir,0700),'create private race fixture');
    $fa=$dir.'/a.json';$fb=$dir.'/b.json';
    $readyA=$dir.'/a.ready';$readyB=$dir.'/b.ready';
    $resultA=$dir.'/a.out';$resultB=$dir.'/b.out';
    $ownerInput['isOwner']=true;
    $contenderInput['isOwner']=false;
    file_put_contents($fa,json_encode($ownerInput,JSON_THROW_ON_ERROR));
    file_put_contents($fb,json_encode($contenderInput,JSON_THROW_ON_ERROR));
    $pa=null;$pb=null;
    try {
        $pa=startProcess($ownerAction,$fa,$readyA,$readyB,$resultA,$dir.'/a');
        awaitFile($readyA);
        $pb=startProcess($contenderAction,$fb,$readyA,$readyB,$resultB,$dir.'/b');
        awaitFile($readyB);
        $locked=observedDatabaseLock((int)file_get_contents($readyB));
        awaitFile($resultA);awaitFile($resultB);
        $ea=proc_close($pa);$pa=null;
        $eb=proc_close($pb);$pb=null;
        $a=json_decode((string)file_get_contents($resultA),true,16,JSON_THROW_ON_ERROR);
        $b=json_decode((string)file_get_contents($resultB),true,16,JSON_THROW_ON_ERROR);
        mustPass($ea===0 && $eb===0,
            $name.' OS worker exited unexpectedly '.json_encode([$a,$b]));
        mustPass($locked,
            $name.' MUST observe real PostgreSQL wait_event_type=Lock');
        mustPass($a['backend']!==$b['backend'] && $a['osPid']!==$b['osPid'],
            $name.' needs two real PostgreSQL connections and PHP OS PIDs');
        mustPass($a['outcome']==='allowed',
            $name.' first holder action must succeed '.json_encode($a));
        mustPass($b['elapsedMs']>=300,$name.' contender did not really wait');
        return ['owner'=>$a,'contender'=>$b];
    } finally {
        foreach ([$pa,$pb] as $p){
            if(is_resource($p)){proc_terminate($p);proc_close($p);}
        }
        foreach(glob($dir.'/*') ?: [] as $f){@unlink($f);}
        @rmdir($dir);
    }
}

if(($argv[1]??null)==='worker'){
    runWorker(array_slice($argv,1));
}
mustPass(count($argv)===1,'unknown CLI arguments');

$operatorId=accountFixture();
$now=CarbonImmutable::now('UTC');
$actor=[
    'operatorId'=>$operatorId,
    'operatorExpiryMs'=>$now->getTimestampMs()+3600000,
    'operatorMfaMs'=>$now->getTimestampMs()-1000,
];

// 0. Real unwrapped PDO/Laravel connection is in autocommit. A middleware
// authorization before starting a protected SQL transaction is REFUSED.
mustPass(DB::transactionLevel()===0,'fixture must start in autocommit');
$a0=accountFixture();
$d0=deviceFixture($a0);
try{
    app(TransactionBoundRestrictionAdmission::class)
        ->assertForTrustedDatabaseTransaction($a0,$d0);
    mustPass(false,'autocommit admission MUST fail closed');
}catch(DomainException $e){
    mustPass($e->getMessage()==='admin.restriction_transaction_required',
        'autocommit refused for exact expected reason');
}
fwrite(STDOUT,"P3 #228 PG18 ADMISSION AUTOCOMMIT REFUSAL PASS: no outer transaction\n");

// 1. Already-authenticated user DB transaction checks and writes protected
// technical SQL while retaining FOR SHARE; admin must wait on account FOR
// UPDATE before recording a restriction. After both commit, new admission
// gets denied (old authorized DB work was already committed).
$a1=accountFixture();
$d1=deviceFixture($a1);
$f1=$actor+[
    'accountId'=>$a1,'deviceId'=>$d1,
    'operationId'=>(string)Str::uuid(),
    'restrictUntil'=>$now->addDays(2)->startOfSecond()->format('Y-m-d\TH:i:s\Z'),
    'writeAt'=>$now->addMinutes(5)->startOfSecond()->format('Y-m-d\TH:i:s\Z'),
];
$r1=race('authorized-DB-first-admin-waits',$f1,'admission',$f1,'admin');
mustPass($r1['owner']['state']==='internal_trusted_database_write'
    && $r1['contender']['outcome']==='allowed'
    && $r1['contender']['state']==='internal_audited_account_restriction_recorded',
    'user SQL commits before queued admin restriction');
$storedWrite = DB::table('identity_devices')->where('id',$d1)->value('updated_at');
mustPass($storedWrite !== null && CarbonImmutable::parse((string)$storedWrite,'UTC')
    ->getTimestamp()===CarbonImmutable::parse($f1['writeAt'],'UTC')->getTimestamp(),
    'protected DB mutation persisted prior to restriction (instant, not timezone rendering)');
mustPass(DB::table('admin_audit_records_v1')->where('operation_id',$f1['operationId'])
    ->count()===1 && DB::table('admin_temporary_restriction_events_v1')
    ->where('operation_id',$f1['operationId'])->count()===1,
    'exact one global-audited restriction after user write');
try{
    DB::transaction(fn()=>app(TransactionBoundRestrictionAdmission::class)
        ->assertForTrustedDatabaseTransaction($a1,$d1));
    mustPass(false,'new admission after restrict cannot succeed');
}catch(DomainException $e){
    mustPass($e->getMessage()==='admin.restriction_access_denied',
        'after-commit restricted user denied');
}
fwrite(STDOUT,"P3 #228 PG18 ADMISSION FIRST USER WORK LOCK PROTECTION PASS: real PG Lock, later restriction\n");

// 2. Admin owns a real transaction, creates *uncommitted* restriction and
// holds account lock; concurrent session admission waits and must observe
// denied AFTER admin commit, before touching protected SQL.
$a2=accountFixture();
$d2=deviceFixture($a2);
$f2=$actor+[
    'accountId'=>$a2,'deviceId'=>$d2,
    'operationId'=>(string)Str::uuid(),
    'restrictUntil'=>$now->addDays(2)->startOfSecond()->format('Y-m-d\TH:i:s\Z'),
    'writeAt'=>$now->addMinutes(7)->startOfSecond()->format('Y-m-d\TH:i:s\Z'),
];
$before=DB::table('identity_devices')->where('id',$d2)->value('updated_at');
$r2=race('admin-restriction-first-user-denied',$f2,'admin',$f2,'admission');
mustPass($r2['owner']['state']==='internal_audited_account_restriction_recorded'
    && $r2['contender']['outcome']==='denied'
    && $r2['contender']['reason']==='admin.restriction_access_denied',
    'user admission MUST fail closed after real admin row lock commit');
mustPass($before===DB::table('identity_devices')->where('id',$d2)->value('updated_at'),
    'DENIED user never executes protected SQL after admin wins');
mustPass(DB::table('admin_audit_records_v1')->where('operation_id',$f2['operationId'])
    ->count()===1 && DB::table('admin_temporary_restriction_events_v1')
    ->where('operation_id',$f2['operationId'])->count()===1,
    'one atomic audited restriction after admin wins');
fwrite(STDOUT,"P3 #228 PG18 ADMISSION ADMIN FIRST DENY PASS: real PG Lock, no protected SQL write\n");

fwrite(STDOUT,"P3 #228 PG18 ADMISSION COMPLETE: autocommit DENIED + 2/2 true two-OS-PHP/two-PG18-backend account admission vs restriction races PASS; NO LIVE IDENTITY ROUTE OR AUTHENTICATION\n");
