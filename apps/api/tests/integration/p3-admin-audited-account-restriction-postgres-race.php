<?php
declare(strict_types=1);

/**
 * #228: REAL two-PHP-process/two-PG18-backend concurrent CROSS-ACTION
 * admin trial grants vs audited account restrictions. GLOBAL audit-head lock
 * must ALWAYS precede target/entitlement locks. Never run in production.
 */
use App\Administration\AdminAuditLedger;
use App\Administration\AdminPrincipal;
use App\Administration\Grants\AdminTrialGrantExecutor;
use App\Administration\Restrictions\AuditedAccountRestrictionExecutor;
use App\Billing\EntitlementLedger;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function chk(bool $condition, string $message): void
{
    if (!$condition) {
        // Laravel's CLI exception handler can report RuntimeException while
        // returning status 0. Test failure MUST be unambiguously nonzero.
        fwrite(STDERR, 'P3 #228 audited CROSS-ACTION real PG18 FAIL: '.$message."\n");
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
] as $key => $value) {
    chk(getenv($key) === $value, 'REFUSED unsafe environment '.$key);
}
chk(extension_loaded('pdo_pgsql'), 'real PDO PostgreSQL required');
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
chk(config('app.env') === 'testing'
    && config('database.default') === 'pgsql'
    && config('database.connections.pgsql.host') === '127.0.0.1'
    && config('database.connections.pgsql.database') === 'pb3_admin_trial_228_ci'
    && DB::getSchemaBuilder()->hasTable('admin_audit_heads_v1')
    && DB::getSchemaBuilder()->hasTable('admin_audit_records_v1')
    && DB::getSchemaBuilder()->hasTable('admin_temporary_restriction_events_v1')
    && DB::getSchemaBuilder()->hasTable('billing_entitlement_heads_v1'),
    'missing expected isolated migrated schema');

function whenReady(string $filename, int $ms = 25000): void
{
    $start = microtime(true);
    while (!is_file($filename)) {
        chk((microtime(true) - $start)*1000 < $ms,
            'timeout on '.basename($filename));
        usleep(20000);
    }
}

function executeAction(array $data): array
{
    $now = CarbonImmutable::now('UTC');
    $principal = new AdminPrincipal(
        $data['actorId'], 'owner', (int) $data['actorExpiresAtMs'],
        isset($data['mfaAgeMs'])
            ? $now->getTimestampMs() - (int) $data['mfaAgeMs']
            : (int) $data['mfaAtMs'],
    );
    $until = CarbonImmutable::parse($data['endsAt'], 'UTC');
    if ($data['kind'] === 'restrict') {
        return app(AuditedAccountRestrictionExecutor::class)->restrictTrusted(
            $principal, $data['operationId'], $data['targetId'],
            (int) $data['expectedRestrictionRevision'], 'abuse_report',
            $until,
        );
    }
    chk($data['kind'] === 'grant', 'worker refuses unknown action');
    return app(AdminTrialGrantExecutor::class)->issueTrusted(
        $principal, $data['operationId'], $data['targetId'],
        'go', 1, 'trial_access',
        CarbonImmutable::parse($data['startsAt'], 'UTC'), $until,
    );
}

function raceWorker(array $args): never
{
    chk(count($args) === 6, 'worker argument count');
    [$cmd,$role,$fixture,$ownerReady,$contenderReady,$output] = $args;
    chk($cmd === 'worker' && in_array($role,['owner','contender'],true),
        'worker type');
    $data = json_decode((string) file_get_contents($fixture),
        true, 16, JSON_THROW_ON_ERROR);
    chk(is_array($data) && isset($data['kind'], $data['targetId'],
        $data['operationId']), 'fixture');
    $pg = (int) DB::selectOne('SELECT pg_backend_pid() AS pid')->pid;
    $started = microtime(true);
    try {
        if ($role === 'owner') {
            DB::transaction(function () use (
                $data,$ownerReady,$contenderReady,$pg,&$result,
            ): void {
                // Lock the global head FIRST. Any audited operation must
                // contend on this shared serialization row, never invert.
                $head = DB::table('admin_audit_heads_v1')->where('id',1)
                    ->lockForUpdate()->first();
                chk($head !== null, 'global audit head exists');
                $result = executeAction($data);
                file_put_contents($ownerReady,(string)$pg);
                whenReady($contenderReady);
                usleep(1850000); // genuine wait, not a fake lock or mock
            }, 1);
        } else {
            file_put_contents($contenderReady,(string)$pg);
            $result = executeAction($data);
        }
        $result['outcome'] = 'applied';
    } catch (DomainException $e) {
        $result = ['outcome'=>'denied','reason'=>$e->getMessage()];
    } catch (Throwable $e) {
        $result = [
            'outcome'=>'unexpected_error',
            'type'=>get_class($e), 'message'=>$e->getMessage(),
        ];
    }
    $result['pgBackend']=$pg;
    $result['osPid']=getmypid();
    $result['elapsedMs']=(int)round((microtime(true)-$started)*1000);
    file_put_contents($output,json_encode($result, JSON_THROW_ON_ERROR));
    exit($result['outcome'] === 'unexpected_error' ? 2 : 0);
}

