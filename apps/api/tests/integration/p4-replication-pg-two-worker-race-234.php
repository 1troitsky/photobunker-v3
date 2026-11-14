<?php
declare(strict_types=1);

/**
 * #234 REAL two-PHP-process / two-PostgreSQL18-backend replica lease races.
 *
 * Genuine physical Garage A -> B ciphertext streaming, and a separate
 * physical PRE-EXISTING Garage B ciphertext object (lost DB ACK).
 * Parent holds the trusted account FOR UPDATE lock and REQUIRES both PHP
 * worker backends to be WAITING ON A REAL PG LOCK before releasing it.
 * Secondary S3 PUT-attempts are counted across processes by a private,
 * OS-lock-protected test-only audit file. No simulated "success" markers.
 *
 * CI only. Synthetic bytes, strictly guarded local disposable PostgreSQL
 * and two isolated Garage v2.5 processes on ONE runner. NOT proof of two
 * geographically/administratively independent production S3 providers.
 */

use App\Storage\AppS3Adapter;
use App\Storage\Replication\CiphertextReplicaCoordinator;
use App\Storage\StorageAdapter;
use Aws\S3\S3Client;
use Aws\S3\Exception\S3Exception;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function race234Must(bool $ok,string $why):void
{
    if (!$ok) throw new RuntimeException('replication234.race_failed: '.$why);
}
function race234Guard():string
{
    foreach ([
        'GITHUB_ACTIONS'=>'true',
        'PB3_REPLICATION_REAL_GARAGE_CI'=>'1',
        'PB3_REPLICATION_PG_RACE_CI'=>'1',
        'APP_ENV'=>'testing',
        'DB_CONNECTION'=>'pgsql',
        'DB_HOST'=>'127.0.0.1',
        'DB_PORT'=>'5432',
        'DB_DATABASE'=>'pb3_replication_234',
        'DB_USERNAME'=>'pb3_replication',
        'S3_ENDPOINT'=>'http://127.0.0.1:3900',
        'S3_REGION'=>'garage',
        'S3_BUCKET'=>'pb3-replication-234-a',
        'PB3_REPLICATION_B_ENDPOINT'=>'http://127.0.0.1:4900',
        'PB3_REPLICATION_B_BUCKET'=>'pb3-replication-234-b',
    ] as $name=>$expected) {
        if (getenv($name)!==$expected) {
            throw new RuntimeException('replication234.race_refuse_environment: '.$name);
        }
    }
    foreach ([
        'S3_ACCESS_KEY','S3_SECRET_KEY',
        'PB3_REPLICATION_B_ACCESS_KEY','PB3_REPLICATION_B_SECRET_KEY',
    ] as $name) {
        race234Must(strlen((string)getenv($name))>=10,'no_disposable_s3_credentials');
    }
    race234Must(!hash_equals(
        (string)getenv('S3_ACCESS_KEY'),
        (string)getenv('PB3_REPLICATION_B_ACCESS_KEY')
    ),'identical_provider_credentials');
    $temp=getenv('RUNNER_TEMP');
    race234Must(is_string($temp)&&$temp!==''&&is_dir($temp),
        'missing_actions_runner_temp');
    $dir=$temp.'/pb3-replication-234-race';
    race234Must(!is_link($dir),'symlinked_fixture_directory');
    if (!is_dir($dir)) {
        race234Must(mkdir($dir,0700),'could_not_create_private_fixture_dir');
    }
    race234Must(realpath($dir)===realpath($temp).'/pb3-replication-234-race',
        'untrusted_fixture_directory');
    return $dir;
}
$dir=race234Guard();
require dirname(__DIR__,2).'/vendor/autoload.php';
$app=require dirname(__DIR__,2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
set_exception_handler(static function(Throwable $failure):void {
    $s=$failure->getMessage();
    $safe=str_starts_with($s,'replication234.')
        ||str_starts_with($s,'replication.')
        ?$s:get_class($failure);
    fwrite(STDERR,"P4 #234 TWO PHP RACE FAILURE: ".$safe."\n");
    exit(2);
});
race234Must(
    config('database.default')==='pgsql'
    && config('database.connections.pgsql.database')==='pb3_replication_234'
    && config('filesystems.disks.ciphertext.endpoint')==='http://127.0.0.1:3900'
    && config('filesystems.disks.ciphertext.bucket')==='pb3-replication-234-a',
    'unexpected_database_or_source_disk'
);
$version=DB::selectOne("SELECT current_setting('server_version_num')::integer AS v");
race234Must((int)$version->v>=180000 && (int)$version->v<190000,
    'requires_actual_postgresql18');

final class Race234SecondRealGarage implements StorageAdapter
{
    private S3Client $s3;
    private string $bucket;
    private string $log;

    public function __construct(string $dir)
    {
        $this->log=$dir.'/physical-put-attempts.log';
        $this->bucket=(string)getenv('PB3_REPLICATION_B_BUCKET');
        $this->s3=new S3Client([
            'version'=>'latest',
            'region'=>'garage',
            'endpoint'=>(string)getenv('PB3_REPLICATION_B_ENDPOINT'),
            'use_path_style_endpoint'=>true,
            'credentials'=>[
                'key'=>(string)getenv('PB3_REPLICATION_B_ACCESS_KEY'),
                'secret'=>(string)getenv('PB3_REPLICATION_B_SECRET_KEY'),
            ],
            'retries'=>0,
            'http'=>['connect_timeout'=>2,'timeout'=>5],
        ]);
    }
    public function putStream(string $objectKey,mixed $stream):bool
    {
        // Counts genuinely attempted second-S3 PUTs from ALL PHP OS workers,
        // serialized via kernel flock; no object keys or credentials logged.
        race234Must(file_put_contents($this->log,"P\n",FILE_APPEND|LOCK_EX)!==false,
            'cannot_record_physical_put_attempt');
        $this->s3->putObject([
            'Bucket'=>$this->bucket,'Key'=>$objectKey,'Body'=>$stream,
        ]);
        return true;
    }
    public function seedPhysicalFixture(string $key,string $cipher):void
    {
        // Intentional test-only pre-existing ciphertext (lost-ACK fixture).
        // NOT through the coordinator and NOT counted as a duplicate worker PUT.
        $this->s3->putObject([
            'Bucket'=>$this->bucket,'Key'=>$key,'Body'=>$cipher,
        ]);
    }
    public function readStream(string $key):mixed
    {
        $result=$this->s3->getObject(['Bucket'=>$this->bucket,'Key'=>$key]);
        $bytes=(string)$result['Body']; // <8 KiB random synthetic bytes only.
        $stream=fopen('php://temp','w+b');
        race234Must(is_resource($stream)&&fwrite($stream,$bytes)===strlen($bytes),
            'secondary_cipher_buffer_failed');
        rewind($stream);
        return $stream;
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
        $result=$this->s3->headObject(['Bucket'=>$this->bucket,'Key'=>$key]);
        return (int)$result['ContentLength'];
    }
    public function delete(string $key):bool
    {
        throw new RuntimeException('replication234.race_no_physical_delete');
    }
}

function race234Coordinator(string $dir):CiphertextReplicaCoordinator
{
    return new CiphertextReplicaCoordinator([
        'app_s3'=>[
            'adapter'=>new AppS3Adapter(),
            'failureDomain'=>'garage-node-a-3900',
            'credentialRevision'=>1,
        ],
        'replica_s3'=>[
            'adapter'=>new Race234SecondRealGarage($dir),
            'failureDomain'=>'garage-node-b-4900',
            'credentialRevision'=>1,
        ],
    ]);
}

function race234Identity(CarbonImmutable $now):array
{
    $account=(string)Str::uuid();
    $device=(string)Str::uuid();
    DB::table('identity_accounts')->insert([
        'id'=>$account,
        'operation_id'=>(string)Str::uuid(),
        'prepare_hash'=>str_repeat('a',64),
        'status'=>'ready',
        'reserved_until'=>$now->addDay(),
        'created_at'=>$now,
        'updated_at'=>$now,
    ]);
    DB::table('identity_devices')->insert([
        'id'=>$device,'account_id'=>$account,
        'signing_spki'=>'synthetic-two-worker-qa',
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    return ['account'=>$account,'device'=>$device];
}

function race234Seed(
    string $kind,array $who,string $cipher,CarbonImmutable $now
):array {
    $parent=(string)Str::uuid();
    $asset=(string)Str::uuid();
    $source=(string)Str::uuid();
    $target=(string)Str::uuid();
    $sha=hash('sha256',$cipher);
    $sourceKey='cipher/p4-234-race/'.$parent.'/'.$source;
    $targetKey='cipher/p4-234-race/'.$parent.'/'.$target;
    if ($kind==='photo') {
        DB::table('photo_records')->insert([
            'id'=>$parent,'account_id'=>$who['account'],
            'device_id'=>$who['device'],
            'operation_id'=>(string)Str::uuid(),
            'state'=>'active','expires_at'=>$now->addDay()->getTimestampMs(),
            'contract_hash'=>str_repeat('a',64),'contract_json'=>'{}',
            'signature'=>'synthetic',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('photo_objects')->insert([
            'id'=>$asset,'photo_id'=>$parent,'kind'=>'master','revision'=>1,
            'bytes'=>strlen($cipher),'sha256'=>$sha,'manifest_json'=>'{}',
            'object_key'=>$sourceKey,'state'=>'active',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        $table='storage_locations';$fk='asset_id';
    } elseif ($kind==='media_chunk') {
        DB::table('media_files_v1')->insert([
            'id'=>$parent,'account_id'=>$who['account'],
            'device_id'=>$who['device'],
            'operation_id'=>(string)Str::uuid(),
            'media_type'=>'video','state'=>'active',
            'expires_at'=>$now->addDay()->getTimestampMs(),
            'plain_bytes'=>128,'cipher_bytes'=>strlen($cipher),
            'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}',
            'signature'=>'synthetic',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('media_chunks_v1')->insert([
            'id'=>$asset,'media_id'=>$parent,'chunk_index'=>0,'kind'=>'data',
            'plain_bytes'=>128,'bytes'=>strlen($cipher),
            'sha256'=>$sha,'iv'=>'synthetic-iv','state'=>'active',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        $table='media_chunk_locations_v1';$fk='chunk_id';
    } else {
        throw new RuntimeException('replication234.race_unknown_asset_kind');
    }
    foreach ([
        [$source,'app_s3',$sourceKey,'verified'],
        [$target,'replica_s3',$targetKey,'reserved'],
    ] as [$id,$provider,$key,$state]) {
        DB::table($table)->insert([
            'id'=>$id,$fk=>$asset,'provider'=>$provider,
            'object_key'=>$key,'sha256'=>$sha,
            'bytes'=>strlen($cipher),'state'=>$state,
            'created_at'=>$now,'updated_at'=>$now,
        ]);
    }
    $handle=fopen('php://temp','w+b');
    race234Must(is_resource($handle),'cannot_open_primary_fixture_stream');
    race234Must(fwrite($handle,$cipher)===strlen($cipher),
        'cannot_seed_primary_fixture_stream');
    rewind($handle);
    race234Must((new AppS3Adapter())->putStream($sourceKey,$handle),
        'cannot_seed_primary_real_garage');
    fclose($handle);
    return [
        'kind'=>$kind,'account'=>$who['account'],
        'asset'=>$asset,'parent'=>$parent,
        'source'=>$source,'target'=>$target,
        'sourceKey'=>$sourceKey,'targetKey'=>$targetKey,
        'sha'=>$sha,'bytes'=>strlen($cipher),
        'table'=>$table,
    ];
}
function race234Verify(
    StorageAdapter $transport,string $key,int $bytes,string $sha
):void {
    race234Must($transport->exists($key)
        && $transport->size($key)===$bytes,
        'physical_head_mismatch');
    $in=$transport->readStream($key);
    race234Must(is_resource($in),'physical_get_failed');
    try {
        $ctx=hash_init('sha256');
        $count=hash_update_stream($ctx,$in);
        race234Must($count===$bytes
            && hash_equals($sha,hash_final($ctx)),
            'physical_ciphertext_sha_mismatch');
    } finally {
        fclose($in);
    }
}
function race234PutCount(string $dir):int
{
    $path=$dir.'/physical-put-attempts.log';
    if (!is_file($path)) return 0;
    $entries=file($path,FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES);
    race234Must(is_array($entries),'cannot_read_put_audit');
    foreach ($entries as $entry) {
        race234Must($entry==='P','unexpected_put_audit_format');
    }
    return count($entries);
}
function race234JsonFile(string $file,array $value):void
{
    race234Must(file_put_contents(
        $file,json_encode($value,JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES),
        LOCK_EX)!==false,'cannot_write_private_worker_result');
    @chmod($file,0600);
}
function race234WaitFile(string $file,int $maxMs=18000):void
{
    $start=microtime(true);
    while (!is_file($file)) {
        if ((microtime(true)-$start)*1000>$maxMs) {
            throw new RuntimeException('replication234.race_timeout');
        }
        usleep(35000);
    }
}

/** Each child independently boots Laravel, has its OWN PHP and PG PID. */
function race234Worker(string $dir,array $args):never
{
    race234Must(count($args)===3,'worker_argument_count');
    [$jobId,$result,$ready]=$args;
    race234Must(Str::isUuid($jobId)
        && str_starts_with($result,$dir.'/')
        && str_starts_with($ready,$dir.'/')
        && !str_contains($result,'..')
        && !str_contains($ready,'..'),
        'invalid_worker_arguments');

    $pid=DB::selectOne('SELECT pg_backend_pid() AS pid');
    race234JsonFile($ready,[
        'phpPid'=>getmypid(),
        'pgPid'=>(int)$pid->pid,
    ]);
    $status=race234Coordinator($dir)->process(
        $jobId,CarbonImmutable::now('UTC'));
    race234Must(($status['liveReplicaActivated']??null)===false,
        'worker_claimed_live_activation');
    race234JsonFile($result,[
        'phpPid'=>getmypid(),
        'pgPid'=>(int)$pid->pid,
        'state'=>$status['state'],
        'attempts'=>$status['attempts'],
        'transferVerified'=>$status['transferVerified'],
    ]);
    exit(0);
}

/** @return array{proc:resource,ready:string,result:string} */
function race234Spawn(
    string $dir,string $jobId,string $name
):array {
    $ready=$dir.'/'.$name.'.ready.json';
    $result=$dir.'/'.$name.'.result.json';
    @unlink($ready);@unlink($result);
    $pipes=[];
    $process=proc_open([
        PHP_BINARY,__FILE__,'worker',$jobId,$result,$ready,
    ],[
        0=>['pipe','r'],
        1=>['file',$dir.'/'.$name.'.stdout','w'],
        2=>['file',$dir.'/'.$name.'.stderr','w'],
    ],$pipes,dirname(__DIR__,2),null,['bypass_shell'=>true]);
    race234Must(is_resource($process),'cannot_spawn_independent_php');
    fclose($pipes[0]);
    return ['proc'=>$process,'ready'=>$ready,'result'=>$result];
}

function race234BothPgWait(int $pidA,int $pidB):array
{
    $since=microtime(true);
    $last=[];
    do {
        // PG caches stats snapshots inside the holder's open transaction;
        // each iteration MUST discard its previous activity snapshot.
        DB::select('SELECT pg_stat_clear_snapshot()');
        $rows=DB::select(
            'SELECT pid, state, wait_event_type, wait_event FROM pg_stat_activity WHERE pid IN (?, ?)',
            [$pidA,$pidB]
        );
        $blocked=[];
        $last=[];
        foreach ($rows as $row) {
            $last[]=(string)$row->state.'/'
                .(string)($row->wait_event_type??'none').'/'
                .(string)($row->wait_event??'none');
            if ($row->state==='active' && $row->wait_event_type==='Lock') {
                $blocked[(int)$row->pid]=(string)$row->wait_event;
            }
        }
        if (isset($blocked[$pidA],$blocked[$pidB])) {
            return ['bothBlocked'=>true,'pgA'=>$pidA,'pgB'=>$pidB];
        }
        usleep(35000);
    } while ((microtime(true)-$since)*1000<15000);
    throw new RuntimeException(
        'replication234.race_both_pg_lock_waits_not_observed_'
        .implode('_',$last));
}
function race234Contend(string $dir,array $fixture,string $jobId,string $label):array
{
    $children=[];
    $held=false;
    try {
        DB::beginTransaction();
        $held=true;
        $account=DB::table('identity_accounts')
            ->where('id',$fixture['account'])
            ->where('status','ready')
            ->lockForUpdate()->first();
        race234Must($account!==null,'synthetic_account_missing');
        $children[] = race234Spawn($dir,$jobId,$label.'-a');
        $children[] = race234Spawn($dir,$jobId,$label.'-b');
        race234WaitFile($children[0]['ready']);
        race234WaitFile($children[1]['ready']);
        $a=json_decode(
            (string)file_get_contents($children[0]['ready']),
            true,8,JSON_THROW_ON_ERROR);
        $b=json_decode(
            (string)file_get_contents($children[1]['ready']),
            true,8,JSON_THROW_ON_ERROR);
        race234Must(
            $a['phpPid']!==$b['phpPid']
            && $a['pgPid']!==$b['pgPid']
            && $a['phpPid']!==getmypid(),
            'not_independent_php_and_postgresql_workers');
        $evidence=race234BothPgWait($a['pgPid'],$b['pgPid']);
        // Two actual backend Locks observed BEFORE releasing the parent.
        DB::commit();
        $held=false;

        $responses=[];
        foreach ($children as $child) {
            race234WaitFile($child['result']);
            $responses[]=json_decode(
                (string)file_get_contents($child['result']),
                true,16,JSON_THROW_ON_ERROR);
        }
        foreach ($children as $child) {
            race234Must(proc_close($child['proc'])===0,
                'php_worker_did_not_exit_successfully');
        }
        $children=[];
        return ['evidence'=>$evidence,'workers'=>$responses];
    } finally {
        if ($held) DB::rollBack();
        foreach ($children as $child) {
            if (is_resource($child['proc'])) {
                @proc_terminate($child['proc']);
                @proc_close($child['proc']);
            }
        }
    }
}

if (($argv[1]??'')==='worker') {
    race234Worker($dir,array_slice($argv,2));
}
race234Must(count($argv)===1,'parent_argument_count');
$now=CarbonImmutable::now('UTC');
$who=race234Identity($now);
$original=new AppS3Adapter();
$second=new Race234SecondRealGarage($dir);
$service=race234Coordinator($dir);

// FIRST: Two true OS workers contend on one queued Photo job. Only ONE
// successful real remote PUT and ONE lease/ACK generation is possible.
$photoBytes=random_bytes(4096);
$photo=race234Seed('photo',$who,$photoBytes,$now);
$job=$service->enqueue(
    $photo['account'],'photo',$photo['asset'],
    $photo['source'],$photo['target'],
    'replication-234-process-race-photo',$now);
race234Must($job['state']==='queued'
    && DB::table('ciphertext_replication_jobs_v1')
        ->where('id',$job['jobId'])->value('attempts')===0,
    'first_job_not_queued');
$before=race234PutCount($dir);
race234Must($before===0,'nonempty_put_audit_before_race');
$one=race234Contend($dir,$photo,$job['jobId'],'photo');
$states=array_column($one['workers'],'state');
race234Must(
    !array_diff($states,['verified','leased'])
    && in_array('verified',$states,true),
    'two_workers_did_not_return_safe_lease_outcomes');
race234Must(race234PutCount($dir)===$before+1,
    'two_workers_issued_duplicate_physical_puts');
$ack=DB::table('ciphertext_replication_jobs_v1')
    ->where('id',$job['jobId'])->first();
race234Must($ack!==null && $ack->state==='verified'
    && (int)$ack->attempts===1
    && $ack->lease_sha256===null,
    'not_one_durable_attempt_and_one_verified_ack');
race234Verify($original,$photo['sourceKey'],$photo['bytes'],$photo['sha']);
race234Verify($second,$photo['targetKey'],$photo['bytes'],$photo['sha']);
race234Must(DB::table($photo['table'])
    ->where('id',$photo['target'])->value('state')==='verified',
    'photo_target_row_not_verified');
echo "P4 #234 REAL PG18 TWO-PHP RACE 1/2 PASS: two distinct PHP/Pg backends BOTH observed waiting on Lock; one leased/ACKed attempt, EXACTLY ONE real Garage B PUT and full GET SHA\n";

// SECOND: Physically correct target already EXISTS but DB has no ACK.
// Both contenders physically GET+hash; neither performs another PUT.
$mediaBytes=random_bytes(6144);
$media=race234Seed('media_chunk',$who,$mediaBytes,$now);
$second->seedPhysicalFixture($media['targetKey'],$mediaBytes);
race234Verify($second,$media['targetKey'],$media['bytes'],$media['sha']);
$lost=$service->enqueue(
    $media['account'],'media_chunk',$media['asset'],
    $media['source'],$media['target'],
    'replication-234-process-race-media',$now);
race234Must($lost['state']==='queued','lost_ack_job_not_queued');
$putBeforeLost=race234PutCount($dir);
$two=race234Contend($dir,$media,$lost['jobId'],'media');
$states=array_column($two['workers'],'state');
race234Must(!array_diff($states,['verified','leased'])
    && in_array('verified',$states,true),
    'lost_ack_two_workers_not_safe');
race234Must(race234PutCount($dir)===$putBeforeLost,
    'duplicate_put_after_physical_lost_ack');
$record=DB::table('ciphertext_replication_jobs_v1')
    ->where('id',$lost['jobId'])->first();
race234Must($record!==null && $record->state==='verified'
    && (int)$record->attempts===1,
    'lost_ack_job_not_exactly_one_verified_attempt');
race234Verify($original,$media['sourceKey'],$media['bytes'],$media['sha']);
race234Verify($second,$media['targetKey'],$media['bytes'],$media['sha']);
race234Must(DB::table($media['table'])
    ->where('id',$media['target'])->value('state')==='verified',
    'lost_ack_location_not_verified');
echo "P4 #234 REAL PG18 TWO-PHP RACE 2/2 PASS: two different Pg Lock waiters, already present true S3 ciphertext GET+SHA, ZERO new Garage B PUTs, ONE durable ACK\n";

race234Must(DB::table('ciphertext_replication_jobs_v1')
    ->whereIn('id',[$job['jobId'],$lost['jobId']])
    ->where('state','verified')->count()===2,
    'durable_history_or_acks_missing');
race234Must(DB::table('storage_locations')
    ->where('id',$photo['source'])->where('state','verified')->exists()
    && DB::table('media_chunk_locations_v1')
        ->where('id',$media['source'])->where('state','verified')->exists(),
    'original_location_was_changed');
echo "P4 #234 REAL PG18 TWO-PHP RACE COMPLETE 2/2: genuine Garage S3 ciphertext verified, immutable originals, no duplicate remote PUT and no fake ACK; NOT production secondary S3\n";
