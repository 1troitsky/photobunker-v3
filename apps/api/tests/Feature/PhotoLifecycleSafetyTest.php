<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Photo\Lifecycle;
use App\Storage\StorageAdapter;
use App\Storage\StorageManager;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PhotoLifecycleSafetyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('ciphertext');
        config()->set('photo_sync.orphan_grace_hours', 1);
        config()->set('photo_sync.tombstone_sweep_seconds', 60);
        config()->set('photo_sync.cleanup_enabled', false);
    }

    /**
     * Only randomized dummy ciphertext; never a user's media or credentials.
     *
     * @return array{photo:string,assets:array<int,array{id:string,key:string,bytes:string}>}
     */
    private function fixture(int $assets = 2, bool $expired = false): array
    {
        $account=(string) Str::uuid();
        $device=(string) Str::uuid();
        $photo=(string) Str::uuid();
        $operation=(string) Str::uuid();
        $now=now();
        DB::table('identity_accounts')->insert([
            'id'=>$account,'operation_id'=>(string) Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>now()->addDay(),'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$account,'signing_spki'=>'fixture-only',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('photo_records')->insert([
            'id'=>$photo,'account_id'=>$account,'device_id'=>$device,
            'operation_id'=>$operation,'state'=>'pending',
            'expires_at'=>$expired ? now()->subMinute()->getTimestampMs() : now()->addDays(12)->getTimestampMs(),
            'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}','signature'=>'fixture',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        $out=[];
        for($i=0;$i<$assets;$i++){
            $asset=(string) Str::uuid();
            $objectKey='cipher/v1/'.$account.'/'.$photo.'/'.$asset;
            $bytes=random_bytes(200);
            DB::table('photo_objects')->insert([
                'id'=>$asset,'photo_id'=>$photo,
                'kind'=>$i===0?'master':'metadata','revision'=>1,
                'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes),
                'manifest_json'=>'{}','object_key'=>$objectKey,'state'=>'pending',
                'created_at'=>now()->subHours(2),'updated_at'=>now()->subHours(2),
            ]);
            DB::table('storage_locations')->insert([
                'id'=>(string) Str::uuid(),'asset_id'=>$asset,'provider'=>'app_s3',
                'object_key'=>$objectKey,'bytes'=>strlen($bytes),
                'sha256'=>hash('sha256',$bytes),'state'=>'reserved',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            $out[]=['id'=>$asset,'key'=>$objectKey,'bytes'=>$bytes];
        }
        return ['photo'=>$photo,'assets'=>$out];
    }

    public function test_stale_valid_ciphertext_is_reconciled_without_deleting_unexpired_photo(): void
    {
        $f=$this->fixture();
        $disk=Storage::disk('ciphertext');
        foreach($f['assets'] as $asset){
            $disk->put($asset['key'],$asset['bytes']);
            DB::table('photo_objects')->where('id',$asset['id'])->update(['state'=>'uploading']);
        }

        $result=app(Lifecycle::class)->reconcileStalledUploads(10);
        $this->assertSame(['verified'=>2,'reset'=>0,'deferred'=>0,'errors'=>0],$result);
        $this->assertDatabaseHas('photo_records',['id'=>$f['photo'],'state'=>'pending']);
        foreach($f['assets'] as $asset){
            $this->assertSame($asset['bytes'],$disk->get($asset['key']));
            $this->assertDatabaseHas('photo_objects',['id'=>$asset['id'],'state'=>'verified']);
            $this->assertDatabaseHas('storage_locations',['asset_id'=>$asset['id'],'state'=>'verified']);
        }
        // A repeated sweep must not destroy a successfully verified object.
        $this->assertSame(['verified'=>0,'reset'=>0,'deferred'=>0,'errors'=>0],
            app(Lifecycle::class)->reconcileStalledUploads(10));
    }

    public function test_bad_stale_upload_resets_lease_without_erasing_ciphertext(): void
    {
        $f=$this->fixture(1);
        $asset=$f['assets'][0];
        $disk=Storage::disk('ciphertext');
        $bad=str_repeat('x',strlen($asset['bytes']));
        $disk->put($asset['key'],$bad);
        DB::table('photo_objects')->where('id',$asset['id'])->update(['state'=>'uploading']);
        $result=app(Lifecycle::class)->reconcileStalledUploads(10);
        $this->assertSame(['verified'=>0,'reset'=>1,'deferred'=>0,'errors'=>0],$result);
        $this->assertDatabaseHas('photo_objects',['id'=>$asset['id'],'state'=>'pending']);
        $this->assertSame($bad,$disk->get($asset['key'])); // NO destructive "orphan cleanup".
        $this->assertTrue(app(StorageManager::class)->verifyAsset($asset['id'],
            strlen($asset['bytes']),hash('sha256',$asset['bytes']))===false);
        // The existing signed PUT may now safely replace the bad bytes.
        $stream=fopen('php://temp','w+b');
        fwrite($stream,$asset['bytes']);rewind($stream);
        try {
            $this->assertTrue(app(StorageManager::class)->writeAsset($asset['id'],$stream));
        } finally {fclose($stream);}
        $this->assertSame($asset['bytes'],$disk->get($asset['key']));
    }

    public function test_transient_storage_error_does_not_falsely_reset_pending_state(): void
    {
        $f=$this->fixture(1);
        $asset=$f['assets'][0];
        DB::table('photo_objects')->where('id',$asset['id'])->update(['state'=>'uploading']);
        $fault=new class implements StorageAdapter {
            public function putStream(string $objectKey,mixed $stream):bool {throw new \RuntimeException('not used');}
            public function readStream(string $objectKey):mixed {throw new \RuntimeException('storage offline');}
            public function exists(string $objectKey):bool {throw new \RuntimeException('storage offline');}
            public function size(string $objectKey):int {throw new \RuntimeException('storage offline');}
            public function delete(string $objectKey):bool {throw new \RuntimeException('storage offline');}
        };
        app()->instance(StorageAdapter::class,$fault);
        $this->assertSame(['verified'=>0,'reset'=>0,'deferred'=>0,'errors'=>1],
            app(Lifecycle::class)->reconcileStalledUploads(10));
        $this->assertDatabaseHas('photo_objects',['id'=>$asset['id'],'state'=>'uploading']);
        $this->assertDatabaseHas('photo_records',['id'=>$f['photo'],'state'=>'pending']);
    }

    public function test_partial_s3_deletion_failure_keeps_database_references_for_retry(): void
    {
        $f=$this->fixture();
        $disk=Storage::disk('ciphertext');
        foreach($f['assets'] as $a){$disk->put($a['key'],$a['bytes']);}

        $fault=new class($disk) implements StorageAdapter {
            public int $deletions=0;
            public function __construct(private readonly mixed $disk){}
            public function putStream(string $objectKey,mixed $stream):bool {
                return $this->disk->put($objectKey,$stream);
            }
            public function readStream(string $objectKey):mixed{return $this->disk->readStream($objectKey);}
            public function exists(string $objectKey):bool{return $this->disk->exists($objectKey);}
            public function size(string $objectKey):int{return $this->disk->size($objectKey);}
            public function delete(string $objectKey):bool {
                $this->deletions++;
                if($this->deletions===2)throw new \RuntimeException('transient S3 deletion failure');
                return $this->disk->delete($objectKey);
            }
        };
        app()->instance(StorageAdapter::class,$fault);
        $lifecycle=app(Lifecycle::class);
        $lifecycle->mark($f['photo']);

        $dueBefore=DB::table('photo_records')->where('id',$f['photo'])->value('cleanup_next_at');
        $lifecycle->mark($f['photo']); // Repeated mark must not postpone cleanup.
        $this->assertEquals($dueBefore,DB::table('photo_records')->where('id',$f['photo'])
            ->value('cleanup_next_at'));

        try {
            $lifecycle->cleanup($f['photo']);
            $this->fail('Expected injected provider failure');
        } catch (\RuntimeException $e) {
            $this->assertSame('transient S3 deletion failure',$e->getMessage());
        }

        $this->assertDatabaseHas('photo_records',['id'=>$f['photo'],'state'=>'deleting']);
        $this->assertSame(2,DB::table('storage_locations')
            ->whereIn('asset_id',array_column($f['assets'],'id'))->count());
        $this->assertDatabaseHas('photo_tombstones',['photo_id'=>$f['photo']]);

        $lifecycle->cleanup($f['photo']); // Must tolerate first asset already absent.
        $lifecycle->cleanup($f['photo']); // Idempotent after deletion.
        $this->assertDatabaseMissing('photo_records',['id'=>$f['photo']]);
        $this->assertSame([], $disk->allFiles());
        $this->assertDatabaseHas('photo_tombstones',['photo_id'=>$f['photo']]);
    }

    public function test_tombstone_catches_late_writes_even_after_successful_sweep(): void
    {
        $f=$this->fixture(1,true);
        $asset=$f['assets'][0];
        $disk=Storage::disk('ciphertext');
        $disk->put($asset['key'],$asset['bytes']);
        $lifecycle=app(Lifecycle::class);
        $lifecycle->cleanup($f['photo']);
        $this->assertDatabaseMissing('photo_records',['id'=>$f['photo']]);

        DB::table('photo_tombstones')->where('photo_id',$f['photo'])
          ->update(['cleanup_until'=>now()->subSecond()]);
        $disk->put($asset['key'],$asset['bytes']); // Late PUT after confirmed delete.
        $this->assertSame(1,$lifecycle->sweepTombstones(10));
        $this->assertFalse($disk->exists($asset['key']));
        $keys=DB::table('photo_tombstones')->where('photo_id',$f['photo'])->value('object_keys');
        $this->assertNotNull($keys);
        $this->assertContains($asset['key'],json_decode($keys,true,16,JSON_THROW_ON_ERROR));

        $disk->put($asset['key'],$asset['bytes']); // Delayed write after FIRST sweep.
        DB::table('photo_tombstones')->where('photo_id',$f['photo'])
          ->update(['cleanup_until'=>now()->subSecond()]);
        $this->assertSame(1,$lifecycle->sweepTombstones(10));
        $this->assertFalse($disk->exists($asset['key']));
        $this->assertNotNull(DB::table('photo_tombstones')->where('photo_id',$f['photo'])
            ->value('object_keys'));
    }

    public function test_manual_maintenance_is_disabled_without_explicit_operator_gate(): void
    {
        $f=$this->fixture(1,true);
        $this->artisan('pb3:photo-maintain')
            ->expectsOutputToContain('Photo maintenance disabled')
            ->assertExitCode(1);
        $this->assertDatabaseHas('photo_records',['id'=>$f['photo'],'state'=>'pending']);
        $this->assertDatabaseCount('photo_tombstones',0);
    }
}