function launch(
    string $role,string $fixture,string $ownerReady,
    string $contenderReady,string $output,string $log,
): mixed {
    $proc=proc_open([
        PHP_BINARY,__FILE__,'worker',$role,$fixture,
        $ownerReady,$contenderReady,$output,
    ],[
        0=>['pipe','r'],
        1=>['file',$log.'.stdout','w'],
        2=>['file',$log.'.stderr','w'],
    ],$pipes,dirname(__DIR__,2),null,['bypass_shell'=>true]);
    chk(is_resource($proc), 'start independent PHP OS process');
    fclose($pipes[0]);
    return $proc;
}

function didObservePgLock(int $pg,int $ms=1450): bool
{
    $start=microtime(true);
    while ((microtime(true)-$start)*1000 < $ms) {
        $row=DB::selectOne(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid = ?',[$pg],
        );
        if ($row !== null && $row->wait_event_type === 'Lock') {
            return true;
        }
        usleep(25000);
    }
    return false;
}

function racing(string $name,array $first,array $second): array
{
    $dir=sys_get_temp_dir().'/p3-audited-restrict-cross-'.bin2hex(random_bytes(8));
    chk(mkdir($dir,0700),'mkdir private fixture');
    $inputA=$dir.'/a.json';$inputB=$dir.'/b.json';
    $readyA=$dir.'/a.ready';$readyB=$dir.'/b.ready';
    $outA=$dir.'/a.out';$outB=$dir.'/b.out';
    file_put_contents($inputA,json_encode($first, JSON_THROW_ON_ERROR));
    file_put_contents($inputB,json_encode($second, JSON_THROW_ON_ERROR));
    $pa=null;$pb=null;
    try {
        $pa=launch('owner',$inputA,$readyA,$readyB,$outA,$dir.'/a');
        whenReady($readyA);
        $pb=launch('contender',$inputB,$readyA,$readyB,$outB,$dir.'/b');
        whenReady($readyB);
        $locked=didObservePgLock((int)file_get_contents($readyB));
        whenReady($outA);whenReady($outB);
        $ea=proc_close($pa);$pa=null;
        $eb=proc_close($pb);$pb=null;
        $a=json_decode((string)file_get_contents($outA),true,16,JSON_THROW_ON_ERROR);
        $b=json_decode((string)file_get_contents($outB),true,16,JSON_THROW_ON_ERROR);
        chk($ea===0 && $eb===0,$name.' process failed '.json_encode([$a,$b]));
        chk($locked,$name.' MUST OBSERVE real pg_stat_activity wait_event_type=Lock');
        chk($a['osPid']!==$b['osPid'] && $a['pgBackend']!==$b['pgBackend'],
            $name.' two distinct PHP OS and PostgreSQL backends');
        chk($a['outcome']==='applied' && $a['replay']===false,
            $name.' owner must successfully commit exactly one action');
        chk($b['elapsedMs']>=300,$name.' real contention delay');
        return [$a,$b];
    } finally {
        foreach ([$pa,$pb] as $p) {
            if (is_resource($p)) {
                proc_terminate($p);proc_close($p);
            }
        }
        foreach (glob($dir.'/*') ?: [] as $f) {@unlink($f);}
        @rmdir($dir);
    }
}

