<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Independent signed transport safety. Server never sees folder names. */
final class BrowserFolderSyncTest extends TestCase
{
    use RefreshDatabase;

    private array $accounts=[];

    protected function setUp():void
    {
        parent::setUp();
        foreach(['alice','mallory'] as $who){
            $key=openssl_pkey_new([
                'private_key_type'=>OPENSSL_KEYTYPE_EC,
                'curve_name'=>'prime256v1',
            ]);
            $details=openssl_pkey_get_details($key);
            $spki=P::encode(base64_decode(preg_replace(
                '/-----[^-]+-----|\s+/','',$details['key'],
            )));
            $id=(string)Str::uuid();
            $device=(string)Str::uuid();
            DB::table('identity_accounts')->insert([
                'id'=>$id,'operation_id'=>(string)Str::uuid(),
                'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
                'account_spki'=>$spki,'reserved_until'=>now()->addDay(),
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('identity_devices')->insert([
                'id'=>$device,'account_id'=>$id,'signing_spki'=>$spki,
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            $this->accounts[$who]=compact('id','device','key');
        }
    }

    private function as(string $who,string|null $device=null):void
    {
        $person=$this->accounts[$who];
        $this->withHeader('Origin','https://localhost')
            ->withSession([
                'identity_account'=>$person['id'],
                'identity_device'=>$device??$person['device'],
                'identity_issued'=>time(),
            ]);
    }

    private function signed(string $who,array $contract):array
    {
        $json=json_encode($contract,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        openssl_sign("pb3.browser-folders.v1\n".$json,$der,
            $this->accounts[$who]['key'],OPENSSL_ALGO_SHA256);
        $parts=[];$i=2;
        foreach([0,1] as $_){
            if(ord($der[$i++])!==2)throw new \RuntimeException('DER integer');
            $size=ord($der[$i++]);
            $part=substr($der,$i,$size);$i+=$size;
            $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return ['contract'=>$json,'signature'=>P::encode(implode('',$parts))];
    }

    private function contract(string $who,int $from=0,?string $op=null):array
    {
        return [
            'version'=>1,'accountId'=>$this->accounts[$who]['id'],
            'writerDeviceId'=>$this->accounts[$who]['device'],
            'operationId'=>$op??(string)Str::uuid(),
            'fromRevision'=>$from,'toRevision'=>$from+1,'keyRevision'=>1,
            'envelope'=>[
                'version'=>1,
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(150)),
                'wrappedKey'=>[
                    'iv'=>P::encode(random_bytes(12)),
                    'ciphertext'=>P::encode(random_bytes(48)),
                ],
            ],
        ];
    }

    public function test_signed_encrypted_sync_is_private_cas_and_lost_ack_safe():void
    {
        $this->as('alice');
        $this->getJson('/folders/v1/snapshot')->assertOk()
            ->assertJson(['revision'=>0,'contract'=>null,'signature'=>null]);
        $contract=$this->contract('alice');
        $signed=$this->signed('alice',$contract);
        $this->postJson('/folders/v1/snapshot',$signed)->assertCreated()
            ->assertJson(['revision'=>1,'unchanged'=>false]);
        $this->postJson('/folders/v1/snapshot',$signed)->assertOk()
            ->assertJson(['revision'=>1,'unchanged'=>true]);
        $this->getJson('/folders/v1/snapshot')->assertOk()
            ->assertJson(['revision'=>1,'contract'=>$signed['contract'],
                'signature'=>$signed['signature']]);
        $this->assertDatabaseCount('browser_folder_events_v1',1);
        $this->assertDatabaseCount('browser_folder_snapshots_v1',1);

        // A second independently authenticated device can publish rev2.
        $device2=(string)Str::uuid();
        DB::table('identity_devices')->insert([
            'id'=>$device2,'account_id'=>$this->accounts['alice']['id'],
            'signing_spki'=>DB::table('identity_devices')
                ->where('id',$this->accounts['alice']['device'])
                ->value('signing_spki'),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->as('alice',$device2);
        $second=$this->contract('alice',1);
        $second['writerDeviceId']=$device2;
        $this->postJson('/folders/v1/snapshot',$this->signed('alice',$second))
            ->assertCreated()->assertJsonPath('revision',2);
        $this->assertDatabaseCount('browser_folder_events_v1',2);
        $this->getJson('/folders/v1/revisions/1')->assertOk()
            ->assertJson(['revision'=>1,'contract'=>$signed['contract'],
                'signature'=>$signed['signature']]);
        $this->getJson('/folders/v1/revisions/2')->assertOk()
            ->assertJsonPath('revision',2);
        $this->getJson('/folders/v1/revisions/3')->assertNotFound();
        $this->getJson('/folders/v1/revisions/0')->assertNotFound();
        $this->getJson('/folders/v1/revisions/0001')->assertUnprocessable();

        // An idempotent retry must originate from its original signed device.
        // Replaying that device's signed op from device2 is forbidden.
        $this->postJson('/folders/v1/snapshot',$signed)->assertUnprocessable();
        $this->as('alice');
        $this->postJson('/folders/v1/snapshot',$signed)->assertOk()
            ->assertJson(['revision'=>1,'unchanged'=>true]);
        $this->getJson('/folders/v1/snapshot')->assertOk()
            ->assertJsonPath('revision',2);
    }

    public function test_concurrent_writers_replay_conflict_and_tampering_fail_closed():void
    {
        $this->as('alice');
        $first=$this->contract('alice');
        $this->postJson('/folders/v1/snapshot',$this->signed('alice',$first))
            ->assertCreated();

        $stale=$this->signed('alice',$this->contract('alice'));
        $this->postJson('/folders/v1/snapshot',$stale)->assertConflict();
        $modified=$first;
        $modified['envelope']['ciphertext']=P::encode(random_bytes(150));
        $this->postJson('/folders/v1/snapshot',$this->signed('alice',$modified))
            ->assertConflict();
        $forged=$this->signed('alice',$this->contract('alice',1));
        $forged['signature']=P::encode(random_bytes(64));
        $this->postJson('/folders/v1/snapshot',$forged)->assertUnauthorized();

        $wrongDevice=$this->contract('alice',1);
        $wrongDevice['writerDeviceId']=(string)Str::uuid();
        $this->postJson('/folders/v1/snapshot',$this->signed('alice',$wrongDevice))
            ->assertUnprocessable();
        $bad=$this->contract('alice',1);
        $bad['envelope']['ciphertext']=P::encode(random_bytes(120017));
        $this->postJson('/folders/v1/snapshot',$this->signed('alice',$bad))
            ->assertUnprocessable();

        $staleKey=$this->contract('alice',1);
        $staleKey['keyRevision']=2;
        $this->postJson('/folders/v1/snapshot',$this->signed('alice',$staleKey))
            ->assertConflict();
        $this->assertDatabaseCount('browser_folder_events_v1',1);
        $this->assertDatabaseHas('browser_folder_snapshots_v1',['revision'=>1]);
    }

    public function test_other_account_cannot_read_or_apply_signed_snapshot():void
    {
        $this->as('alice');
        $body=$this->signed('alice',$this->contract('alice'));
        $this->postJson('/folders/v1/snapshot',$body)->assertCreated();
        $this->as('mallory');
        $this->getJson('/folders/v1/snapshot')->assertOk()
            ->assertJson(['revision'=>0,'contract'=>null,'signature'=>null]);
        $this->getJson('/folders/v1/revisions/1')->assertNotFound();
        // Signature is bound to Alice's public key: reject before exposing
        // whether that account's encrypted snapshot exists.
        $this->postJson('/folders/v1/snapshot',$body)
            ->assertUnauthorized();
        $this->assertDatabaseCount('browser_folder_snapshots_v1',1);
    }

    public function test_large_ciphertext_and_non_destructive_migration_rollback():void
    {
        $this->as('alice');
        $c=$this->contract('alice');
        // The signed transport does not inherit identity's 8KiB base64 limit.
        $c['envelope']['ciphertext']=P::encode(random_bytes(10000));
        $this->postJson('/folders/v1/snapshot',$this->signed('alice',$c))
            ->assertCreated();
        $migration=require database_path(
            'migrations/2026_11_11_000001_create_browser_folder_sync_v1.php',
        );
        try{
            $migration->down();
            $this->fail('Live E2EE folder structure must never be dropped.');
        }catch(\RuntimeException $e){
            $this->assertSame('pb3.browser_folders.rollback_forbidden',
                $e->getMessage());
        }
        $this->assertTrue(Schema::hasTable('browser_folder_snapshots_v1'));
    }
}
