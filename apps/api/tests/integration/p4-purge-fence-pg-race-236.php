<?php
declare(strict_types=1);

/**
 * P4 #236: real two PHP-OS-process / PostgreSQL18 concurrent durable fence.
 * Only a freshly provisioned disposable Github Actions DB. NO S3 operations.
 * No real user IDs, keys, uploads, deletion or production administrative calls.
 */
use App\Storage\Purge\LivePurgeFence;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function purgeRequireIsolated():void
{
    foreach ([
        'GITHUB_ACTIONS'=>'true',
        'PB3_PURGE_FENCE_REAL_PG_CI'=>'1',
        'APP_ENV'=>'testing',
        'DB_CONNECTION'=>'pgsql',
        'DB_HOST'=>'127.0.0.1',
        'DB_PORT'=>'5432',
        'DB_DATABASE'=>'pb3_purge_236',
        'DB_USERNAME'=>'pb3_purge',
    ] as $key=>$value) {
        if (getenv($key)!==$value) {
            throw new RuntimeException('p4.purge.refuse_non_disposable_ci: '.$key);
        }
    }
}
purgeRequireIsolated();
require dirname(__DIR__,2).'/vendor/autoload.php';
$app=require dirname(__DIR__,2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (config('database.default')!=='pgsql'
    || config('database.connections.pgsql.database')!=='pb3_purge_236') {
    throw new RuntimeException('p4.purge.invalid_db_config');
}
$v=DB::selectOne("select current_setting('server_version_num')::integer as v");
if ((int)$v->v<180000 || (int)$v->v>=190000) {
    throw new RuntimeException('p4.purge.pg18_required');
}

function purgeAssert(bool $ok,string $name):void
{
    if (!$ok) throw new RuntimeException('p4.purge.test_failed: '.$name);
}
function purgeSeedAccount():array
{
    $account=(string)Str::uuid();
    $device=(string)Str::uuid();
    $now=now('UTC');
    DB::table('identity_accounts')->insert([
        'id'=>$account,'operation_id'=>(string)Str::uuid(),
        'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
        'reserved_until'=>$now->copy()->addDay(),
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    DB::table('identity_devices')->insert([
        'id'=>$device,'account_id'=>$account,
        'signing_spki'=>'synthetic-only-p4-236',
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    return [$account,$device];
}
function purgeSeedParent(string $kind,string $account,string $device):string
{
    $id=(string)Str::uuid();
    $now=now('UTC');
    if ($kind==='photo') {
        DB::table('photo_records')->insert([
            'id'=>$id,'account_id'=>$account,'device_id'=>$device,
            'operation_id'=>(string)Str::uuid(),
            'state'=>'active','expires_at'=>$now->copy()->addDay()->getTimestampMs(),
            'contract_hash'=>str_repeat('b',64),
            'contract_json'=>'{}','signature'=>'synthetic',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
    } else {
        DB::table('media_files_v1')->insert([
            'id'=>$id,'account_id'=>$account,'device_id'=>$device,
            'operation_id'=>(string)Str::uuid(),'media_type'=>'video',
            'state'=>'active','expires_at'=>$now->copy()->addDay()->getTimestampMs(),
            'plain_bytes'=>12,'cipher_bytes'=>18,
            'contract_hash'=>str_repeat('b',64),
            'contract_json'=>'{}','signature'=>'synthetic',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
    }
    return $id;
}
function purgeIsSynthetic(string $account,string $kind,string $parent):void
{
    purgeAssert(DB::table('identity_accounts')
        ->where('id',$account)->where('prepare_hash',str_repeat('a',64))
        ->exists(),'only_disposable_identity_allowed');
    $table=$kind==='photo'?'photo_records':'media_files_v1';
    purgeAssert(DB::table($table)->where('id',$parent)
        ->where('contract_hash',str_repeat('b',64))->exists(),
        'only_disposable_parent_allowed');
}

/** @return array<int,array{status:string,pid:int,pgpid:int}> */
function purgeWorkers(string $kind,string $account,string $parent,array $operations):array
{
    $processes=[];
    foreach ($operations as $op) {
        $pipes=[];
        $cmd=[PHP_BINARY,__FILE__,'worker',$kind,$account,$parent,$op,'panic'];
        $proc=proc_open($cmd,[
            0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w'],
        ],$pipes);
        purgeAssert(is_resource($proc),'spawn_independent_php_failed');
        fclose($pipes[0]);
        $processes[]=[$proc,$pipes];
    }
    $out=[];
    foreach ($processes as [$proc,$pipes]) {
        $stdout=(string)stream_get_contents($pipes[1]);
        $stderr=(string)stream_get_contents($pipes[2]);
        fclose($pipes[1]);fclose($pipes[2]);
        $exit=proc_close($proc);
        // stderr must never be printed (may contain DB connection details).
        purgeAssert($exit===0 && $stderr==='','php_worker_failed');
        purgeAssert(preg_match(
            '/^FENCE_WORKER_ACK:(CREATED|REPLAY|CONFLICT):([0-9]+):([0-9]+)\n$/D',
            $stdout,$m)===1,'unverified_worker_ack');
        $out[]=['status'=>$m[1],'pid'=>(int)$m[2],'pgpid'=>(int)$m[3]];
    }
    $rootPg=(int)DB::selectOne('select pg_backend_pid() as pid')->pid;
    $rootOs=(int)getmypid();
    purgeAssert($out[0]['pid']!==$out[1]['pid']
        && $out[0]['pgpid']!==$out[1]['pgpid']
        && $out[0]['pid']!==$rootOs && $out[1]['pid']!==$rootOs
        && $out[0]['pgpid']!==$rootPg && $out[1]['pgpid']!==$rootPg,
        'workers_not_independent');
    return $out;
}

$mode=$argv[1]??'';
if ($mode==='worker') {
    purgeAssert(count($argv)===7,'worker_arg_count');
    [$file,$task,$kind,$account,$parent,$op,$reason]=$argv;
    purgeAssert(in_array($kind,['photo','media'],true)
        && Str::isUuid($account) && Str::isUuid($parent)
        && Str::isUuid($op) && $reason==='panic',
        'bad_worker_args');
    purgeIsSynthetic($account,$kind,$parent);
    try {
        $row=(new LivePurgeFence())->recordAuthorized(
            $account,$kind,$parent,$op,$reason
        );
        $status=$row['replayed']?'REPLAY':'CREATED';
    } catch (RuntimeException $e) {
        purgeAssert($e->getMessage()==='storage.purge_fence_conflict',
            'unexpected_worker_denial');
        $status='CONFLICT';
    }
    $pid=getmypid();
    $pgpid=(int)DB::selectOne('select pg_backend_pid() as pid')->pid;
    echo "FENCE_WORKER_ACK:$status:$pid:$pgpid\n";
    exit(0);
}
purgeAssert($mode==='verify' && count($argv)===2,'unknown_ci_command');
[$account,$device]=purgeSeedAccount();
$ledger=new LivePurgeFence();

// Same operation/reason on identical parent: one CREATE, other replay.
$photo=purgeSeedParent('photo',$account,$device);
$op=(string)Str::uuid();
$race=purgeWorkers('photo',$account,$photo,[$op,$op]);
$states=array_column($race,'status');
sort($states);
purgeAssert($states===['CREATED','REPLAY'],'same_op_should_replay_once');
purgeAssert(DB::table('storage_purge_fences_v1')
    ->where('account_id',$account)->where('kind','photo')
    ->where('parent_id',$photo)->count()===1,
    'same_op_race_should_have_one_durable_row');
echo "P4 #236 REAL PG18 1/4 PASS: separate PHP/PG backend concurrent identical op => one INSERT and one replay, never duplicate\n";

// Conflicting operations on the same canonical parent: one wins, one denies.
$media=purgeSeedParent('media',$account,$device);
$ops=[(string)Str::uuid(),(string)Str::uuid()];
$race=purgeWorkers('media',$account,$media,$ops);
$states=array_column($race,'status');sort($states);
purgeAssert($states===['CONFLICT','CREATED'],'different_op_must_conflict');
$stored=DB::table('storage_purge_fences_v1')
    ->where('account_id',$account)->where('kind','media')
    ->where('parent_id',$media)->first();
purgeAssert($stored!==null
    && in_array((string)$stored->operation_id,$ops,true),
    'first_accepted_op_not_durable');
echo "P4 #236 REAL PG18 2/4 PASS: separate PHP/PG backend conflicting ops => one durable winner, other denied\n";

// DB-level immutability is enforced even for directly issued SQL.
foreach (['update','delete'] as $operation) {
    DB::beginTransaction(); // SAVEPOINT allows recovery from PG error.
    $denied=false;
    try {
        if ($operation==='update') {
            DB::table('storage_purge_fences_v1')->where('id',$stored->id)
                ->update(['reason'=>'ttl']);
        } else {
            DB::table('storage_purge_fences_v1')->where('id',$stored->id)
                ->delete();
        }
    } catch (Throwable $e) {
        $denied=str_contains($e->getMessage(),'storage.purge_fence_immutable');
    } finally {
        DB::rollBack();
    }
    purgeAssert($denied,'postgres_trigger_allowed_row_mutation');
}
purgeAssert($ledger->isFenced($account,'media',$media),
    'failed_direct_db_mutation_erased_fence');
echo "P4 #236 REAL PG18 3/4 PASS: real DB trigger rejects direct UPDATE and DELETE, fence persists\n";

// Canonical metadata may be deleted by a separate audited lifecycle later.
// A replay of its already committed purge intent must still survive.
DB::table('photo_records')->where('id',$photo)->delete();
$ack=$ledger->recordAuthorized($account,'photo',$photo,$op,'panic');
purgeAssert($ack['replayed']===true
    && $ledger->isFenced($account,'photo',$photo),
    'deleted_parent_replayed_fence_not_retained');
echo "P4 #236 REAL PG18 4/4 PASS: parent DB row gone, durable fence and Lost ACK replay survive, no S3 deletion\n";
echo "P4 #236 REAL PG18 COMPLETE 4/4: no external storage I/O, no signed purge, no production data\n";