function account(): string
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

function request(
    array $actor,string $target,string $kind,int $restrictionRev=0,
): array {
    $now=CarbonImmutable::now('UTC');
    return [
        'actorId'=>$actor['id'],
        'actorExpiresAtMs'=>$actor['expires'],
        'mfaAtMs'=>$actor['mfa'],
        'operationId'=>(string)Str::uuid(),
        'targetId'=>$target,
        'kind'=>$kind,
        'expectedRestrictionRevision'=>$restrictionRev,
        'startsAt'=>$now->subSeconds(30)->startOfSecond()->format('Y-m-d\TH:i:s\Z'),
        'endsAt'=>$now->addDays(3)->startOfSecond()->format('Y-m-d\TH:i:s\Z'),
    ];
}

function verifyTarget(
    string $target,int $expectedGrants,int $expectedRestrictions,
): void {
    $a=DB::table('admin_audit_records_v1')->where('target_reference',$target)
        ->orderBy('sequence')->get();
    $g=$a->where('action','grants.issue');
    $s=$a->where('action','accounts.suspend');
    chk($g->count()===$expectedGrants && $s->count()===$expectedRestrictions
        && $a->count()===$expectedGrants+$expectedRestrictions,
        'global audit events match each business action exactly');
    $receipts=DB::table('admin_trial_grant_operations_v1')
        ->where('account_id',$target)->get();
    $restrictions=DB::table('admin_temporary_restriction_events_v1')
        ->where('account_id',$target)->where('target_type','account')
        ->where('target_id',$target)->get();
    chk($receipts->count()===$expectedGrants
        && $restrictions->count()===$expectedRestrictions,
        'both domain histories match global audit');
    foreach ($a as $row) {
        if ($row->action==='grants.issue') {
            $receipt=$receipts->firstWhere('operation_id',$row->operation_id);
            chk($receipt !== null && hash_equals(
                (string)$receipt->audit_digest,(string)$row->digest),
                'grant receipt matches global audit digest');
        } else {
            $r=$restrictions->firstWhere('operation_id',$row->operation_id);
            chk($r!==null && $r->action==='restrict',
                'account restriction exists only when global audit exists');
        }
    }
    if ($expectedRestrictions>0) {
        $head=DB::table('admin_temporary_restriction_heads_v1')
            ->where('target_type','account')->where('target_id',$target)->first();
        chk($head !== null && (int)$head->revision===$expectedRestrictions,
            'restriction CAS head points to committed audit-backed operation');
    }
    if ($expectedGrants>0) {
        $billing=DB::table('billing_entitlement_heads_v1')
            ->where('account_id',$target)->first();
        chk($billing !== null && (int)$billing->revision===2,
            'immutable billing free->grant version exactly once');
    }
}

if (($argv[1] ?? null)==='worker') {
    raceWorker(array_slice($argv,1));
}
chk(count($argv)===1,'unexpected CLI arguments');
$actorId=account();
$now=CarbonImmutable::now('UTC')->getTimestampMs();
$actor=['id'=>$actorId,'expires'=>$now+3600000,'mfa'=>$now-1000];
$baseGlobal = app(AdminAuditLedger::class)->verifyChain()['count'];
$basePolicies = DB::table('admin_temporary_restriction_events_v1')->count();
$baseGrants = DB::table('admin_trial_grant_operations_v1')->count();
// Earlier separately scoped grant/restriction race scripts share this same
// disposable PG18 service. Never assume their global tables are empty.

// 1. Account restriction obtains GLOBAL audit lock before account row,
// contender paid grant to SAME account must queue, then both commit.
$t1=account();
app(EntitlementLedger::class)->current($t1);
[$a1,$b1]=racing('restrict-then-grant',request($actor,$t1,'restrict'),
    request($actor,$t1,'grant'));
chk($b1['outcome']==='applied' && $b1['state']==='internal_trial_grant_recorded',
    'cross-action grant after restriction must commit');
verifyTarget($t1,1,1);
chk(app(AdminAuditLedger::class)->verifyChain()['count']===$baseGlobal+2,
    'first cross-action global audit chain');
