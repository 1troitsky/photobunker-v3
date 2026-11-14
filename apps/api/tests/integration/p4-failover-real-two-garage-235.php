<?php
declare(strict_types=1);

/**
 * #235 isolated, real two-Garage 2.5 physical read-failover QA.
 * Synthetic bytes on independently created A/B buckets; PostgreSQL18 metadata.
 * Tests primary physically stopped while read-only ReplicaReadPreflight verifies
 * real secondary GET+SHA, corrupt/missing/stale rejection, replica outage,
 * restart recovery. DOES NOT integrate StorageManager/live GET or switch.
 * Refuses to run outside a disposable Actions runner fixture.
 */

use App\Storage\AppS3Adapter;
use App\Storage\Failover\ReplicaReadPreflight;
use App\Storage\StorageAdapter;
use Aws\S3\S3Client;
use Aws\S3\Exception\S3Exception;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function failoverRequireIsolated(): void
{
    foreach ([
        'GITHUB_ACTIONS'=>'true',
        'PB3_FAILOVER_REAL_GARAGE_CI'=>'1',
        'APP_ENV'=>'testing',
        'DB_CONNECTION'=>'pgsql',
        'DB_HOST'=>'127.0.0.1',
        'DB_PORT'=>'5432',
        'DB_DATABASE'=>'pb3_failover_235',
        'DB_USERNAME'=>'pb3_failover',
        'S3_ENDPOINT'=>'http://127.0.0.1:3900',
        'S3_REGION'=>'garage',
        'S3_BUCKET'=>'pb3-failover-235-a',
        'PB3_FAILOVER_B_ENDPOINT'=>'http://127.0.0.1:4900',
        'PB3_FAILOVER_B_BUCKET'=>'pb3-failover-235-b',
    ] as $key=>$value) {
        if (getenv($key) !== $value) {
            throw new RuntimeException('p4.failover.refuse_non_ci_fixture: '.$key);
        }
    }
    $file=getenv('PB3_FAILOVER_FIXTURE_PATH');
    $temp=getenv('RUNNER_TEMP');
    if (!is_string($file)||!is_string($temp)
        ||!str_starts_with($file,$temp.'/pb3-failover-235-')
        ||str_contains($file,'..')
        ||!preg_match('~^/[^[:space:]]+\.json$~D',$file)) {
        throw new RuntimeException('p4.failover.refuse_fixture_path');
    }
    foreach (['S3_ACCESS_KEY','S3_SECRET_KEY',
        'PB3_FAILOVER_B_ACCESS_KEY','PB3_FAILOVER_B_SECRET_KEY'] as $key) {
        if (!is_string(getenv($key)) || strlen((string)getenv($key))<10) {
            throw new RuntimeException('p4.failover.missing_disposable_credential');
        }
    }
    if (hash_equals((string)getenv('S3_ACCESS_KEY'),
            (string)getenv('PB3_FAILOVER_B_ACCESS_KEY'))) {
        throw new RuntimeException('p4.failover.identical_s3_keys');
    }
}
failoverRequireIsolated();
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app=require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

function failoverAssert(bool $ok,string $name):void
{
    if (!$ok) throw new RuntimeException('p4.failover.qa_failed: '.$name);
}
failoverAssert(config('database.default')==='pgsql'
    && config('database.connections.pgsql.database')==='pb3_failover_235'
    && config('filesystems.disks.ciphertext.endpoint')==='http://127.0.0.1:3900'
    && config('filesystems.disks.ciphertext.bucket')==='pb3-failover-235-a',
    'configuration_is_not_ci');
$version=DB::selectOne("select current_setting('server_version_num')::integer as number");
failoverAssert((int)$version->number >= 180000
    && (int)$version->number < 190000, 'wrong_postgres_version');

final class IsolatedSecondGarage implements StorageAdapter
{
    private S3Client $s3;
    private string $bucket;
    /** Inject a second independent PHP/PG18 process after physical readback before final DB snapshot. */
    public ?\Closure $onRead=null;

