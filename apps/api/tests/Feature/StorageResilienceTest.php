<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Storage\StorageAdapter;
use App\Storage\StorageManager;
use App\Storage\StorageProviderHealth;
use App\Storage\StorageRetryLedger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class StorageResilienceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp():void
    {
        parent::setUp();
        Storage::fake('ciphertext');
        config()->set('storage_resilience.breaker_enabled',true);
        config()->set('storage_resilience.reconcile_enabled',true);
        config()->set('storage_resilience.failure_threshold',2);
        config()->set('storage_resilience.cooldown_seconds',30);
        config()->set('storage_resilience.retry_base_seconds',30);
    }

    protected function tearDown():void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** Only synthetic ciphertext; no real customer assets, keys or secrets. */
    private function fixture(string $kind='media',string $state='pending'):array
    {
        $now=now();$account=(string)Str::uuid();
        $device=(string)Str::uuid();$parent=(string)Str::uuid();
        $asset=(string)Str::uuid();$op=(string)Str::uuid();
        $bytes=random_bytes(256);
        DB::table('identity_accounts')->insert([
            'id'=>$account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>now()->addDay(),'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$account,'signing_spki'=>'test',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        $exp=now()->addDays(12)->getTimestampMs();
        $key=($kind==='media'?'cipher/media/v1/':'cipher/v1/')
            .$account.'/'.$parent.'/'.$asset;
        if($kind==='media'){
            DB::table('media_files_v1')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>$op,'media_type'=>'photo','state'=>'pending',
                'expires_at'=>$exp,'plain_bytes'=>200,'cipher_bytes'=>256,
                'contract_hash'=>str_repeat('b',64),
                'contract_json'=>'{}','signature'=>'fixture',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('media_chunks_v1')->insert([
                'id'=>$asset,'media_id'=>$parent,'chunk_index'=>0,'kind'=>'data',
                'plain_bytes'=>240,'bytes'=>strlen($bytes),
                'sha256'=>hash('sha256',$bytes),'iv'=>'fixture-iv',
                'state'=>$state,'created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('media_chunk_locations_v1')->insert([
                'id'=>(string)Str::uuid(),'chunk_id'=>$asset,'provider'=>'app_s3',
                'object_key'=>$key,'sha256'=>hash('sha256',$bytes),
                'bytes'=>strlen($bytes),'state'=>'reserved',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
        }else{
            DB::table('photo_records')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>$op,'state'=>'pending',
                'expires_at'=>$exp,'contract_hash'=>str_repeat('b',64),
                'contract_json'=>'{}','signature'=>'fixture',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('photo_objects')->insert([
                'id'=>$asset,'photo_id'=>$parent,'kind'=>'master','revision'=>1,
                'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes),
                'manifest_json'=>'{}','object_key'=>$key,'state'=>$state,
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('storage_locations')->insert([
                'id'=>(string)Str::uuid(),'asset_id'=>$asset,'provider'=>'app_s3',
                'object_key'=>$key,'sha256'=>hash('sha256',$bytes),
                'bytes'=>strlen($bytes),'state'=>'reserved',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
        }
        return compact('asset','parent','bytes','key','kind');
    }

    public function test_media_lost_ack_reconciles_once_after_worker_restart_without_false_finalize():void
    {
        $f=$this->fixture('media','uploading');
        // S3 accepted complete bytes, but PHP died before its verified ACK.
        Storage::disk('ciphertext')->put($f['key'],$f['bytes']);
        app(StorageRetryLedger::class)->remember('media',$f['asset']);
        app(StorageRetryLedger::class)->remember('media',$f['asset']);
        $this->assertDatabaseCount('storage_retry_tickets',1);
        $ledger=new StorageRetryLedger();
        $result=$ledger->reconcile(app(StorageManager::class),10);
        $this->assertSame(['verified'=>1,'await_client'=>0,'retry'=>0,'retired'=>0],$result);
        $this->assertDatabaseHas('media_chunks_v1',['id'=>$f['asset'],'state'=>'verified']);
        $this->assertDatabaseHas('media_chunk_locations_v1',['chunk_id'=>$f['asset'],'state'=>'verified']);
        // A verified S3 pointer is NOT a signed /finalize receipt.
        $this->assertDatabaseHas('media_files_v1',['id'=>$f['parent'],'state'=>'pending','receipt'=>null]);
        $this->assertDatabaseCount('storage_retry_tickets',0);
        $this->assertSame(['verified'=>0,'await_client'=>0,'retry'=>0,'retired'=>0],
            (new StorageRetryLedger())->reconcile(app(StorageManager::class),10));
        $this->assertSame($f['bytes'],Storage::disk('ciphertext')->get($f['key']));
    }

    public function test_photo_put_ticket_is_durable_and_recovered_without_new_ciphertext_upload():void
    {
        $f=$this->fixture('photo','uploading');
        $stream=fopen('php://temp','w+b');fwrite($stream,$f['bytes']);rewind($stream);
        try{$this->assertTrue(app(StorageManager::class)->writeAsset($f['asset'],$stream));}
        finally{fclose($stream);}
        $this->assertDatabaseCount('storage_retry_tickets',1);
        $result=app(StorageRetryLedger::class)->reconcile(app(StorageManager::class),10);
        $this->assertSame(1,$result['verified']);
        $this->assertDatabaseHas('photo_objects',['id'=>$f['asset'],'state'=>'verified']);
        $this->assertDatabaseHas('storage_locations',['asset_id'=>$f['asset'],'state'=>'verified']);
        $this->assertDatabaseHas('photo_records',['id'=>$f['parent'],'state'=>'pending']);
        $this->assertDatabaseCount('storage_retry_tickets',0);
    }

    public function test_missing_or_corrupt_s3_ciphertext_never_becomes_verified():void
    {
        $f=$this->fixture('photo','uploading');
        DB::table('photo_objects')->where('id',$f['asset'])
            ->update(['updated_at'=>now()->subMinutes(4)]);
        Storage::disk('ciphertext')->put($f['key'],str_repeat('X',strlen($f['bytes'])));
        $ledger=app(StorageRetryLedger::class);
        $ledger->remember('photo',$f['asset']);
        $result=$ledger->reconcile(app(StorageManager::class),10);
        $this->assertSame(1,$result['await_client']);
        $this->assertDatabaseHas('photo_objects',['id'=>$f['asset'],'state'=>'pending']);
        $this->assertDatabaseHas('storage_locations',['asset_id'=>$f['asset'],'state'=>'reserved']);
        $this->assertDatabaseHas('storage_retry_tickets',[
            'kind'=>'photo','asset_id'=>$f['asset'],'disposition'=>'await_client',
        ]);
        $this->assertSame(str_repeat('X',256),Storage::disk('ciphertext')->get($f['key']));
        // Repeated immediate worker runs respect next_attempt_at and lease.
        $this->assertSame(0,array_sum($ledger->reconcile(app(StorageManager::class),10)));
    }

    public function test_false_s3_put_opens_durable_circuit_then_recovers_via_single_probe():void
    {
        $f=$this->fixture('media');
        $adapter=new class implements StorageAdapter{
            public int $calls=0;
            public bool $online=false;
            public array $contents=[];
            public function putStream(string $key,mixed $stream):bool{
                ++$this->calls;
                if(!$this->online)return false;
                $this->contents[$key]=stream_get_contents($stream);
                return true;
            }
            public function readStream(string $key):mixed{
                $stream=fopen('php://temp','w+b');
                fwrite($stream,$this->contents[$key]);rewind($stream);
                return $stream;
            }
            public function exists(string $key):bool{return isset($this->contents[$key]);}
            public function size(string $key):int{return strlen($this->contents[$key]);}
            public function delete(string $key):bool{unset($this->contents[$key]);return true;}
        };
        $manager=new StorageManager($adapter);
        for($i=0;$i<2;$i++){
            $stream=fopen('php://temp','w+b');fwrite($stream,$f['bytes']);rewind($stream);
            try{$this->assertFalse($manager->writeMediaChunk($f['asset'],$stream));}
            finally{fclose($stream);}
        }
        $this->assertSame(2,$adapter->calls);
        $this->assertSame('open',app(StorageProviderHealth::class)->status()['state']);
        $stream=fopen('php://temp','w+b');
        try{
            $this->expectExceptionMessage('storage.circuit_open');
            $manager->writeMediaChunk($f['asset'],$stream);
        }finally{fclose($stream);}
    }

    public function test_circuit_cooldown_half_open_recovers_and_health_is_independent():void
    {
        $f=$this->fixture('photo');
        $health=app(StorageProviderHealth::class);
        $health->failed('app_s3');$health->failed('app_s3');
        $this->assertSame('open',$health->status()['state']);
        Carbon::setTestNow(now()->addSeconds(31));
        $health->before('app_s3');
        $this->assertSame('probing',$health->status()['state']);
        try{$health->before('app_s3');$this->fail('two simultaneous probe leases');}
        catch(\RuntimeException $e){$this->assertSame('storage.circuit_open',$e->getMessage());}
        $health->succeeded('app_s3');
        $this->assertSame('closed',$health->status()['state']);
        $this->assertSame(0,$health->status()['failures']);
        $this->assertArrayNotHasKey('account_id',$health->status());
        $this->assertArrayNotHasKey('object_key',$health->status());
        // No tenant, Camera or Identity session needed for provider health.
        $this->assertDatabaseHas('storage_provider_health',['provider'=>'app_s3','state'=>'closed']);
    }

    public function test_leased_tickets_survive_restart_and_never_bypass_tombstone():void
    {
        $f=$this->fixture('media','uploading');
        $ledger=app(StorageRetryLedger::class);
        $ledger->remember('media',$f['asset']);
        Storage::disk('ciphertext')->put($f['key'],$f['bytes']);
        DB::table('storage_retry_tickets')->where('asset_id',$f['asset'])
            ->update(['lease_until'=>now()->addMinutes(2)]);
        $this->assertSame(0,array_sum((new StorageRetryLedger())
            ->reconcile(app(StorageManager::class),10)));
        DB::table('storage_retry_tickets')->where('asset_id',$f['asset'])
            ->update(['lease_until'=>now()->subSecond()]);
        DB::table('media_tombstones_v1')->insert([
            'media_id'=>$f['parent'],'account_id'=>
                DB::table('media_files_v1')->where('id',$f['parent'])->value('account_id'),
            'operation_id'=>
                DB::table('media_files_v1')->where('id',$f['parent'])->value('operation_id'),
            'object_keys'=>json_encode([$f['key']]),'next_sweep_at'=>now(),
            'created_at'=>now(),
        ]);
        $result=(new StorageRetryLedger())->reconcile(app(StorageManager::class),10);
        $this->assertSame(0,$result['verified']);
        $this->assertDatabaseMissing('media_chunks_v1',['id'=>$f['asset'],'state'=>'verified']);
        $this->assertDatabaseHas('media_files_v1',['id'=>$f['parent'],'state'=>'pending']);
        $this->assertDatabaseCount('storage_retry_tickets',0);
    }

    public function test_scheduler_command_is_bounded_and_never_reports_false_server_ack():void
    {
        $f=$this->fixture('media','pending');
        $ledger=app(StorageRetryLedger::class);
        $ledger->remember('media',$f['asset']);
        $this->assertSame(0,Artisan::call('pb3:storage-reconcile',['--batch'=>'0']));
    }
}
