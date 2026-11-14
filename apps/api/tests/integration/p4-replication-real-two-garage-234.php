<?php
declare(strict_types=1);

/**
 * #234: real physical ciphertext PUT/GET through TWO independent ephemeral
 * Garage v2.5 nodes with separately provisioned S3 accounts, ports, disks.
 * Actual AppS3Adapter -> Garage A; test-only AWS SDK adapter -> Garage B.
 *
 * Disposable synthetic bytes only. NO user data, plaintext, production BYO
 * credential, live backup, destruction, or deployment. This does not prove
 * geographically/administratively independent failure domains.
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

function replication234RequireIsolated(): void
{
    foreach ([
        'GITHUB_ACTIONS'=>'true',
        'PB3_REPLICATION_REAL_GARAGE_CI'=>'1',
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
    ] as $key=>$expected) {
        if (getenv($key)!==$expected) {
            throw new RuntimeException('replication.qa_refuse_environment: '.$key);
        }
    }
    $file=getenv('PB3_REPLICATION_FIXTURE_PATH');
    $temp=getenv('RUNNER_TEMP');
    if (!is_string($file)||!is_string($temp)
        || !str_starts_with($file,$temp.'/pb3-replication-234-')
        || str_contains($file,'..') || !str_ends_with($file,'.json')) {
        throw new RuntimeException('replication.qa_refuse_fixture_path');
    }
    foreach ([
        'S3_ACCESS_KEY','S3_SECRET_KEY',
        'PB3_REPLICATION_B_ACCESS_KEY','PB3_REPLICATION_B_SECRET_KEY',
    ] as $key) {
        if (strlen((string)getenv($key))<10) {
            throw new RuntimeException('replication.qa_no_disposable_s3_credentials');
        }
    }
    if (hash_equals((string)getenv('S3_ACCESS_KEY'),
        (string)getenv('PB3_REPLICATION_B_ACCESS_KEY'))) {
        throw new RuntimeException('replication.qa_duplicate_provider_key');
    }
}
replication234RequireIsolated();
require dirname(__DIR__,2).'/vendor/autoload.php';
$app=require dirname(__DIR__,2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
// Make an uncaught Laravel CLI exception an actual failed OS process.
set_exception_handler(static function(Throwable $e):void {
    $message=$e->getMessage();
    $safe=(str_starts_with($message,'replication.')||str_starts_with($message,'replication234.'))
        ?$message:get_class($e);
    fwrite(STDERR,"P4 #234 S3 E2E ERROR: ".$safe."\n");
    exit(2);
});

function replication234Must(bool $ok,string $reason): void
{
    if (!$ok) throw new RuntimeException('replication234.failed: '.$reason);
}
replication234Must(config('database.default')==='pgsql'
    && config('database.connections.pgsql.database')==='pb3_replication_234'
    && config('filesystems.disks.ciphertext.endpoint')==='http://127.0.0.1:3900'
    && config('filesystems.disks.ciphertext.bucket')==='pb3-replication-234-a',
    'not_isolated_database_or_ciphertext_disk');
$version=DB::selectOne("SELECT current_setting('server_version_num')::integer AS v");
replication234Must((int)$version->v>=180000 && (int)$version->v<190000,
    'not_actual_postgresql18');

final class Replication234SecondaryGarage implements StorageAdapter
{
    private S3Client $s3;
    private string $bucket;
    public int $puts=0;

    public function __construct()
    {
        $this->bucket=(string)getenv('PB3_REPLICATION_B_BUCKET');
        $this->s3=new S3Client([
            'version'=>'latest','region'=>'garage',
            'endpoint'=>(string)getenv('PB3_REPLICATION_B_ENDPOINT'),
            'use_path_style_endpoint'=>true,
            'credentials'=>[
                'key'=>(string)getenv('PB3_REPLICATION_B_ACCESS_KEY'),
                'secret'=>(string)getenv('PB3_REPLICATION_B_SECRET_KEY'),
            ],
            'retries'=>0,'http'=>['connect_timeout'=>2,'timeout'=>5],
        ]);
    }
    public function putStream(string $objectKey,mixed $stream):bool
    {
        $this->puts++;
        $this->s3->putObject([
            'Bucket'=>$this->bucket,'Key'=>$objectKey,'Body'=>$stream,
        ]);
        return true;
    }
    public function putFixtureBytes(string $objectKey,string $cipher):void
    {
        $this->puts++;
        $this->s3->putObject([
            'Bucket'=>$this->bucket,'Key'=>$objectKey,'Body'=>$cipher,
        ]);
    }
    public function readStream(string $objectKey):mixed
    {
        $result=$this->s3->getObject(['Bucket'=>$this->bucket,'Key'=>$objectKey]);
        $bytes=(string)$result['Body']; // Small SYNTHETIC fixture only.
        $handle=fopen('php://temp','w+b');
        replication234Must(is_resource($handle),'cannot_open_ephemeral_cipher_stream');
        replication234Must(fwrite($handle,$bytes)===strlen($bytes),'failed_test_cipher_buffer');
        rewind($handle);
        return $handle;
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
        $r=$this->s3->headObject(['Bucket'=>$this->bucket,'Key'=>$objectKey]);
        return (int)$r['ContentLength'];
    }
    public function delete(string $objectKey):bool
    {
        throw new RuntimeException('replication234.qa_physical_delete_refused');
    }
}

function replication234Coordinator(
    AppS3Adapter $a,Replication234SecondaryGarage $b
):CiphertextReplicaCoordinator {
    return new CiphertextReplicaCoordinator([
        'app_s3'=>[
            'adapter'=>$a,'failureDomain'=>'garage-node-a-3900',
            'credentialRevision'=>1,
        ],
        'replica_s3'=>[
            'adapter'=>$b,'failureDomain'=>'garage-node-b-4900',
            'credentialRevision'=>1,
        ],
    ]);
}

/** @return array{account:string,device:string} */
function replication234Identity(CarbonImmutable $now):array
{
    $account=(string)Str::uuid();
    $device=(string)Str::uuid();
    DB::table('identity_accounts')->insert([
        'id'=>$account,'operation_id'=>(string)Str::uuid(),
        'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
        'reserved_until'=>$now->addDay(),
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    DB::table('identity_devices')->insert([
        'id'=>$device,'account_id'=>$account,
        'signing_spki'=>'synthetic-replica-qa-device',
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    return ['account'=>$account,'device'=>$device];
}

/** @return array<string,mixed> */
function replication234Fixture(
    string $kind,array $who,string $cipher,CarbonImmutable $now
):array {
    $parent=(string)Str::uuid();
    $asset=(string)Str::uuid();
    $source=(string)Str::uuid();
    $target=(string)Str::uuid();
    $sha=hash('sha256',$cipher);
    $keyA='cipher/p4-234/'.$parent.'/'.$source;
    $keyB='cipher/p4-234/'.$parent.'/'.$target;
    if ($kind==='photo') {
        DB::table('photo_records')->insert([
            'id'=>$parent,'account_id'=>$who['account'],'device_id'=>$who['device'],
            'operation_id'=>(string)Str::uuid(),'state'=>'active',
            'expires_at'=>$now->addDay()->getTimestampMs(),
            'contract_hash'=>str_repeat('a',64),'contract_json'=>'{}',
            'signature'=>'synthetic','created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('photo_objects')->insert([
            'id'=>$asset,'photo_id'=>$parent,'kind'=>'master','revision'=>1,
            'bytes'=>strlen($cipher),'sha256'=>$sha,'manifest_json'=>'{}',
            'object_key'=>$keyA,'state'=>'active',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        $table='storage_locations';$fk='asset_id';
    } elseif ($kind==='media_chunk') {
        DB::table('media_files_v1')->insert([
            'id'=>$parent,'account_id'=>$who['account'],'device_id'=>$who['device'],
            'operation_id'=>(string)Str::uuid(),'media_type'=>'video',
            'state'=>'active','expires_at'=>$now->addDay()->getTimestampMs(),
            'plain_bytes'=>200,'cipher_bytes'=>strlen($cipher),
            'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}',
            'signature'=>'synthetic','created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('media_chunks_v1')->insert([
            'id'=>$asset,'media_id'=>$parent,'chunk_index'=>0,
            'kind'=>'data','plain_bytes'=>200,'bytes'=>strlen($cipher),
            'sha256'=>$sha,'iv'=>'synthetic-iv','state'=>'active',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        $table='media_chunk_locations_v1';$fk='chunk_id';
    } else {
        throw new RuntimeException('replication234.unknown_fixture_kind');
    }
    foreach ([
        [$source,'app_s3',$keyA,'verified'],
        [$target,'replica_s3',$keyB,'reserved'],
    ] as [$id,$provider,$key,$state]) {
        DB::table($table)->insert([
            'id'=>$id,$fk=>$asset,'provider'=>$provider,
            'object_key'=>$key,'sha256'=>$sha,'bytes'=>strlen($cipher),
            'state'=>$state,'created_at'=>$now,'updated_at'=>$now,
        ]);
    }
    return [
        'account'=>$who['account'],'kind'=>$kind,'parent'=>$parent,
        'asset'=>$asset,'source'=>$source,'target'=>$target,
        'sourceKey'=>$keyA,'targetKey'=>$keyB,'sha'=>$sha,
        'bytes'=>strlen($cipher),'table'=>$table,
    ];
}

function replication234Verify(
    StorageAdapter $adapter,string $key,int $bytes,string $sha
):void {
    replication234Must($adapter->exists($key)
        && $adapter->size($key)===$bytes,'remote_cipher_not_found_or_wrong_size');
    $stream=$adapter->readStream($key);
    replication234Must(is_resource($stream),'remote_cipher_stream_unavailable');
    $hash=hash_init('sha256');
    $size=hash_update_stream($hash,$stream);
    fclose($stream);
    replication234Must($size===$bytes
        && hash_equals($sha,hash_final($hash)),
        'remote_cipher_sha_not_verified');
}

/** @param array<string,mixed> $f */
function replication234Enqueue(
    CiphertextReplicaCoordinator $service,
    array $f,string $key,CarbonImmutable $now
):array {
    return $service->enqueue(
        $f['account'],$f['kind'],$f['asset'],
        $f['source'],$f['target'],$key,$now,
    );
}

function replication234LoadFixture():array
{
    $path=(string)getenv('PB3_REPLICATION_FIXTURE_PATH');
    replication234Must(is_file($path),'no_disposable_fixture');
    $data=json_decode((string)file_get_contents($path),true,32,JSON_THROW_ON_ERROR);
    replication234Must(is_array($data)
        && ($data['media']['kind']??null)==='media_chunk'
        && Str::isUuid($data['media']['account']??'')
        && Str::isUuid($data['media']['asset']??''),
        'bad_disposable_fixture');
    return $data;
}

$mode=$argv[1]??'';
replication234Must(in_array($mode,['healthy','outage','recovered'],true)
    && count($argv)===2,'invalid_qa_mode');
$now=CarbonImmutable::now('UTC');
$primary=new AppS3Adapter();
$secondary=new Replication234SecondaryGarage();
$worker=replication234Coordinator($primary,$secondary);

if ($mode==='healthy') {
    $who=replication234Identity($now);
    $fixtures=[];
    foreach (['photo','media_chunk'] as $kind) {
        $cipher=random_bytes($kind==='photo'?4096:6144);
        $f=replication234Fixture($kind,$who,$cipher,$now);
        $stream=fopen('php://temp','w+b');
        fwrite($stream,$cipher);rewind($stream);
        replication234Must($primary->putStream($f['sourceKey'],$stream),
            'primary_put_failed');
        fclose($stream);
        $job=replication234Enqueue($worker,$f,'replication-234-initial-'.$kind,$now);
        $result=$worker->process($job['jobId'],$now);
        replication234Must($result['state']==='verified'
            && $result['transferVerified']===true
            && $result['liveReplicaActivated']===false,
            'initial_real_s3_replication_not_verified');
        replication234Verify($primary,$f['sourceKey'],$f['bytes'],$f['sha']);
        replication234Verify($secondary,$f['targetKey'],$f['bytes'],$f['sha']);
        replication234Must(DB::table($f['table'])
            ->where('id',$f['target'])->value('state')==='verified',
            'target_row_not_physically_acked');
        $fixtures[$kind==='photo'?'photo':'media']=$f;
    }
    echo "P4 #234 REAL GARAGE 1/5 PASS: Photo + Media ciphertext physically streamed A→B and full GET SHA verified, original preserved\n";

    // Deliberately damage only a synthetic secondary. Explicitly mark the
    // candidate degraded, then repair through the SAME production service.
    $f=$fixtures['photo'];
    $original=$primary->readStream($f['sourceKey']);
    replication234Must(is_resource($original),'primary_unreadable');
    $bytes=stream_get_contents($original);
    fclose($original);
    replication234Must(is_string($bytes),'source_fixture_unreadable');
    $bytes[15]=chr(ord($bytes[15])^1);
    $secondary->putFixtureBytes($f['targetKey'],$bytes);
    replication234Must(hash('sha256',$bytes)!==$f['sha'],'bad_corruption_fixture');
    DB::table($f['table'])->where('id',$f['target'])
        ->update(['state'=>'degraded','updated_at'=>$now->addSecond()]);
    $repair=replication234Enqueue(
        $worker,$f,'replication-234-real-repair-photo',$now->addSeconds(2));
    $done=$worker->process($repair['jobId'],$now->addSeconds(2));
    replication234Must($done['state']==='verified'
        && $repair['generation']===2,'real_s3_repair_not_acked');
    replication234Verify($primary,$f['sourceKey'],$f['bytes'],$f['sha']);
    replication234Verify($secondary,$f['targetKey'],$f['bytes'],$f['sha']);
    echo "P4 #234 REAL GARAGE 2/5 PASS: same-length damaged secondary physically repaired with actual source, no original overwrite\n";

    // Genuine physical previous PUT with missing application-level ACK:
    // target is already correct while location row is still reserved.
    $cipher=random_bytes(3101);
    $lost=replication234Fixture('photo',$who,$cipher,$now);
    $stream=fopen('php://temp','w+b');
    fwrite($stream,$cipher);rewind($stream);
    replication234Must($primary->putStream($lost['sourceKey'],$stream),
        'lost_ack_source_put_failed');
    fclose($stream);
    $secondary->putFixtureBytes($lost['targetKey'],$cipher);
    $before=$secondary->puts;
    $job=replication234Enqueue(
        $worker,$lost,'replication-234-lost-ack-replay',$now);
    $done=$worker->process($job['jobId'],$now);
    replication234Must($done['state']==='verified'
        && $secondary->puts===$before,'lost_ack_did_not_skip_duplicate_put');
    replication234Verify($secondary,$lost['targetKey'],$lost['bytes'],$lost['sha']);
    echo "P4 #234 REAL GARAGE 3/5 PASS: previously PUT ciphertext with lost DB ACK reconciled via real GET+SHA without second PUT\n";

    $path=(string)getenv('PB3_REPLICATION_FIXTURE_PATH');
    replication234Must(file_put_contents($path,json_encode(
        ['media'=>$fixtures['media'],'createdAt'=>$now->format('c')],
        JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES),LOCK_EX)!==false,
        'could_not_save_disposable_qa_fixture');
    chmod($path,0600);
    exit(0);
}

$data=replication234LoadFixture();
$f=$data['media'];
if ($mode==='outage') {
    // Garage B is actually stopped by Actions shell BEFORE this process.
    // Verify a real failed network request is observed (not simulated).
    $offline=false;
    try {
        $secondary->size($f['targetKey']);
    } catch (Throwable) {
        $offline=true;
    }
    replication234Must($offline,'secondary_garage_not_actually_stopped');
    DB::table($f['table'])->where('id',$f['target'])
        ->update(['state'=>'degraded','updated_at'=>$now]);
    $job=replication234Enqueue(
        $worker,$f,'replication-234-outage-repair-media',$now);
    $ret=$worker->process($job['jobId'],$now);
    replication234Must($ret['state']==='retry'
        && $ret['attempts']===1
        && $ret['transferVerified']===false,
        'second_provider_failure_not_durable_retry');
    replication234Must(DB::table($f['table'])
        ->where('id',$f['target'])->value('state')==='degraded',
        'offline_s3_falsely_promoted_target');
    replication234Verify($primary,$f['sourceKey'],$f['bytes'],$f['sha']);
    $data['outageJobId']=$job['jobId'];
    $data['outageTime']=$now->format('c');
    replication234Must(file_put_contents(
        (string)getenv('PB3_REPLICATION_FIXTURE_PATH'),
        json_encode($data,JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES),
        LOCK_EX)!==false,'cannot_store_retry_qa_fixture');
    echo "P4 #234 REAL GARAGE 4/5 PASS: stopped Garage B returns durable retry, target NOT verified, real Garage A original intact\n";
    exit(0);
}

replication234Must(Str::isUuid($data['outageJobId']??''),
    'missing_durable_outage_job');
$future=CarbonImmutable::parse((string)$data['outageTime'])->addSeconds(11);
$result=$worker->process((string)$data['outageJobId'],$future);
replication234Must($result['state']==='verified'
    && $result['attempts']===2
    && $result['transferVerified']===true,
    'failed_to_repair_after_real_garage_restart');
replication234Verify($primary,$f['sourceKey'],$f['bytes'],$f['sha']);
replication234Verify($secondary,$f['targetKey'],$f['bytes'],$f['sha']);
replication234Must(DB::table($f['table'])
    ->where('id',$f['target'])->value('state')==='verified',
    'retry_did_not_physically_promote_verified_target');
echo "P4 #234 REAL GARAGE 5/5 PASS: restarted Garage B, durable retry copied and verified ciphertext, original still intact\n";
echo "P4 #234 REAL GARAGE COMPLETE 5/5: true two-Garage physical S3 verification and repair with PostgreSQL18, NO production BYO/backup activation\n";
@unlink((string)getenv('PB3_REPLICATION_FIXTURE_PATH'));
