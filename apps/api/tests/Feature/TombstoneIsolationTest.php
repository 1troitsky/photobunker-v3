<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Media\MediaLifecycle;
use App\Photo\Lifecycle as PhotoLifecycle;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * #193: only server-owned, parent-scoped ciphertext may be destructively GC'd.
 * Synthetic opaque bytes; never print content, keys or account IDs to logs.
 */
final class TombstoneIsolationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp():void
    {
        parent::setUp();
        Storage::fake('ciphertext');
        config()->set('photo_sync.cleanup_enabled',false);
        config()->set('media_sync.cleanup_enabled',false);
    }

    private function fixture(string $kind):array
    {
        $account=(string)Str::uuid();$device=(string)Str::uuid();
        $parent=(string)Str::uuid();$asset=(string)Str::uuid();
        $operation=(string)Str::uuid();$bytes=random_bytes(256);
        $key=($kind==='media'?'cipher/media/v1/':'cipher/v1/')
            .$account.'/'.$parent.'/'.$asset;
        $now=now();$expires=now()->addDay()->getTimestampMs();
        DB::table('identity_accounts')->insert([
            'id'=>$account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>now()->addDay(),
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$account,'signing_spki'=>'fixture',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        if($kind==='media'){
            DB::table('media_files_v1')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>$operation,'media_type'=>'audio','state'=>'pending',
                'expires_at'=>$expires,'plain_bytes'=>240,'cipher_bytes'=>256,
                'contract_hash'=>str_repeat('a',64),
                'contract_json'=>'{}','signature'=>'fixture',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('media_chunks_v1')->insert([
                'id'=>$asset,'media_id'=>$parent,'chunk_index'=>0,
                'kind'=>'data','plain_bytes'=>240,'bytes'=>256,
                'sha256'=>hash('sha256',$bytes),'iv'=>'fixture',
                'state'=>'pending','created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('media_chunk_locations_v1')->insert([
                'id'=>(string)Str::uuid(),'chunk_id'=>$asset,'provider'=>'app_s3',
                'object_key'=>$key,'sha256'=>hash('sha256',$bytes),
                'bytes'=>256,'state'=>'reserved',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
        }else{
            DB::table('photo_records')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>$operation,'state'=>'pending',
                'expires_at'=>$expires,'contract_hash'=>str_repeat('a',64),
                'contract_json'=>'{}','signature'=>'fixture',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('photo_objects')->insert([
                'id'=>$asset,'photo_id'=>$parent,'kind'=>'master','revision'=>1,
                'bytes'=>256,'sha256'=>hash('sha256',$bytes),
                'manifest_json'=>'{}','object_key'=>$key,'state'=>'pending',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('storage_locations')->insert([
                'id'=>(string)Str::uuid(),'asset_id'=>$asset,'provider'=>'app_s3',
                'object_key'=>$key,'sha256'=>hash('sha256',$bytes),
                'bytes'=>256,'state'=>'reserved',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
        }
        Storage::disk('ciphertext')->put($key,$bytes);
        return compact('kind','account','device','parent','asset','operation','key','bytes');
    }

    private function lifecycle(string $kind):MediaLifecycle|PhotoLifecycle
    {
        return $kind==='media'
            ?app(MediaLifecycle::class):app(PhotoLifecycle::class);
    }

    private function tombstoneTable(string $kind):string
    {
        return $kind==='media'?'media_tombstones_v1':'photo_tombstones';
    }

    private function tombstoneId(string $kind):string
    {
        return $kind==='media'?'media_id':'photo_id';
    }

    private function due(string $kind,string $parent):void
    {
        DB::table($this->tombstoneTable($kind))
            ->where($this->tombstoneId($kind),$parent)
            ->update([$kind==='media'?'next_sweep_at':'cleanup_until'
                =>now()->subSecond()]);
    }

    public function test_mixed_foreign_account_keys_are_rejected_before_any_delete():void
    {
        foreach(['media','photo'] as $kind){
            $owner=$this->fixture($kind);$victim=$this->fixture($kind);
            $gc=$this->lifecycle($kind);
            $gc->mark($owner['parent']);
            // One legitimate path followed by a well-formed foreign-account
            // path. All-or-nothing validation is required before first delete.
            DB::table($this->tombstoneTable($kind))
                ->where($this->tombstoneId($kind),$owner['parent'])
                ->update(['object_keys'=>json_encode([
                    $owner['key'],$victim['key'],
                ],JSON_THROW_ON_ERROR)]);
            $this->due($kind,$owner['parent']);
            $this->assertSame(0,$gc->sweepTombstones(10));
            $this->assertTrue(Storage::disk('ciphertext')->exists($owner['key']));
            $this->assertTrue(Storage::disk('ciphertext')->exists($victim['key']));
            // A foreign path must not gain authority merely because it was
            // previously stored in a tombstone or has a syntactically valid UUID.
            $this->assertDatabaseHas($this->tombstoneTable($kind),[
                $this->tombstoneId($kind)=>$owner['parent'],
            ]);
            DB::table($this->tombstoneTable($kind))
                ->where($this->tombstoneId($kind),$owner['parent'])
                ->update(['object_keys'=>json_encode([$owner['key']],JSON_THROW_ON_ERROR)]);
            $this->assertSame(1,$gc->sweepTombstones(10));
            $this->assertFalse(Storage::disk('ciphertext')->exists($owner['key']));
            $this->assertTrue(Storage::disk('ciphertext')->exists($victim['key']));
        }
    }

    public function test_preexisting_deleting_without_tombstone_is_repaired_before_cleanup():void
    {
        foreach(['media','photo'] as $kind){
            $f=$this->fixture($kind);
            $parents=$kind==='media'?'media_files_v1':'photo_records';
            DB::table($parents)->where('id',$f['parent'])
                ->update(['state'=>'deleting']);
            $this->assertDatabaseMissing($this->tombstoneTable($kind),[
                $this->tombstoneId($kind)=>$f['parent'],
            ]);
            $gc=$this->lifecycle($kind);
            $gc->cleanup($f['parent']);
            $this->assertDatabaseMissing($parents,['id'=>$f['parent']]);
            $this->assertDatabaseHas($this->tombstoneTable($kind),[
                $this->tombstoneId($kind)=>$f['parent'],
                'account_id'=>$f['account'],
            ]);
            // Late writer on an old S3 request cannot resurrect ciphertext.
            Storage::disk('ciphertext')->put($f['key'],$f['bytes']);
            $this->due($kind,$f['parent']);
            $this->assertSame(1,$gc->sweepTombstones(10));
            $this->assertFalse(Storage::disk('ciphertext')->exists($f['key']));
        }
    }

    public function test_changed_placement_after_mark_refuses_physical_cleanup():void
    {
        foreach(['media','photo'] as $kind){
            $f=$this->fixture($kind);
            $other=(string)Str::uuid();
            $newPath=($kind==='media'?'cipher/media/v1/':'cipher/v1/')
                .$other.'/'.$f['parent'].'/'.$f['asset'];
            $gc=$this->lifecycle($kind);
            $gc->mark($f['parent']);
            Storage::disk('ciphertext')->put($newPath,$f['bytes']);
            if($kind==='media'){
                DB::table('media_chunk_locations_v1')->where('chunk_id',$f['asset'])
                    ->update(['object_key'=>$newPath]);
            }else{
                DB::table('storage_locations')->where('asset_id',$f['asset'])
                    ->update(['object_key'=>$newPath]);
            }
            try{
                $gc->cleanup($f['parent']);
                $this->fail('GC must reject unowned placement before DELETE');
            }catch(\RuntimeException $e){
                $this->assertContains($e->getMessage(),[
                    'storage.invalid_tombstone_scope','storage.untracked_gc_placement',
                ]);
            }
            $this->assertTrue(Storage::disk('ciphertext')->exists($f['key']));
            $this->assertTrue(Storage::disk('ciphertext')->exists($newPath));
            $this->assertDatabaseHas(
                $kind==='media'?'media_files_v1':'photo_records',
                ['id'=>$f['parent'],'state'=>'deleting'],
            );
        }
    }

    public function test_unexpired_ciphertext_and_off_by_default_scheduler_are_preserved():void
    {
        foreach(['media','photo'] as $kind){
            $f=$this->fixture($kind);
            $command=$kind==='media'?'pb3:media-maintain':'pb3:photo-maintain';
            $this->artisan($command)->assertExitCode(1);
            $this->assertTrue(Storage::disk('ciphertext')->exists($f['key']));
            $this->assertDatabaseHas(
                $kind==='media'?'media_files_v1':'photo_records',
                ['id'=>$f['parent'],'state'=>'pending'],
            );
        }
    }
}
