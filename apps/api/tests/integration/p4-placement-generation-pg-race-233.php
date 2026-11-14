<?php
declare(strict_types=1);

/**
 * P4 #233 — two genuine independent PHP worker processes contending over
 * the SAME trusted account row lock in real PostgreSQL18.
 *
 * Both call the ACTUAL PlacementReadiness physical readback on two real
 * separate disposable Garage 2.5 instances, then the real
 * PlacementPreparationLedger::prepare. Parent requires BOTH contenders'
 * pg_stat_activity.wait_event_type=Lock BEFORE releasing its own held
 * identity_accounts SELECT FOR UPDATE row lock. Not an elapsed-time proxy.
 *
 * Tested only on ephemeral synthetic DB/S3 fixtures in GitHub Actions.
 * No actual asset placement, cloud write/move/delete or production network.
 */

use App\Storage\AppS3Adapter;
use App\Storage\Placement\PlacementReadiness;
use App\Storage\Placement\PlacementPreparationLedger;
use App\Storage\StorageAdapter;
use Aws\S3\Exception\S3Exception;
use Aws\S3\S3Client;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function race233Must(bool $value,string $reason): void
{
    if (!$value) throw new RuntimeException('p4.placement.race_failed: '.$reason);
}

function race233Guard(): void
{
    foreach ([
        'GITHUB_ACTIONS'=>'true',
        'PB3_PLACEMENT_REAL_GARAGE_CI'=>'1',
        'APP_ENV'=>'testing',
        'DB_CONNECTION'=>'pgsql',
        'DB_HOST'=>'127.0.0.1',
        'DB_PORT'=>'5432',
        'DB_DATABASE'=>'pb3_placement_233',
        'DB_USERNAME'=>'pb3_placement',
        'S3_ENDPOINT'=>'http://127.0.0.1:3900',
        'S3_REGION'=>'garage',
        'S3_BUCKET'=>'pb3-placement-233-a',
        'PB3_PLACEMENT_B_ENDPOINT'=>'http://127.0.0.1:4900',
        'PB3_PLACEMENT_B_BUCKET'=>'pb3-placement-233-b',
    ] as $k=>$expected) {
        if (getenv($k)!==$expected) {
            throw new RuntimeException('p4.placement.race_refused_environment: '.$k);
        }
    }
    $path=getenv('PB3_PLACEMENT_FIXTURE_PATH');
    $temp=getenv('RUNNER_TEMP');
    race233Must(is_string($temp) && is_string($path)
        && str_starts_with($path,$temp.'/pb3-placement-233-')
        && !str_contains($path,'..') && str_ends_with($path,'.json')
        && is_file($path),'missing_isolated_fixture');
    foreach ([
        'S3_ACCESS_KEY','S3_SECRET_KEY',
        'PB3_PLACEMENT_B_ACCESS_KEY','PB3_PLACEMENT_B_SECRET_KEY',
    ] as $k) {
        race233Must(strlen((string)getenv($k))>=10,
            'invalid_disposable_s3_credential');
    }
    race233Must(getenv('S3_ACCESS_KEY')!==getenv('PB3_PLACEMENT_B_ACCESS_KEY'),
        'identical_test_provider_credentials');
}
race233Guard();
require dirname(__DIR__,2).'/vendor/autoload.php';
$app=require dirname(__DIR__,2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

race233Must(config('database.default')==='pgsql'
    && config('database.connections.pgsql.database')==='pb3_placement_233'
    && config('filesystems.disks.ciphertext.endpoint')==='http://127.0.0.1:3900',
    'not_the_expected_test_database_or_disk');
$server=DB::selectOne("SELECT current_setting('server_version_num')::integer AS n");
race233Must((int)$server->n>=180000 && (int)$server->n<190000,
    'not_postgres18');

final class Race233SecondaryGarage implements StorageAdapter
{
    private S3Client $s3;
    private string $bucket;

    public function __construct()
    {
        $this->bucket=(string)getenv('PB3_PLACEMENT_B_BUCKET');
        $this->s3=new S3Client([
            'version'=>'latest','region'=>'garage',
            'endpoint'=>(string)getenv('PB3_PLACEMENT_B_ENDPOINT'),
            'use_path_style_endpoint'=>true,
            'credentials'=>[
                'key'=>(string)getenv('PB3_PLACEMENT_B_ACCESS_KEY'),
                'secret'=>(string)getenv('PB3_PLACEMENT_B_SECRET_KEY'),
            ],
            'retries'=>0,
            'http'=>['connect_timeout'=>2,'timeout'=>5],
        ]);
    }

    public function putStream(string $key,mixed $stream):bool
    {
        throw new RuntimeException('race233.physical_write_forbidden');
    }
    public function readStream(string $key):mixed
    {
        $r=$this->s3->getObject(['Bucket'=>$this->bucket,'Key'=>$key]);
        $bytes=(string)$r['Body'];
        $handle=fopen('php://temp','w+b');
        if (!is_resource($handle)
            || fwrite($handle,$bytes)!==strlen($bytes)) {
            throw new RuntimeException('race233.cannot_read_synthetic_fixture');
        }
        rewind($handle);
        return $handle;
    }
    public function exists(string $key):bool
    {
        try {
            $this->s3->headObject(['Bucket'=>$this->bucket,'Key'=>$key]);
            return true;
        } catch (S3Exception $error) {
            if ($error->getStatusCode()===404) return false;
            throw $error;
        }
    }
    public function size(string $key):int
    {
        $r=$this->s3->headObject(['Bucket'=>$this->bucket,'Key'=>$key]);
        return (int)$r['ContentLength'];
    }
    public function delete(string $key):bool
    {
        throw new RuntimeException('race233.physical_delete_forbidden');
    }
}

function race233Ledger(): PlacementPreparationLedger
{
    return new PlacementPreparationLedger(new PlacementReadiness([
        'app_s3'=>[
            'adapter'=>new AppS3Adapter(),
            'failureDomain'=>'garage-node-a-3900',
            'credentialRevision'=>1,
        ],
        'user_s3'=>[
            'adapter'=>new Race233SecondaryGarage(),
            'failureDomain'=>'garage-node-b-4900',
            'credentialRevision'=>1,
        ],
    ]));
}

/** @return array<string,mixed> */
function race233Fixture():array
{
    $f=json_decode((string)file_get_contents(
        (string)getenv('PB3_PLACEMENT_FIXTURE_PATH')),
        true,32,JSON_THROW_ON_ERROR);
    race233Must(is_array($f)&&isset($f['photo'])
        && is_array($f['photo'])
        && ($f['photo']['kind']??null)==='photo'
        && Str::isUuid($f['photo']['account']??'')
        && Str::isUuid($f['photo']['asset']??'')
        && Str::isUuid($f['photo']['source']??'')
        && Str::isUuid($f['photo']['target']??''),
        'invalid_synthetic_fixture');
    return $f['photo'];
}

function race233WaitFile(string $file,int $timeoutMs=14000): void
{
    $started=microtime(true);
    while (!is_file($file)) {
        if ((microtime(true)-$started)*1000 > $timeoutMs) {
            throw new RuntimeException('p4.placement.race_timeout');
        }
        usleep(30000);
    }
}

/**
 * Each worker bootstraps the real framework/physical Garage transport and
 * uses its own PHP PID and independent PostgreSQL connection.
 */
function race233Worker(array $arguments): never
{
    // argv slice: scenario, key, expectedGen, resultPath, readyPath
    race233Must(count($arguments)===5,'worker_arg_count');
    [$scenario,$key,$expected,$result,$ready]=$arguments;
    race233Must(in_array($scenario,['same','competing'],true)
        && in_array($expected,['0','1'],true)
        && preg_match('/^[a-z0-9-]{20,96}$/D',$key)===1
        && str_starts_with($result,sys_get_temp_dir().'/pb3-233-race-')
        && str_starts_with($ready,sys_get_temp_dir().'/pb3-233-race-'),
        'worker_arg_validation');

    $f=race233Fixture();
    $backend=DB::selectOne('SELECT pg_backend_pid() AS pid');
    $state=[
        'scenario'=>$scenario,'phpPid'=>getmypid(),
        'pgPid'=>(int)$backend->pid,'outcome'=>'unconfirmed',
    ];
    file_put_contents($ready,json_encode([
        'phpPid'=>getmypid(),'pgPid'=>(int)$backend->pid,
    ],JSON_THROW_ON_ERROR));

    try {
        $candidate=race233Ledger()->prepare(
            $f['account'],'photo',$f['asset'],$f['source'],$f['target'],
            (int)$expected,$key,CarbonImmutable::now('UTC'));
        race233Must(($candidate['switchAuthorized']??null)===false
            && ($candidate['status']??null)==='durable_candidate_only',
            'candidate_was_activated');
        $state['outcome']='accepted';
        $state['candidateId']=$candidate['candidateId'];
        $state['generation']=$candidate['generation'];
    } catch (RuntimeException $e) {
        if ($e->getMessage()!=='placement.stale_generation') {
            throw $e;
        }
        $state['outcome']='placement.stale_generation';
    }
    file_put_contents($result,json_encode($state,JSON_THROW_ON_ERROR));
    exit(0);
}

function race233Start(
    string $scenario,string $key,int $expected,
    string $dir,string $name
): array {
    $ready=$dir.'/'.$name.'.ready.json';
    $result=$dir.'/'.$name.'.result.json';
    $pipes=[];
    $cmd=[
        PHP_BINARY,__FILE__,'worker',$scenario,$key,
        (string)$expected,$result,$ready,
    ];
    $proc=proc_open($cmd,[
        0=>['pipe','r'],
        1=>['file',$dir.'/'.$name.'.stdout','w'],
        2=>['file',$dir.'/'.$name.'.stderr','w'],
    ],$pipes,dirname(__DIR__,2),null,['bypass_shell'=>true]);
    race233Must(is_resource($proc),'cannot_spawn_independent_worker');
    fclose($pipes[0]);
    return ['proc'=>$proc,'ready'=>$ready,'result'=>$result];
}

function race233WaitLocked(int $pidA,int $pidB):array
{
    $start=microtime(true);
    do {
        $rows=DB::select(
            'SELECT pid, state, wait_event_type, wait_event FROM pg_stat_activity WHERE pid IN (?, ?)',
            [$pidA,$pidB]
        );
        $waiting=[];
        foreach ($rows as $row) {
            if ($row->state==='active' && $row->wait_event_type==='Lock') {
                $waiting[(int)$row->pid]=(string)$row->wait_event;
            }
        }
        if (isset($waiting[$pidA],$waiting[$pidB])) {
            return [
                'bothBlocked'=>true,'pgPidA'=>$pidA,'pgPidB'=>$pidB,
                'waitA'=>$waiting[$pidA],'waitB'=>$waiting[$pidB],
            ];
        }
        usleep(35000);
    } while ((microtime(true)-$start)*1000 < 14000);
    throw new RuntimeException('p4.placement.race_failed: both_real_pg_lock_waits_not_observed');
}

/** @return array<string,mixed> */
function race233Contend(
    string $scenario,string $keyA,string $keyB,int $expected
):array {
    $dir=sys_get_temp_dir().'/pb3-233-race-'.bin2hex(random_bytes(9));
    race233Must(mkdir($dir,0700),'cannot_create_private_race_dir');
    $children=[];
    $locked=false;
    try {
        DB::beginTransaction();
        $locked=true;
        $f=race233Fixture();
        $account=DB::table('identity_accounts')
            ->where('id',$f['account'])->where('status','ready')
            ->lockForUpdate()->first();
        race233Must($account!==null,'synthetic_account_not_ready');

        $children[] = race233Start($scenario,$keyA,$expected,$dir,'a');
        $children[] = race233Start($scenario,$keyB,$expected,$dir,'b');
        race233WaitFile($children[0]['ready']);
        race233WaitFile($children[1]['ready']);

        $a=json_decode((string)file_get_contents($children[0]['ready']),
            true,8,JSON_THROW_ON_ERROR);
        $b=json_decode((string)file_get_contents($children[1]['ready']),
            true,8,JSON_THROW_ON_ERROR);
        race233Must(($a['phpPid']??null)!==($b['phpPid']??null)
            && ($a['pgPid']??null)!==($b['pgPid']??null)
            && ($a['phpPid']??null)!==getmypid(),
            'workers_share_php_or_pg_backend');

        $evidence=race233WaitLocked($a['pgPid'],$b['pgPid']);
        // Both real independent workers are waiting on PostgreSQL account
        // row lock before the owner is released.
        DB::commit();
        $locked=false;

        foreach ($children as $child) {
            race233WaitFile($child['result']);
        }
        $result=[];
        foreach ($children as $child) {
            $code=proc_close($child['proc']);
            race233Must($code===0,'worker_nonzero_exit');
            $result[]=json_decode((string)file_get_contents($child['result']),
                true,16,JSON_THROW_ON_ERROR);
        }
        $children=[];
        return ['results'=>$result,'lockEvidence'=>$evidence];
    } finally {
        if ($locked) {
            DB::rollBack();
        }
        foreach ($children as $child) {
            if (is_resource($child['proc'])) {
                proc_terminate($child['proc']);
                proc_close($child['proc']);
            }
        }
        foreach (glob($dir.'/*')?:[] as $file) {
            @unlink($file);
        }
        @rmdir($dir);
    }
}

if (($argv[1]??'')==='worker') {
    race233Worker(array_slice($argv,2));
}
race233Must(count($argv)===1,'parent_arg_count');
$f=race233Fixture();

race233Must(DB::table('placement_candidate_preparations_v1')
    ->where('kind','photo')->where('logical_id',$f['asset'])->count()===0,
    'synthetic_photo_candidate_already_exists');

$key='placement-race-real-replay-233';
$one=race233Contend('same',$key,$key,0);
$first=$one['results'];
race233Must(count($first)===2
    && $first[0]['outcome']==='accepted'
    && $first[1]['outcome']==='accepted'
    && $first[0]['candidateId']===$first[1]['candidateId']
    && $first[0]['generation']===1
    && $first[1]['generation']===1
    && DB::table('placement_candidate_preparations_v1')
        ->where('kind','photo')->where('logical_id',$f['asset'])->count()===1,
    'same_key_did_not_return_original_single_candidate');
echo "P4 #233 REAL PG18 CAS 1/2 PASS: two independent PHP and PG backends BOTH observed waiting on Lock, duplicate key yielded ONE identical generation-1 candidate\n";

$abandoned=race233Ledger()->abandon(
    $f['account'],'photo',$f['asset'],1,$key,CarbonImmutable::now('UTC'));
race233Must($abandoned['state']==='abandoned'
    && $abandoned['switchAuthorized']===false,
    'candidate_cannot_be_abandoned_safely');

$two=race233Contend('competing',
    'placement-race-real-different-a-233',
    'placement-race-real-different-b-233',1);
$outcomes=array_column($two['results'],'outcome');
sort($outcomes);
race233Must($outcomes===['accepted','placement.stale_generation'],
    'different_keys_did_not_fence_racing_generation');
$rows=DB::table('placement_candidate_preparations_v1')
    ->where('kind','photo')->where('logical_id',$f['asset'])
    ->orderBy('generation')->get();
race233Must($rows->count()===2
    && (int)$rows[0]->generation===1
    && $rows[0]->state==='abandoned'
    && (int)$rows[1]->generation===2
    && $rows[1]->state==='prepared',
    'candidate_generation_cas_history_corrupt');
echo "P4 #233 REAL PG18 CAS 2/2 PASS: after abandon, both different-key workers observed real PG Lock; ONE generation-2 candidate, ONE stale rejected\n";

// Account/asset/location/source S3 still untouched by the sidecar journal.
race233Must(DB::table('storage_locations')
        ->where('asset_id',$f['asset'])
        ->whereIn('id',[$f['source'],$f['target']])
        ->where('state','verified')->count()===2,
    'candidate_mutated_live_storage_pointers');
$appS3=new AppS3Adapter();
race233Must($appS3->exists($f['sourceKey'])
    && $appS3->size($f['sourceKey'])===(int)$f['bytes'],
    'candidate_deleted_primary_ciphertext');
$physical=$appS3->readStream($f['sourceKey']);
race233Must(is_resource($physical),'unreadable_primary_ciphertext');
$hash=hash_init('sha256');
$count=hash_update_stream($hash,$physical);
fclose($physical);
race233Must($count===(int)$f['bytes']
    && hash_equals($f['sha'],hash_final($hash)),
    'primary_ciphertext_corrupted_by_candidate_cas');
echo "P4 #233 REAL PG18 CAS COMPLETE 2/2: no active placement switch, real original S3 SHA intact, source and destination pointers unchanged\n";