    public function __construct(string $endpoint,string $bucket,string $key,string $secret)
    {
        $this->bucket=$bucket;
        $this->s3=new S3Client([
            'version'=>'latest','region'=>'garage',
            'endpoint'=>$endpoint,'use_path_style_endpoint'=>true,
            'credentials'=>['key'=>$key,'secret'=>$secret],
            'retries'=>0, 'http'=>['connect_timeout'=>2,'timeout'=>5],
        ]);
    }

    public function putStream(string $objectKey,mixed $stream):bool
    {
        $this->s3->putObject(['Bucket'=>$this->bucket,
            'Key'=>$objectKey,'Body'=>$stream]);
        return true;
    }

    public function readStream(string $objectKey):mixed
    {
        $result=$this->s3->getObject(['Bucket'=>$this->bucket,'Key'=>$objectKey]);
        $body=(string)$result['Body']; // Small synthetic fixture only.
        // Inject the independent COMMITTED PG mutation after real S3 GET
        // but before inspect() performs its second DB snapshot.
        if ($this->onRead!==null) {
            $hook=$this->onRead;
            $this->onRead=null;
            $hook();
        }
        $stream=fopen('php://temp','w+b');
        if (!is_resource($stream) || fwrite($stream,$body)!==strlen($body)) {
            throw new RuntimeException('p4.failover.synthetic_stream_failed');
        }
        rewind($stream);
        return $stream;
    }

    public function exists(string $objectKey):bool
    {
        try {
            $this->s3->headObject(['Bucket'=>$this->bucket,'Key'=>$objectKey]);
            return true;
        } catch (S3Exception $e) {
            if ($e->getStatusCode()===404) return false;
            throw $e;
        }
    }

    public function size(string $objectKey):int
    {
        $result=$this->s3->headObject(['Bucket'=>$this->bucket,'Key'=>$objectKey]);
        return (int)$result['ContentLength'];
    }

    public function delete(string $objectKey):bool
    {
        $this->s3->deleteObject(['Bucket'=>$this->bucket,'Key'=>$objectKey]);
        return !$this->exists($objectKey);
    }
}

/** @return array{0:AppS3Adapter,1:IsolatedSecondGarage,2:ReplicaReadPreflight} */
function failoverTransports():array
{
    $a=new AppS3Adapter();
    $b=new IsolatedSecondGarage(
        (string)getenv('PB3_FAILOVER_B_ENDPOINT'),
        (string)getenv('PB3_FAILOVER_B_BUCKET'),
        (string)getenv('PB3_FAILOVER_B_ACCESS_KEY'),
        (string)getenv('PB3_FAILOVER_B_SECRET_KEY'),
    );
    $service=new ReplicaReadPreflight([
        'app_s3'=>[
            'adapter'=>$a,
            'failureDomain'=>'garage-node-a-3900',
            'credentialRevision'=>1,
        ],
        'user_s3'=>[
            'adapter'=>$b,
            'failureDomain'=>'garage-node-b-4900',
            'credentialRevision'=>1,
        ],
    ]);
    return [$a,$b,$service];
}

/** @param array<string,mixed> $f */
function failoverTest(object $service,array $f):array
{
    $result=$service->inspect($f['account'],$f['kind'],$f['asset'],
        $f['source'],$f['target'],CarbonImmutable::now('UTC'));
    failoverAssert($result['status']==='replica_physical_preflight_only'
        && $result['physicallyVerified']===true
        && $result['failoverAuthorized']===false
        && $result['ciphertextSha256']===$f['sha']
        && $result['ciphertextBytes']===$f['bytes'],
        $f['kind'].'_physical_secondary_sha_or_inert_response');
    return $result;
}

function failoverDeny(callable $fn,string $expected):void
{
    try {
        $fn();
    } catch (RuntimeException $e) {
        failoverAssert($e->getMessage()===$expected,'incorrect_failure_boundary');
        return;
    }
    throw new RuntimeException('p4.failover.qa_failed: unexpectedly_accepted');
}

