<?php
declare(strict_types=1);

/**
 * #287 disposable CI-only TEST event: deliberate Go/Pro -> Free ledger
 * transition. NOT a genuine payment expiry, billing checkout, grace
 * scheduler, public admin API or MFA-backed operator authorization.
 */
use App\Billing\EntitlementLedger;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

$expected=[
    'GITHUB_ACTIONS'=>'true',
    'PB3_ISOLATED_STORAGE_SMOKE'=>'1',
    'APP_ENV'=>'testing',
    'DB_CONNECTION'=>'pgsql',
    'DB_HOST'=>'127.0.0.1',
    'DB_DATABASE'=>'pb3_ci_p0',
    'S3_ENDPOINT'=>'http://127.0.0.1:3900',
    'S3_BUCKET'=>'pb3-ci-p0',
    'SESSION_DRIVER'=>'file',
];
foreach($expected as $name=>$value){
    if(getenv($name)!==$value)
        throw new RuntimeException(
            'Refusing downgrade fixture outside disposable CI: '.$name
        );
}
if(getenv('PB3_ENABLE_PHOTO_CLEANUP')==='true')
    throw new RuntimeException('Refusing downgrade fixture with cleanup enabled');
if($argc!==3||!in_array($argv[2],['go','pro'],true)
    ||preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D',$argv[1])!==1)
    throw new RuntimeException('Expected <enrolled UUID> go|pro');

require dirname(__DIR__,2).'/vendor/autoload.php';
$app=require dirname(__DIR__,2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if(config('app.env')!=='testing'
    ||config('database.default')!=='pgsql'
    ||config('database.connections.pgsql.host')!=='127.0.0.1'
    ||config('database.connections.pgsql.database')!=='pb3_ci_p0'
    ||config('session.driver')!=='file'
    ||!DB::getSchemaBuilder()->hasTable('billing_entitlement_heads_v1')
    ||!DB::getSchemaBuilder()->hasTable('billing_entitlement_snapshots_v1')
    ||!DB::getSchemaBuilder()->hasTable('photo_records')
    ||!DB::getSchemaBuilder()->hasTable('media_files_v1'))
    throw new RuntimeException('Refusing wrong database/runtime/schema');

$accountId=(string)$argv[1];$priorPlan=(string)$argv[2];
$account=DB::table('identity_accounts')
    ->where('id',$accountId)->where('status','ready')->first();
$devices=DB::table('identity_devices')
    ->where('account_id',$accountId)->whereNull('revoked_at')->count();
if(!$account||$devices<1)
    throw new RuntimeException('Refusing non-enrolled identity');
$ledger=app(EntitlementLedger::class);
$before=$ledger->current($accountId);
if($before['planId']!==$priorPlan
    ||$before['effectivePlanId']!==$priorPlan
    ||$before['status']!=='active'
    ||$before['paidPrivilegesActive']!==true
    ||$before['revision']!==2
    ||($before['effectiveLimits']['retention']['days']??null)
        !==($priorPlan==='go'?30:90))
    throw new RuntimeException('Refusing wrong/non-paid prior snapshot');

// Do not mutate old signed photo/media contracts. Only a new append-only,
// CAS-checked, synthetic, test-admin entitlement event is created.
$now=CarbonImmutable::now('UTC');
$eventHash=hash('sha256',
    "P1-287_SYNTHETIC_DOWNGRADE_NOT_REAL_ADMIN_OR_PAYMENT\n"
    .$accountId."\n".$priorPlan);
$result=$ledger->advanceTrusted(
    $accountId,'free',2,$eventHash,'admin_mfa_approved',
    $now->subMinute()->startOfSecond(),null,
);
$after=$ledger->current($accountId);
if($after['revision']!==3
    ||$after['planId']!=='free'
    ||$after['effectivePlanId']!=='free'
    ||$after['status']!=='active'
    ||$after['paidPrivilegesActive']!==false
    ||($after['effectiveLimits']['retention']['days']??null)!==14)
    throw new RuntimeException('Free downgrade not atomically accepted');

fwrite(STDOUT,json_encode([
    'testOnly'=>true,
    'realPaymentExpiryVerified'=>false,
    'realAdminMFAVerified'=>false,
    'accountId'=>$accountId,
    'previousPlan'=>$priorPlan,
    'previousRevision'=>$before['revision'],
    'revision'=>$after['revision'],
    'effectivePlanId'=>$after['effectivePlanId'],
    'snapshotSha256'=>$after['snapshotSha256'],
    'unchanged'=>$result['unchanged'],
],JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES)."\n");
