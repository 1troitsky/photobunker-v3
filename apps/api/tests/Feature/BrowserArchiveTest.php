<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

final class BrowserArchiveTest extends TestCase
{
    use RefreshDatabase;
    private array $actors=[];

    protected function setUp():void
    {
        parent::setUp();
        config()->set('browser_archive.write_enabled',true);
        foreach(['owner','outsider'] as $role){
            $key=openssl_pkey_new([
                'private_key_type'=>OPENSSL_KEYTYPE_EC,
                'curve_name'=>'prime256v1',
            ]);
            $spki=P::encode(base64_decode(preg_replace(
                '/-----[^-]+-----|\s+/','',
                openssl_pkey_get_details($key)['key'],
            )));
            $id=(string)Str::uuid();$device=(string)Str::uuid();
            $this->actors[$role]=compact('id','device','key');
            DB::table('identity_accounts')->insert([
                'id'=>$id,'operation_id'=>(string)Str::uuid(),
                'prepare_hash'=>str_repeat('f',64),'status'=>'ready',
                'account_spki'=>$spki,'reserved_until'=>now()->addDay(),
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('identity_devices')->insert([
                'id'=>$device,'account_id'=>$id,'signing_spki'=>$spki,
                'created_at'=>now(),'updated_at'=>now(),
            ]);
        }
    }

    private function as(string $role):void
    {
        $a=$this->actors[$role];
        $this->withHeader('Origin','https://localhost')
            ->withSession(['identity_account'=>$a['id'],
                'identity_device'=>$a['device'],'identity_issued'=>time()]);
    }

    private function asset(string $role,string $kind,int|null $expires=null):string
    {
        $id=(string)Str::uuid();
        $a=$this->actors[$role];
        $data=[
            'id'=>$id,'account_id'=>$a['id'],'device_id'=>$a['device'],
            'operation_id'=>(string)Str::uuid(),
            'state'=>'active','expires_at'=>$expires??PhotoSync::nowMs()+86400000,
            'contract_hash'=>str_repeat('b',64),
            'contract_json'=>'{}','signature'=>'',
            'created_at'=>now(),'updated_at'=>now(),
        ];
        if($kind==='photo'){
            $data['metadata_revision']=1;
            DB::table('photo_records')->insert($data);
        }else{
            $data['media_type']='audio';
            $data['plain_bytes']=1200;
            $data['cipher_bytes']=1300;
            DB::table('media_files_v1')->insert($data);
        }
        return $id;
    }

    private function command(string $role,string $kind,string $id,
        string $action,int $revision,string|null $operation=null):array
    {
        return [
            'version'=>1,'accountId'=>$this->actors[$role]['id'],
            'writerDeviceId'=>$this->actors[$role]['device'],
            'operationId'=>$operation??(string)Str::uuid(),
            'kind'=>$kind,'assetId'=>$id,
            'action'=>$action,'expectedRevision'=>$revision,
        ];
    }

    private function signed(string $role,array $c):array
    {
        $json=json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        openssl_sign("pb3.browser-archive.v1\n".$json,
            $der,$this->actors[$role]['key'],OPENSSL_ALGO_SHA256);
        $parts=[];$i=2;
        for($j=0;$j<2;$j++){
            if(ord($der[$i++])!==2)throw new \RuntimeException('DER integer');
            $n=ord($der[$i++]);$part=substr($der,$i,$n);$i+=$n;
            $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return ['command'=>$json,'signature'=>P::encode(implode('',$parts))];
    }

    private function mutate(string $role,array $c)
    {
        return $this->postJson('/browser/v1/archive/actions',
            $this->signed($role,$c));
    }

    public function test_photo_archive_restore_and_exact_lost_ack():void
    {
        $this->as('owner');
        $id=$this->asset('owner','photo');
        $archive=$this->command('owner','photo',$id,'archive',0);
        // Lost ACK replays EXACT signed bytes, never re-signs the same
        // operation ID with a new randomized ECDSA signature.
        $archiveBody=$this->signed('owner',$archive);
        $created=$this->postJson('/browser/v1/archive/actions',$archiveBody)
            ->assertCreated()->assertJsonPath('state','archived')->json();
        $this->assertLessThanOrEqual(PhotoSync::nowMs()+604800000,
            $created['archiveUntilMs']);
        $this->postJson('/browser/v1/archive/actions',$archiveBody)->assertOk()
            ->assertJsonPath('unchanged',true);
        $this->getJson('/photos/v1')->assertOk()->assertJsonCount(0,'items');
        $this->getJson('/browser/v1/archive')->assertOk()
            ->assertJsonPath('items.0.assetId',$id)
            ->assertJsonPath('items.0.state','archived');
        $this->assertDatabaseHas('photo_records',['id'=>$id,'state'=>'active']);
        $this->assertDatabaseCount('photo_tombstones',0);
        $this->mutate('owner',$this->command('owner','photo',$id,'restore',1))
            ->assertCreated()->assertJsonPath('state','restored');
        $this->getJson('/photos/v1')->assertOk()
            ->assertJsonPath('items.0.photoId',$id);
        $this->getJson('/browser/v1/archive')->assertOk()
            ->assertJsonCount(1,'items')
            ->assertJsonPath('items.0.state','restored')
            ->assertJsonPath('items.0.revision',2);
        // Restored rows remain in owner-scoped history. Re-archive must
        // use revision=2, not an unsigned reset to zero.
        $this->mutate('owner',$this->command('owner','photo',$id,'archive',0))
            ->assertConflict();
        $this->mutate('owner',$this->command('owner','photo',$id,'archive',2))
            ->assertCreated()->assertJsonPath('revision',3);
        $this->assertDatabaseCount('browser_archive_events_v1',3);
    }

    public function test_expiry_is_strict_and_cannot_be_extended_by_archive():void
    {
        $this->as('owner');
        $expiry=PhotoSync::nowMs()+300000;
        $id=$this->asset('owner','media',$expiry);
        $archive=$this->mutate('owner',$this->command(
            'owner','media',$id,'archive',0))->assertCreated()->json();
        $this->assertSame($expiry,$archive['archiveUntilMs']);
        // Changing asset TTL after archive cannot grant a later restore.
        DB::table('browser_archive_entries_v1')->where('asset_id',$id)
            ->update(['archive_until_ms'=>PhotoSync::nowMs()-1]);
        $this->mutate('owner',$this->command('owner','media',$id,'restore',1))
            ->assertStatus(410);
        $this->getJson('/browser/v1/archive')->assertOk()
            ->assertJsonPath('items.0.physicalStatus','past_due_pending_gc');
        $this->assertDatabaseHas('media_files_v1',['id'=>$id,'state'=>'active']);
    }

    public function test_permanent_delete_marks_tombstone_but_never_fakes_physical_gc():void
    {
        $this->as('owner');
        foreach(['photo','media'] as $kind){
            $id=$this->asset('owner',$kind);
            $this->mutate('owner',$this->command('owner',$kind,$id,'archive',0))
                ->assertCreated();
            $delete=$this->command('owner',$kind,$id,'delete',1);
            $signedDelete=$this->signed('owner',$delete);
            $this->postJson('/browser/v1/archive/actions',$signedDelete)
                ->assertCreated()->assertJsonPath('state','deleting')
                ->assertJsonPath('physicalStatus','pending_gc');
            $this->postJson('/browser/v1/archive/actions',$signedDelete)
                ->assertOk()->assertJsonPath('unchanged',true);
            $table=$kind==='photo'?'photo_records':'media_files_v1';
            $tombstone=$kind==='photo'?'photo_tombstones':'media_tombstones_v1';
            $pk=$kind==='photo'?'photo_id':'media_id';
            $this->assertDatabaseHas($table,['id'=>$id,'state'=>'deleting']);
            $this->assertDatabaseHas($tombstone,[$pk=>$id]);
            $this->mutate('owner',$this->command('owner',$kind,$id,'restore',2))
                ->assertStatus(409);
        }
        $this->getJson('/browser/v1/archive')->assertOk()
            ->assertJsonCount(2,'items');
    }

    public function test_tamper_other_account_and_invalid_revisions_cannot_change_state():void
    {
        $this->as('owner');
        $id=$this->asset('owner','photo');
        $c=$this->command('owner','photo',$id,'archive',0);
        $bad=$this->signed('owner',$c);
        $bad['signature']=P::encode(random_bytes(64));
        $this->postJson('/browser/v1/archive/actions',$bad)->assertUnauthorized();
        $wrong=$c;$wrong['expectedRevision']=2;
        $this->mutate('owner',$wrong)->assertConflict();
        $this->as('outsider');
        $this->getJson('/browser/v1/archive')->assertOk()
            ->assertJsonCount(0,'items');
        $this->postJson('/browser/v1/archive/actions',$this->signed('owner',$c))
            ->assertUnauthorized();
        $this->as('owner');
        $this->mutate('owner',$c)->assertCreated();
        $altered=$c;$altered['action']='delete';
        $this->mutate('owner',$altered)->assertConflict();
        $this->assertDatabaseCount('browser_archive_events_v1',1);
    }

    public function test_owner_cannot_archive_previously_shared_photo_or_media():void
    {
        $this->as('owner');
        foreach(['photo','media'] as $kind){
            $id=$this->asset('owner',$kind);
            $data=[
                'id'=>(string)Str::uuid(),
                'owner_account_id'=>$this->actors['owner']['id'],
                'recipient_account_id'=>$this->actors['outsider']['id'],
                'recipient_key_digest'=>str_repeat('a',64),
                'expires_at'=>PhotoSync::nowMs()+1000000,
                // Even revoked historical grants can have FK references,
                // and archiving must never bypass signed sharing history.
                'state'=>'revoked',
                'contract_hash'=>str_repeat('b',64),
                'contract_json'=>'{}','account_signature'=>'',
                'created_at'=>now(),'updated_at'=>now(),
            ];
            if($kind==='photo'){
                $data['photo_id']=$id;
                DB::table('photo_access_grants')->insert($data);
            }else{
                $data['media_id']=$id;
                $data['media_contract_hash']=str_repeat('b',64);
                DB::table('media_recipient_grants_v1')->insert($data);
            }
            $this->mutate('owner',$this->command('owner',$kind,$id,'archive',0))
                ->assertConflict();
        }
        $this->assertDatabaseCount('browser_archive_entries_v1',0);
        $this->assertDatabaseCount('browser_archive_events_v1',0);
        $this->assertDatabaseCount('photo_tombstones',0);
        $this->assertDatabaseCount('media_tombstones_v1',0);
    }

    public function test_feature_gate_and_non_destructive_rollback():void
    {
        $this->as('owner');
        $id=$this->asset('owner','photo');
        config()->set('browser_archive.write_enabled',false);
        $this->mutate('owner',$this->command('owner','photo',$id,'archive',0))
            ->assertStatus(503);
        config()->set('browser_archive.write_enabled',true);
        $this->mutate('owner',$this->command('owner','photo',$id,'archive',0))
            ->assertCreated();
        $migration=require database_path(
            'migrations/2026_11_11_000002_create_browser_archive_v1.php',
        );
        try{$migration->down();$this->fail('Must refuse destructive rollback');}
        catch(\RuntimeException $e){
            $this->assertSame('pb3.browser_archive.rollback_forbidden',$e->getMessage());
        }
        $this->assertTrue(Schema::hasTable('browser_archive_entries_v1'));
    }
    public function test_due_archive_marks_tombstones_only_when_explicitly_enabled():void
    {
        $this->as('owner');
        $photo=$this->asset('owner','photo');
        $media=$this->asset('owner','media');
        foreach([['photo',$photo],['media',$media]] as [$kind,$id]){
            $this->mutate('owner',$this->command('owner',$kind,$id,'archive',0))
                ->assertCreated();
        }
        // The job is explicitly disabled on every normal deployment.
        $service=app(\App\Browser\ArchiveLifecycle::class);
        try{$service->sweepDue(50);$this->fail('sweep must remain gated');}
        catch(\RuntimeException $e){
            $this->assertSame('browser.archive_cleanup_disabled',$e->getMessage());
        }
        config()->set('browser_archive.auto_cleanup_enabled',true);
        // Neither source is eligible while the archive deadline is future.
        $this->assertSame(['marked'=>0,'deferred'=>0,'errors'=>0],
            $service->sweepDue(50));
        DB::table('browser_archive_entries_v1')->whereIn('asset_id',[$photo,$media])
            ->update(['archive_until_ms'=>PhotoSync::nowMs()-1]);
        $this->assertSame(['marked'=>2,'deferred'=>0,'errors'=>0],
            $service->sweepDue(50));
        $this->assertSame(['marked'=>0,'deferred'=>0,'errors'=>0],
            $service->sweepDue(50));
        $this->assertDatabaseHas('photo_records',
            ['id'=>$photo,'state'=>'deleting']);
        $this->assertDatabaseHas('media_files_v1',
            ['id'=>$media,'state'=>'deleting']);
        $this->assertDatabaseHas('photo_tombstones',['photo_id'=>$photo]);
        $this->assertDatabaseHas('media_tombstones_v1',['media_id'=>$media]);
        $this->getJson('/browser/v1/archive')->assertOk()
            ->assertJsonCount(2,'items');
        $this->assertDatabaseHas('browser_archive_entries_v1',
            ['asset_id'=>$photo,'state'=>'deleting']);
        $this->assertDatabaseHas('browser_archive_entries_v1',
            ['asset_id'=>$media,'state'=>'deleting']);
        $this->assertDatabaseCount('photo_records',1);
        $this->assertDatabaseCount('media_files_v1',1);
        // No automatic photo/media S3 delete or fabricated physical ACK.
    }

    public function test_maintenance_command_refuses_default_off_and_does_not_require_s3():void
    {
        $this->artisan('pb3:browser-archive-maintain')->assertFailed();
        config()->set('browser_archive.auto_cleanup_enabled',true);
        config()->set('browser_archive.write_enabled',false);
        $this->artisan('pb3:browser-archive-maintain')->assertFailed();
        config()->set('browser_archive.write_enabled',true);
        $this->artisan('pb3:browser-archive-maintain')->assertSuccessful();
    }

    public function test_signed_archive_inspection_proves_committed_unresolved_or_obsolete():void
    {
        $this->as('owner');
        $id=$this->asset('owner','photo');
        $original=$this->signed('owner',$this->command(
            'owner','photo',$id,'archive',0));
        $alternate=$this->signed('owner',$this->command(
            'owner','photo',$id,'archive',0));
        $endpoint='/browser/v1/archive/inspect';

        // No server side effect; a pending request with still-current CAS
        // cannot be discarded because an in-flight POST may yet succeed.
        $this->postJson($endpoint,$original)->assertOk()
            ->assertJson(['status'=>'unresolved','currentRevision'=>0,'result'=>null]);
        $this->assertDatabaseCount('browser_archive_events_v1',0);
        $this->assertDatabaseCount('browser_archive_entries_v1',0);

        $this->postJson('/browser/v1/archive/actions',$original)
            ->assertCreated();
        $this->postJson($endpoint,$original)->assertOk()
            ->assertJsonPath('status','committed')
            ->assertJsonPath('result.revision',1)
            ->assertJsonPath('result.state','archived');
        $this->postJson($endpoint,$alternate)->assertOk()
            ->assertJson(['status'=>'obsolete','currentRevision'=>1,'result'=>null]);
        $this->assertDatabaseCount('browser_archive_events_v1',1);

        // Read-only reconciliation still works after operators disable
        // new archive mutations. It never triggers S3 deletion.
        config()->set('browser_archive.write_enabled',false);
        $this->postJson($endpoint,$original)->assertOk()
            ->assertJsonPath('status','committed');
        $this->postJson($endpoint,$alternate)->assertOk()
            ->assertJsonPath('status','obsolete');

        $other=$this->signed('owner',$this->command(
            'owner','photo',$id,'restore',0,
            json_decode($original['command'],true,8,JSON_THROW_ON_ERROR)['operationId']
        ));
        $this->postJson($endpoint,$other)->assertConflict();
        $this->as('outsider');
        $this->postJson($endpoint,$original)->assertUnauthorized();
        $this->assertDatabaseCount('photo_tombstones',0);
    }

}