fwrite(STDOUT,"P3 #228 PG18 CROSS-ACTION RESTRICT->GRANT PASS: global lock before account, both durable\n");

// 2. Grant first, then restriction: reversed BUSINESS order uses identical
// GLOBAL->account lock order; no cross-operation PG deadlock.
$t2=account();
app(EntitlementLedger::class)->current($t2);
[$a2,$b2]=racing('grant-then-restrict',request($actor,$t2,'grant'),
    request($actor,$t2,'restrict'));
chk($b2['outcome']==='applied'
    && $b2['state']==='internal_audited_account_restriction_recorded',
    'cross-action restrict after grant must commit');
verifyTarget($t2,1,1);
chk(app(AdminAuditLedger::class)->verifyChain()['count']===$baseGlobal+4,
    'second cross-action audit chain');
fwrite(STDOUT,"P3 #228 PG18 CROSS-ACTION GRANT->RESTRICT PASS: no reversed lock deadlock\n");

// 3. Concurrent first restriction writers: second stale CAS must rollback
// its already-written speculative global audit as one ACID transaction.
$t3=account();
[$a3,$b3]=racing('two-restrictions-same-revision',
    request($actor,$t3,'restrict'),request($actor,$t3,'restrict'));
chk($b3['outcome']==='denied'
    && $b3['reason']==='admin.restriction_revision_conflict',
    'stale policy expected revision must deny without global audit');
verifyTarget($t3,0,1);
chk(app(AdminAuditLedger::class)->verifyChain()['count']===$baseGlobal+5,
    'no speculative global audit orphan');
fwrite(STDOUT,"P3 #228 PG18 CROSS-ACTION STALE RESTRICT ROLLBACK PASS\n");

// 4. Same operation ID is NEVER reusable for a distinct business action,
// even after obtaining the same global serialization row.
$t4=account();
app(EntitlementLedger::class)->current($t4);
$grant4=request($actor,$t4,'grant');
$restriction4=request($actor,$t4,'restrict');
$restriction4['operationId']=$grant4['operationId'];
[$a4,$b4]=racing('different-action-same-op-id',$grant4,$restriction4);
chk($b4['outcome']==='denied'
    && $b4['reason']==='admin.audit_inconsistent',
    'global audit action collision must reject cross-action operation ID');
verifyTarget($t4,1,0);
chk(app(AdminAuditLedger::class)->verifyChain()['count']===$baseGlobal+6,
    'same op ID cannot create extra global audit');
fwrite(STDOUT,"P3 #228 PG18 CROSS-ACTION SAME-ID REPLAY DENY PASS\n");

// 5. Contender presents initially fresh MFA, but while waiting to acquire
// the global audit head 1.85s later it expires: no policy/audit mutation.
$t5=account();
$first=request($actor,$t5,'restrict');
$expired=request($actor,$t5,'restrict');
$expired['mfaAgeMs']=299000;
[$a5,$b5]=racing('MFA-expires-before-audit-lock',$first,$expired);
chk($b5['outcome']==='denied' && $b5['reason']==='admin.access_denied',
    'fresh MFA must be rechecked AFTER the global audit lock wait');
verifyTarget($t5,0,1);
chk(app(AdminAuditLedger::class)->verifyChain()['count']===$baseGlobal+7,
    'MFA-expired contender left no audit or policy event');
fwrite(STDOUT,"P3 #228 PG18 CROSS-ACTION MFA-EXPIRY-AFTER-GLOBAL-LOCK DENY PASS\n");

chk(DB::table('admin_audit_records_v1')->count()===$baseGlobal+7,
    'exactly 7 new durable global audit records, no orphan');
chk(DB::table('admin_temporary_restriction_events_v1')->count()===$basePolicies+4,
    'exactly 4 new globally audited account restriction records');
chk(DB::table('admin_trial_grant_operations_v1')->count()===$baseGrants+3,
    'exactly 3 new grants durable and globally audited');
fwrite(STDOUT,"P3 #228 PG18 CROSS-ACTION COMPLETE: 5/5 real 2-PHP independent PostgreSQL18 observed Lock races PASS, global head -> account lock ordered, 7 global audit records, 4 audited restrictions, 3 grants, zero orphans, NO public admin authentication or route\n");
