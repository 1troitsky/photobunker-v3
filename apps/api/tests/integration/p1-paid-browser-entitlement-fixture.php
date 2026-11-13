<?php
declare(strict_types=1);

/**
 * QA-only #285: activate a synthetic verified Go/Pro entitlement for a REAL
 * browser-enrolled Key-Only account in the disposable PG18/Garage CI database.
 *
 * ABSOLUTELY NOT a payment/settlement test, public billing API or production
 * authorization. The "verified" event is a test fixture deliberately injected
 * at the trusted internal service boundary. No production code calls this.
 */
use App\Billing\EntitlementLedger;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

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
            'Refusing paid-fixture outside isolated GitHub CI: '.$name
        );
}
if(getenv('PB3_ENABLE_PHOTO_CLEANUP')==='true')
    throw new RuntimeException('Refusing paid-fixture with cleanup enabled');
if($argc!==3
    ||!in_array($argv[2],['go','pro'],true)
    ||preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D',
        $argv[1])!==1)
    throw new RuntimeException('Use: fixture.php <actual enrolled UUID> go|pro');

require dirname(__DIR__,2).'/vendor/autoload.php';
$app=require dirname(__DIR__,2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

if(config('app.env')!=='testing'
    ||config('database.default')!=='pgsql'
    ||config('database.connections.pgsql.database')!=='pb3_ci_p0'
    ||config('database.connections.pgsql.host')!=='127.0.0.1'
    ||config('session.driver')!=='file'
    ||!DB::getSchemaBuilder()->hasTable('billing_entitlement_heads_v1')
    ||!DB::getSchemaBuilder()->hasTable('billing_entitlement_snapshots_v1')
    ||!DB::getSchemaBuilder()->hasTable('identity_devices'))
    throw new RuntimeException('Refusing wrong runtime/database/schema');

$accountId=(string)$argv[1];
$plan=(string)$argv[2];
$account=DB::table('identity_accounts')
    ->where('id',$accountId)->where('status','ready')->first();
$devices=DB::table('identity_devices')
    ->where('account_id',$accountId)->whereNull('revoked_at')->count();
if(!$account||$devices<1)
    throw new RuntimeException('Refusing non-enrolled or revoked identity');

$ledger=app(EntitlementLedger::class);
$free=$ledger->current($accountId);
if($free['planId']!=='free'||$free['effectivePlanId']!=='free'
    ||$free['revision']!==1||$free['status']!=='active')
    throw new RuntimeException('Refusing non-fresh Free identity');

$now=CarbonImmutable::now('UTC');
$eventHash=hash('sha256',
    "P1-285_SYNTHETIC_TEST_EVENT_NOT_A_PAYMENT\n".$accountId."\n".$plan);
$paid=$ledger->advanceTrusted(
    $accountId,$plan,1,$eventHash,'settlement_verified',
    $now->subMinutes(2)->startOfSecond(),
    $now->addDays(120)->startOfSecond(),
);
$readback=$ledger->current($accountId);
if($readback['planId']!==$plan
    ||$readback['effectivePlanId']!==$plan
    ||$readback['revision']!==2
    ||$readback['status']!=='active'
    ||$readback['paidPrivilegesActive']!==true
    ||($readback['effectiveLimits']['retention']['days']??null)
        !==($plan==='go'?30:90))
    throw new RuntimeException('Fixture failed trusted ledger verification');

fwrite(STDOUT,json_encode([
    'testOnly'=>true,
    'realPaymentVerified'=>false,
    'accountId'=>$accountId,
    'planId'=>$plan,
    'revision'=>2,
    'snapshotSha256'=>$readback['snapshotSha256'],
],JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES)."\n");
