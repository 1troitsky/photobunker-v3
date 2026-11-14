<?php
declare(strict_types=1);

/**
 * #233 REAL separate Garage 2.5 physical-readback QA.
 * - Creates only SYNTHETIC encrypted-looking bytes in two disposable S3
 *   endpoints and owns only synthetic PostgreSQL fixtures.
 * - Calls production AppS3Adapter on Garage A, a TEST-ONLY AWS SDK-backed
 *   StorageAdapter on physically distinct Garage B and the REAL internal
 *   PlacementReadiness class.
 * - Demonstrates corrupt/missing secondary denial, real secondary outage
 *   denial while the original Garage A blob remains retrievable, recovery.
 * - Never executes StorageManager promotion, migration, user BYO endpoint,
 *   entitlement mutation, production credentials, real deletes or backups.
 */

use App\Storage\AppS3Adapter;
use App\Storage\Placement\PlacementReadiness;
use App\Storage\StorageAdapter;
use Aws\S3\S3Client;
use Aws\S3\Exception\S3Exception;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function placementRequireIsolated(): void
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
    ] as $key=>$value) {
        if (getenv($key) !== $value) {
            throw new RuntimeException('p4.placement.refuse_non_ci_fixture: '.$key);
        }
    }
    $file=getenv('PB3_PLACEMENT_FIXTURE_PATH');
    $temp=getenv('RUNNER_TEMP');
    if (!is_string($file)||!is_string($temp)
        ||!str_starts_with($file,$temp.'/pb3-placement-233-')
        ||str_contains($file,'..')
        ||!preg_match('~^/[^[:space:]]+\.json$~D',$file)) {
        throw new RuntimeException('p4.placement.refuse_fixture_path');
    }
    foreach (['S3_ACCESS_KEY','S3_SECRET_KEY',
        'PB3_PLACEMENT_B_ACCESS_KEY','PB3_PLACEMENT_B_SECRET_KEY'] as $key) {
        if (!is_string(getenv($key)) || strlen((string)getenv($key))<10) {
            throw new RuntimeException('p4.placement.missing_disposable_credential');
        }
    }
    if (hash_equals((string)getenv('S3_ACCESS_KEY'),
            (string)getenv('PB3_PLACEMENT_B_ACCESS_KEY'))) {
        throw new RuntimeException('p4.placement.identical_s3_keys');
    }
}
placementRequireIsolated();
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app=require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

function placementAssert(bool $ok,string $name):void
{
    if (!$ok) throw new RuntimeException('p4.placement.qa_failed: '.$name);
}
placementAssert(config('database.default')==='pgsql'
    && config('database.connections.pgsql.database')==='pb3_placement_233'
    && config('filesystems.disks.ciphertext.endpoint')==='http://127.0.0.1:3900'
    && config('filesystems.disks.ciphertext.bucket')==='pb3-placement-233-a',
    'configuration_is_not_ci');
$version=DB::selectOne("select current_setting('server_version_num')::integer as number");
placementAssert((int)$version->number >= 180000
    && (int)$version->number < 190000, 'wrong_postgres_version');