/** @return array<string,mixed> */
function failoverInsertFixture(string $kind,string $account,string $device,string $bytes):array
{
    $now=CarbonImmutable::now('UTC');
    $parent=(string)Str::uuid();
    $asset=(string)Str::uuid();
    $source=(string)Str::uuid();
    $target=(string)Str::uuid();
    $sha=hash('sha256',$bytes);
    $sourceKey='cipher/p4-failover-235/'.$account.'/'.$parent.'/'.$source;
    $targetKey='cipher/p4-failover-235/'.$account.'/'.$parent.'/'.$target;
    if ($kind==='photo') {
        DB::table('photo_records')->insert([
            'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
            'operation_id'=>(string)Str::uuid(),'state'=>'active',
            'expires_at'=>$now->addDay()->getTimestampMs(),
            'contract_hash'=>str_repeat('a',64),'contract_json'=>'{}',
            'signature'=>'synthetic','created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('photo_objects')->insert([
            'id'=>$asset,'photo_id'=>$parent,'kind'=>'master','revision'=>1,
            'bytes'=>strlen($bytes),'sha256'=>$sha,'manifest_json'=>'{}',
            'object_key'=>$sourceKey,'state'=>'active',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        $locations='storage_locations';$fk='asset_id';
    } elseif ($kind==='media_chunk') {
        DB::table('media_files_v1')->insert([
            'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
            'operation_id'=>(string)Str::uuid(),'media_type'=>'video',
            'state'=>'active','expires_at'=>$now->addDay()->getTimestampMs(),
            'plain_bytes'=>128,'cipher_bytes'=>strlen($bytes),
            'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}',
            'signature'=>'synthetic','created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('media_chunks_v1')->insert([
            'id'=>$asset,'media_id'=>$parent,'chunk_index'=>0,
            'kind'=>'data','plain_bytes'=>128,'bytes'=>strlen($bytes),
            'sha256'=>$sha,'iv'=>'synthetic-iv','state'=>'active',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        $locations='media_chunk_locations_v1';$fk='chunk_id';
    } else {
        throw new RuntimeException('p4.failover.unknown_fixture_kind');
    }
    foreach ([
        [$source,'app_s3',$sourceKey],
        [$target,'user_s3',$targetKey],
    ] as [$id,$provider,$key]) {
        DB::table($locations)->insert([
            'id'=>$id,$fk=>$asset,'provider'=>$provider,
            'object_key'=>$key,'sha256'=>$sha,'bytes'=>strlen($bytes),
            'state'=>'verified','created_at'=>$now,'updated_at'=>$now,
        ]);
    }
    return [
        'kind'=>$kind,'account'=>$account,'parent'=>$parent,
        'asset'=>$asset,'source'=>$source,'target'=>$target,
        'sourceKey'=>$sourceKey,'targetKey'=>$targetKey,
        'sha'=>$sha,'bytes'=>strlen($bytes),'locations'=>$locations,
    ];
}

/** @param array<string,mixed> $f */
function failoverVerifyOriginal(AppS3Adapter $a,array $f):void
{
    failoverAssert($a->exists($f['sourceKey'])
        && $a->size($f['sourceKey'])===$f['bytes'],
        'original_source_missing');
    $stream=$a->readStream($f['sourceKey']);
    failoverAssert(is_resource($stream),'original_source_unreadable');
    $hash=hash_init('sha256');
    $size=hash_update_stream($hash,$stream);
    fclose($stream);
    failoverAssert($size===$f['bytes']
        && hash_equals($f['sha'],hash_final($hash)),
        'original_source_sha_mismatch');
}

/** @return array<string,mixed> */
function failoverLoadFixture():array
{
    $file=(string)getenv('PB3_FAILOVER_FIXTURE_PATH');
    failoverAssert(is_file($file),'no_seed_fixture');
    $data=json_decode((string)file_get_contents($file),true,32,JSON_THROW_ON_ERROR);
    failoverAssert(is_array($data)&&count($data)===2,
        'invalid_seed_fixture');
    foreach ($data as $kind=>$f) {
        failoverAssert(in_array($kind,['photo','media_chunk'],true)
            && is_array($f) && ($f['kind']??null)===$kind
            && Str::isUuid($f['account']??'')
            && Str::isUuid($f['asset']??'')
            && Str::isUuid($f['source']??'')
            && Str::isUuid($f['target']??'')
            && preg_match('/^[0-9a-f]{64}$/D',$f['sha']??'')===1,
            'invalid_saved_fixture');
    }
    return $data;
}


/**
 * Invariant: independent PostgreSQL backends AND independent Linux PHP PIDs.
 * Worker mutates only disposable fixture metadata, never production rows/S3.
 * This is a deterministic between-read race, not a proof of a writer lock.
 *
 * @param array<string,mixed> $fixture
 */
function failoverConcurrentPgMutation(string $action,array $fixture):void
{
    failoverAssert(in_array($action,['account-revision','parent-deletion'],true),
        'unsupported_race_mutation');
    $parentOs=(int)getmypid();
    $parentPg=(int)DB::selectOne('SELECT pg_backend_pid() as pid')->pid;
    $cmd=[PHP_BINARY,__FILE__,'race-worker',$action,
        $fixture['account'],$fixture['parent'],
        (string)$parentOs,(string)$parentPg];
    $pipes=[];
    $process=proc_open($cmd,[
        0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w'],
    ],$pipes);
    failoverAssert(is_resource($process),'cannot_spawn_separate_php_worker');
    fclose($pipes[0]);
    $stdout=(string)stream_get_contents($pipes[1]);
    $stderr=(string)stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $status=proc_close($process);
    // Do not echo STDERR; it could contain connection/config context.
    failoverAssert($status===0 && $stderr==='',
        'separate_php_worker_unexpected_failure');
    failoverAssert(preg_match(
        '/^RACE_WORKER_ACK:([a-z-]+):([0-9]+):([0-9]+)\n$/D',
        $stdout,$m)===1,
        'worker_ack_unconfirmed');
    failoverAssert($m[1]===$action
        && (int)$m[2]>0 && (int)$m[2]!==$parentOs
        && (int)$m[3]>0 && (int)$m[3]!==$parentPg,
        'worker_not_independent_os_and_pg_process');
}

$mode=$argv[1]??'';
failoverAssert(in_array($mode,[
    'healthy','race','race-worker','primary-offline','secondary-offline','recovered'
],true),'unknown_test_mode');

// Child process must pass all disposable-GitHub-Action guards above.
// It can only alter two exact rows from the already seeded fixture file.
if ($mode==='race-worker') {
    failoverAssert(count($argv)===7,'unexpected_worker_argument_count');
    [$script,$run,$action,$account,$parent,$parentOs,$parentPg]=$argv;
    failoverAssert(in_array($action,['account-revision','parent-deletion'],true)
        && Str::isUuid($account) && Str::isUuid($parent)
        && ctype_digit($parentOs) && ctype_digit($parentPg),
        'invalid_race_worker_identity');
    $fixtures=failoverLoadFixture();
    $f=$fixtures['photo'];
    failoverAssert($f['account']===$account && $f['parent']===$parent,
        'race_worker_not_fixture_owned');
    $pid=(int)getmypid();
    $pgpid=(int)DB::selectOne('SELECT pg_backend_pid() as pid')->pid;
    failoverAssert($pid!==(int)$parentOs && $pgpid!==(int)$parentPg,
        'worker_not_independent_process');
    if ($action==='account-revision') {
        $affected=DB::table('identity_accounts')
            ->where('id',$account)->where('status','ready')
            ->increment('revision');
    } else {
        $affected=DB::table('photo_records')
            ->where('id',$parent)->where('account_id',$account)
            ->where('state','active')
            ->update(['state'=>'deleting','updated_at'=>CarbonImmutable::now('UTC')]);
    }
    failoverAssert($affected===1,'expected_one_fixture_row_changed');
    echo "RACE_WORKER_ACK:$action:$pid:$pgpid\n";
    exit(0);
}
failoverAssert(count($argv)===2,'unexpected_test_mode_arguments');
[$primary,$secondary,$preflight]=failoverTransports();

if ($mode==='healthy') {
    $account=(string)Str::uuid();
    $device=(string)Str::uuid();
    $now=CarbonImmutable::now('UTC');
    DB::table('identity_accounts')->insert([
        'id'=>$account,'operation_id'=>(string)Str::uuid(),
        'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
        'reserved_until'=>$now->addDay(),
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    DB::table('identity_devices')->insert([
        'id'=>$device,'account_id'=>$account,
        'signing_spki'=>'synthetic-failover-garage-test',
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    $fixtures=[];
    foreach (['photo','media_chunk'] as $kind) {
        // Synthetic ciphertext-like bytes are never user media/plaintext.
        $cipher=random_bytes($kind==='photo'?4096:8192);
        $f=failoverInsertFixture($kind,$account,$device,$cipher);
        $source=fopen('php://temp','w+b');
        fwrite($source,$cipher);rewind($source);
        failoverAssert($primary->putStream($f['sourceKey'],$source),
            'source_fixture_put_failed');
        fclose($source);
        $target=fopen('php://temp','w+b');
        fwrite($target,$cipher);rewind($target);
        failoverAssert($secondary->putStream($f['targetKey'],$target),
            'target_fixture_put_failed');
        fclose($target);
        failoverTest($preflight,$f);
        failoverVerifyOriginal($primary,$f);
        $fixtures[$kind]=$f;
    }
    echo "P4 #235 REAL GARAGE 1/7 PASS: two distinct Garage A/B ciphertext streams verified for Photo and Media; no switch\n";

    // Same-length corruption is not a valid failover source.
    $f=$fixtures['photo'];
    $changed=random_bytes((int)$f['bytes']);
    failoverAssert(hash('sha256',$changed)!==$f['sha'],'corruption_fixture_not_changed');
    $stream=fopen('php://temp','w+b');
    fwrite($stream,$changed);rewind($stream);
    failoverAssert($secondary->putStream($f['targetKey'],$stream),
        'corruption_fixture_put_failed');
    fclose($stream);
    failoverDeny(fn()=>failoverTest($preflight,$f),
        'failover.replica_read_unverified');
    failoverVerifyOriginal($primary,$f);
    echo "P4 #235 REAL GARAGE 2/7 PASS: same-size physically corrupted secondary rejected, original retained\n";

    failoverAssert($secondary->delete($f['targetKey']),
        'missing_fixture_delete_failed');
    failoverDeny(fn()=>failoverTest($preflight,$f),
        'failover.replica_read_unverified');
    failoverVerifyOriginal($primary,$f);
    echo "P4 #235 REAL GARAGE 3/7 PASS: physically missing secondary denied with live original intact\n";

    // Restore only disposable synthetic ciphertext on Garage B.
    $source=$primary->readStream($f['sourceKey']);
    failoverAssert(is_resource($source),'restore_source_missing');
    failoverAssert($secondary->putStream($f['targetKey'],$source),
        'restore_secondary_failed');
    fclose($source);
    failoverTest($preflight,$f);

    DB::table($f['locations'])->where('id',$f['target'])
        ->update(['state'=>'reserved']);
    failoverDeny(fn()=>failoverTest($preflight,$f),
        'failover.location_not_verified');
    DB::table($f['locations'])->where('id',$f['target'])
        ->update(['state'=>'verified']);
    failoverTest($preflight,$f);
    echo "P4 #235 REAL GARAGE 4/7 PASS: stale unverified DB replica state denied, verified state restored\n";

    // Only fixture metadata (no ciphertext bytes, keys or credentials) persists across separate CLI processes.
    $file=(string)getenv('PB3_FAILOVER_FIXTURE_PATH');
    failoverAssert(file_put_contents($file,json_encode($fixtures,
        JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),LOCK_EX)!==false,
        'cannot_persist_synthetic_fixture');
    chmod($file,0600);
    exit(0);
}

$fixtures=failoverLoadFixture();

if ($mode==='race') {
    $f=$fixtures['photo'];
    $initialRevision=(int)DB::table('identity_accounts')
        ->where('id',$f['account'])->value('revision');
    // Second OS process commits a READY->READY identity revision bump
    // after preflight's first DB snapshot and real Garage B GET.
    $secondary->onRead=static fn()=>failoverConcurrentPgMutation(
        'account-revision',$f);
    failoverDeny(fn()=>failoverTest($preflight,$f),
        'failover.changed_during_read');
    failoverAssert((int)DB::table('identity_accounts')
            ->where('id',$f['account'])->value('revision')===$initialRevision+1
        && DB::table('identity_accounts')->where('id',$f['account'])
            ->value('status')==='ready',
        'account_revision_not_really_committed');
    failoverTest($preflight,$f);
    echo "P4 #235 REAL PG18 RACE 1/2 PASS: separate OS-PHP+PG18 rotation between real Garage B GET and DB recheck fails closed while account remains READY\n";

    // Other process transitions Photo active->deleting after physical GET. Restore only
    // synthetic fixture metadata so subsequent outage/recovery QA stays valid.
    $secondary->onRead=static fn()=>failoverConcurrentPgMutation(
        'parent-deletion',$f);
    failoverDeny(fn()=>failoverTest($preflight,$f),
        'failover.asset_unavailable');
    failoverAssert(DB::table('photo_records')->where('id',$f['parent'])
        ->value('state')==='deleting','delete_not_committed');
    $changed=DB::table('photo_records')->where('id',$f['parent'])
        ->where('account_id',$f['account'])->where('state','deleting')
        ->update(['state'=>'active','updated_at'=>CarbonImmutable::now('UTC')]);
    failoverAssert($changed===1,'fixture_restore_not_confirmed');
    failoverTest($preflight,$f);
    failoverVerifyOriginal($primary,$f);
    echo "P4 #235 REAL PG18 RACE 2/2 PASS: separate OS-PHP+PG18 post-GET delete rejected; only synthetic fixture restored; Garage A intact\n";
    echo "P4 #235 REAL PG18 RACE COMPLETE 2/2: distinct PHP PIDs and PG18 backend IDs, NO placement switching\n";
    exit(0);
}

if ($mode==='primary-offline') {
    // CI stopped ONLY the disposable Garage A Docker container.
    // A network error must not be mislabeled as source content absence.
    $physicalPrimaryDown=false;
    try {
        $physicalPrimaryDown=!$primary->exists($fixtures['photo']['sourceKey']);
    } catch (Throwable) {
        $physicalPrimaryDown=true;
    }
    failoverAssert($physicalPrimaryDown,'primary_not_physically_stopped');
    foreach ($fixtures as $f) {
        failoverTest($preflight,$f);
        failoverAssert(DB::table($f['locations'])->where('id',$f['source'])
                ->value('state')==='verified'
            && DB::table($f['locations'])->where('id',$f['target'])
                ->value('state')==='verified',
            'primary_outage_modified_placement');
    }
    echo "P4 #235 REAL GARAGE 5/7 PASS: primary Garage A physically stopped, still verify Photo+Media ciphertext from actual Garage B without primary I/O or switch\n";
    exit(0);
}

if ($mode==='secondary-offline') {
    // CI has restarted Garage A and stopped ONLY disposable B.
    $targetUnavailable=false;
    try {
        $targetUnavailable=!$secondary->exists($fixtures['photo']['targetKey']);
    } catch (Throwable) {
        $targetUnavailable=true;
    }
    failoverAssert($targetUnavailable,'secondary_not_physically_stopped');
    foreach ($fixtures as $f) {
        failoverDeny(fn()=>failoverTest($preflight,$f),
            'failover.replica_read_unverified');
        failoverVerifyOriginal($primary,$f);
    }
    echo "P4 #235 REAL GARAGE 6/7 PASS: replica Garage B physically stopped, fail-closed; original Garage A SHA intact\n";
    exit(0);
}

foreach ($fixtures as $f) {
    failoverTest($preflight,$f);
    failoverVerifyOriginal($primary,$f);
    failoverAssert(DB::table($f['locations'])->where('id',$f['source'])
            ->value('state')==='verified'
        && DB::table($f['locations'])->where('id',$f['target'])
            ->value('state')==='verified',
        'unexpected_pointer_or_status_mutation');
}
failoverAssert(DB::table('storage_locations')
        ->where('asset_id',$fixtures['photo']['asset'])->count()===2
    && DB::table('media_chunk_locations_v1')
        ->where('chunk_id',$fixtures['media_chunk']['asset'])->count()===2,
    'original_placement_count_changed');
echo "P4 #235 REAL GARAGE 7/7 PASS: both Garage nodes recovered, physical SHA readback for Photo and Media, no pointer update\n";
echo "P4 #235 REAL GARAGE COMPLETE 7/7: isolated PostgreSQL18+two Garage2.5 nodes, NO live failover, no real user bytes\n";
@unlink((string)getenv('PB3_FAILOVER_FIXTURE_PATH'));