final class IsolatedSecondGarage implements StorageAdapter
{
    private S3Client $s3;
    private string $bucket;

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
        $stream=fopen('php://temp','w+b');
        if (!is_resource($stream) || fwrite($stream,$body)!==strlen($body)) {
            throw new RuntimeException('p4.placement.synthetic_stream_failed');
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

/** @return array{0:AppS3Adapter,1:IsolatedSecondGarage,2:PlacementReadiness} */
function placementTransports():array
{
    $a=new AppS3Adapter();
    $b=new IsolatedSecondGarage(
        (string)getenv('PB3_PLACEMENT_B_ENDPOINT'),
        (string)getenv('PB3_PLACEMENT_B_BUCKET'),
        (string)getenv('PB3_PLACEMENT_B_ACCESS_KEY'),
        (string)getenv('PB3_PLACEMENT_B_SECRET_KEY'),
    );
    $service=new PlacementReadiness([
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
function placementTest(object $service, array $f):array
{
    $now=CarbonImmutable::now('UTC');
    $response=$f['kind']==='photo'
        ?$service->photo($f['account'],$f['asset'],$f['source'],$f['target'],$now)
        :$service->mediaChunk($f['account'],$f['asset'],$f['source'],$f['target'],$now);
    placementAssert($response['status']==='physical_preflight_only'
        && $response['switchAuthorized']===false
        && $response['ciphertextSha256']===$f['sha']
        && $response['ciphertextBytes']===$f['bytes'],
        $f['kind'].'_readback_or_inert_response');
    return $response;
}

function placementDeny(callable $fn,string $expected):void
{
    try {
        $fn();
    } catch (RuntimeException $e) {
        placementAssert($e->getMessage()===$expected,'incorrect_failure_boundary');
        return;
    }
    throw new RuntimeException('p4.placement.qa_failed: unexpectedly_accepted');
}

/** @return array<string,mixed> */
function placementInsertFixture(string $kind,string $account,string $device,string $bytes):array
{
    $now=CarbonImmutable::now('UTC');
    $parent=(string)Str::uuid();
    $asset=(string)Str::uuid();
    $source=(string)Str::uuid();
    $target=(string)Str::uuid();
    $sha=hash('sha256',$bytes);
    $sourceKey='cipher/p4-placement-233/'.$account.'/'.$parent.'/'.$source;
    $targetKey='cipher/p4-placement-233/'.$account.'/'.$parent.'/'.$target;
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
        throw new RuntimeException('p4.placement.unknown_fixture_kind');
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
function placementVerifyOriginal(AppS3Adapter $a,array $f):void
{
    placementAssert($a->exists($f['sourceKey'])
        && $a->size($f['sourceKey'])===$f['bytes'],
        'original_source_missing');
    $stream=$a->readStream($f['sourceKey']);
    placementAssert(is_resource($stream),'original_source_unreadable');
    $hash=hash_init('sha256');
    $size=hash_update_stream($hash,$stream);
    fclose($stream);
    placementAssert($size===$f['bytes']
        && hash_equals($f['sha'],hash_final($hash)),
        'original_source_sha_mismatch');
}

/** @return array<string,mixed> */
function placementLoadFixture():array
{
    $file=(string)getenv('PB3_PLACEMENT_FIXTURE_PATH');
    placementAssert(is_file($file),'no_seed_fixture');
    $data=json_decode((string)file_get_contents($file),true,32,JSON_THROW_ON_ERROR);
    placementAssert(is_array($data)&&count($data)===2,
        'invalid_seed_fixture');
    foreach ($data as $kind=>$f) {
        placementAssert(in_array($kind,['photo','media_chunk'],true)
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

$mode=$argv[1]??'';
placementAssert(in_array($mode,['healthy','offline','recovered'],true)
    && count($argv)===2,'unknown_test_mode');
[$primary,$secondary,$preflight]=placementTransports();

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
        'signing_spki'=>'synthetic-garage-test',
        'created_at'=>$now,'updated_at'=>$now,
    ]);
    $fixtures=[];
    foreach (['photo','media_chunk'] as $kind) {
        // Synthetic ciphertext-like bytes are not E2EE/user data.
        $cipher=random_bytes($kind==='photo'?4096:8192);
        $f=placementInsertFixture($kind,$account,$device,$cipher);
        $source=fopen('php://temp','w+b');
        fwrite($source,$cipher);rewind($source);
        placementAssert($primary->putStream($f['sourceKey'],$source),
            'primary_put_failed');
        fclose($source);
        $target=fopen('php://temp','w+b');
        fwrite($target,$cipher);rewind($target);
        placementAssert($secondary->putStream($f['targetKey'],$target),
            'secondary_put_failed');
        fclose($target);
        placementTest($preflight,$f);
        placementVerifyOriginal($primary,$f);
        $fixtures[$kind]=$f;
    }
    echo "P4 #233 REAL GARAGE 1/5 PASS: two separate Garage 2.5 endpoints physically read back Photo and Media ciphertext with exact SHA, no switch\n";

    // A copy of the right byte count but changed AES ciphertext must deny.
    $f=$fixtures['photo'];
    $changed=random_bytes((int)$f['bytes']);
    placementAssert(hash('sha256',$changed)!==$f['sha'],'corrupt_fixture_sha_noop');
    $stream=fopen('php://temp','w+b');
    fwrite($stream,$changed);rewind($stream);
    $secondary->putStream($f['targetKey'],$stream);
    fclose($stream);
    placementDeny(fn()=>placementTest($preflight,$f),
        'placement.ciphertext_not_verified');
    placementVerifyOriginal($primary,$f);
    echo "P4 #233 REAL GARAGE 2/5 PASS: secondary SAME LENGTH ciphertext corruption denied, primary SHA preserved\n";

    // Missing target MUST NOT count as a successful move.
    placementAssert($secondary->delete($f['targetKey']),
        'test_target_delete_failed');
    placementDeny(fn()=>placementTest($preflight,$f),
        'placement.ciphertext_not_verified');
    placementVerifyOriginal($primary,$f);
    echo "P4 #233 REAL GARAGE 3/5 PASS: missing target denied, no primary data loss\n";

    // Restore only the disposable synthetic secondary fixture.
    $source=$primary->readStream($f['sourceKey']);
    placementAssert(is_resource($source),'source_unreadable_for_fixture_restore');
    placementAssert($secondary->putStream($f['targetKey'],$source),
        'restore_fixture_failed');
    fclose($source);
    placementTest($preflight,$f);
    foreach ($fixtures as $f) {
        placementAssert(DB::table($f['locations'])->where('id',$f['source'])
                ->value('state')==='verified'
            && DB::table($f['locations'])->where('id',$f['target'])
                ->value('state')==='verified',
            'preflight_mutated_physical_pointer');
    }
    // No credentials, plaintext, user IDs beyond synthetic random fixtures.
    $file=(string)getenv('PB3_PLACEMENT_FIXTURE_PATH');
    placementAssert(file_put_contents($file,json_encode($fixtures,
            JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),LOCK_EX)!==false,
        'cannot_store_opaque_fixture');
    chmod($file,0600);
    echo "P4 #233 REAL GARAGE HEALTHY COMPLETE: two physical providers, two ciphertext objects each, inert placement and original preserved\n";
    exit(0);
}

$fixtures=placementLoadFixture();
if ($mode==='offline') {
    // Shell has stopped ONLY the disposable Garage B Docker container.
    // No exception message is logged because AWS SDK transport errors may
    // include endpoint, response headers or credential-sensitive context.
    $failedTransport=false;
    try {
        $secondary->size($fixtures['photo']['targetKey']);
    } catch (Throwable) {
        $failedTransport=true;
    }
    placementAssert($failedTransport,'target_second_garage_not_really_offline');
    foreach ($fixtures as $f) {
        placementDeny(fn()=>placementTest($preflight,$f),
            'placement.ciphertext_not_verified');
        placementVerifyOriginal($primary,$f);
    }
    echo "P4 #233 REAL GARAGE 4/5 PASS: independently stopped Garage B, real network readback fails closed for both assets; primary Garage A intact\n";
    exit(0);
}

foreach ($fixtures as $f) {
    placementTest($preflight,$f);
    placementVerifyOriginal($primary,$f);
}
placementAssert(DB::table('storage_locations')
        ->where('asset_id',$fixtures['photo']['asset'])->count()===2
    && DB::table('media_chunk_locations_v1')
        ->where('chunk_id',$fixtures['media_chunk']['asset'])->count()===2,
    'placement_records_changed');
echo "P4 #233 REAL GARAGE 5/5 PASS: Garage B restarted, two physical ciphertext SHA readbacks recovered, no S3 pointer mutation\n";
echo "P4 #233 COMPLETE: 5/5 real two-process Garage physical checks + PostgreSQL 18, NO live BYO/placement activation\n";
@unlink((string)getenv('PB3_PLACEMENT_FIXTURE_PATH'));
