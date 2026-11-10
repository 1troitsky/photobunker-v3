<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use App\Media\MediaLifecycle;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class MediaRevisionV1Test extends TestCase
{
    use RefreshDatabase;

    private array $people=[];
    private array $files=[];

    protected function setUp():void
    {
        parent::setUp();
        Storage::fake('ciphertext');
        foreach(['owner','outsider'] as $who)$this->account($who);
        $this->asRole('owner');
        foreach(['root','v2','v3','other','video'] as $name){
            $this->files[$name]=$this->media($name==='video'?'video':'audio');
        }
    }
    private function account(string $role):void
    {
        $key=openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1',
        ]);
        $pem=openssl_pkey_get_details($key)['key'];
        $spki=P::encode(base64_decode(
            preg_replace('/-----[^-]+-----|\s+/','',$pem)));
        $id=(string)Str::uuid();$device=(string)Str::uuid();
        $this->people[$role]=['id'=>$id,'device'=>$device,'signer'=>$key,'spki'=>$spki];
        DB::table('identity_accounts')->insert([
            'id'=>$id,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),
            'status'=>'ready','account_spki'=>$spki,
            'reserved_until'=>now()->addDay(),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$id,'signing_spki'=>$spki,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
    }
    private function asRole(string $role):void
    {
        $p=$this->people[$role];
        $this->withSession([
            'identity_account'=>$p['id'],
            'identity_device'=>$p['device'],
            'identity_issued'=>time(),
        ])->withHeader('Origin','https://localhost');
    }
    private function signature(string $role,string $msg):string
    {
        openssl_sign($msg,$der,$this->people[$role]['signer'],OPENSSL_ALGO_SHA256);
        $i=2;$parts=[];
        for($n=0;$n<2;$n++){
            if(ord($der[$i++])!==2)throw new \RuntimeException('test.bad_der');
            $count=ord($der[$i++]);
            $parts[]=str_pad(ltrim(substr($der,$i,$count),"\0"),
                32,"\0",STR_PAD_LEFT);
            $i+=$count;
        }
        return P::encode(implode('',$parts));
    }
    private function media(string $type):array
    {
        $id=(string)Str::uuid();
        $json=json_encode([
            'version'=>1,'mediaId'=>$id,'accountId'=>$this->people['owner']['id'],
            'opaque'=>'no-plaintext-media-contract',
            'nonce'=>bin2hex(random_bytes(12)),
        ],JSON_UNESCAPED_SLASHES);
        $hash=hash('sha256',$json);
        DB::table('media_files_v1')->insert([
            'id'=>$id,'account_id'=>$this->people['owner']['id'],
            'device_id'=>$this->people['owner']['device'],
            'operation_id'=>(string)Str::uuid(),
            'media_type'=>$type,'state'=>'active',
            'expires_at'=>now()->addDays(4)->getTimestampMs(),
            'plain_bytes'=>160,'cipher_bytes'=>176,
            'contract_hash'=>$hash,'contract_json'=>$json,
            'signature'=>'opaque-device-fixture',
            'receipt'=>json_encode(['mediaId'=>$id]),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        return ['id'=>$id,'hash'=>$hash,'type'=>$type,'json'=>$json];
    }
    private function signed(string $root,string $previous,string $next,
        int $fromRevision=1,string $role='owner'):array
    {
        $rootFile=$this->files[$root];
        $prior=$this->files[$previous];
        $new=$this->files[$next];
        $contract=[
            'version'=>1,'linkId'=>(string)Str::uuid(),
            'operationId'=>(string)Str::uuid(),
            'accountId'=>$this->people[$role]['id'],
            'rootMediaId'=>$rootFile['id'],
            'previousMediaId'=>$prior['id'],
            'newMediaId'=>$new['id'],
            'rootContractHash'=>$rootFile['hash'],
            'previousContractHash'=>$prior['hash'],
            'newContractHash'=>$new['hash'],
            'fromRevision'=>$fromRevision,'toRevision'=>$fromRevision+1,
        ];
        $json=json_encode($contract,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['contract'=>$json,'signature'=>$this->signature(
            $role,"pb3.media-revision.v1\n".$json)];
    }
    private function url(string $root):string
    {
        return '/media/v1/'.$this->files[$root]['id'].'/revisions';
    }

    public function test_owner_signed_immutable_linear_history_and_lost_ack():void
    {
        $one=$this->signed('root','root','v2');
        $linkId=json_decode($one['contract'],true)['linkId'];
        $this->getJson($this->url('root'))->assertOk()
            ->assertJsonPath('revision',1)
            ->assertJsonPath('headMediaId',$this->files['root']['id'])
            ->assertJsonPath('events',[]);
        $this->postJson('/media/v1/revisions',$one)
            ->assertCreated()->assertJsonPath('revision',2)
            ->assertJsonPath('unchanged',false);
        $this->postJson('/media/v1/revisions',$one)
            ->assertOk()->assertJsonPath('unchanged',true)
            ->assertJsonPath('linkId',$linkId);
        $this->getJson($this->url('root'))->assertOk()
            ->assertJsonPath('revision',2)
            ->assertJsonPath('headMediaId',$this->files['v2']['id'])
            ->assertJsonPath('events.0.contract',$one['contract'])
            ->assertJsonPath('events.0.signature',$one['signature']);
        $two=$this->signed('root','v2','v3',2);
        $this->postJson('/media/v1/revisions',$two)
            ->assertCreated()->assertJsonPath('revision',3);
        $this->getJson($this->url('root'))->assertOk()
            ->assertJsonPath('revision',3)
            ->assertJsonPath('headMediaId',$this->files['v3']['id'])
            ->assertJsonPath('events.0.contract',$one['contract'])
            ->assertJsonPath('events.1.contract',$two['contract']);
        $this->assertDatabaseCount('media_revision_links_v1',2);
        foreach(['root','v2','v3'] as $name){
            $this->assertDatabaseHas('media_files_v1',[
                'id'=>$this->files[$name]['id'],
                'contract_hash'=>$this->files[$name]['hash'],
                'state'=>'active',
            ]);
        }
    }

    public function test_wrong_owner_fork_cycle_type_change_or_replay_alias_fail_closed():void
    {
        $one=$this->signed('root','root','v2');
        $this->postJson('/media/v1/revisions',$one)->assertCreated();
        $this->postJson('/media/v1/revisions',
            $this->signed('root','root','other'))->assertConflict();
        $this->postJson('/media/v1/revisions',
            $this->signed('root','v2','root',2))->assertUnprocessable();
        $this->postJson('/media/v1/revisions',
            $this->signed('root','v2','video',2))->assertUnprocessable();
        $this->postJson('/media/v1/revisions',
            $this->signed('v2','v2','other'))->assertConflict();
        $changed=json_decode($one['contract'],true);
        $changed['linkId']=(string)Str::uuid();
        $changed['operationId']=(string)Str::uuid();
        $changed['previousContractHash']=str_repeat('f',64);
        $json=json_encode($changed,JSON_UNESCAPED_SLASHES);
        $this->postJson('/media/v1/revisions',[
            'contract'=>$json,'signature'=>$this->signature(
                'owner',"pb3.media-revision.v1\n".$json),
        ])->assertConflict();
        $bad=$this->signed('root','v2','v3',2);
        $bad['signature']=P::encode(random_bytes(64));
        $this->postJson('/media/v1/revisions',$bad)->assertUnauthorized();

        $this->asRole('outsider');
        $this->getJson($this->url('root'))->assertNotFound();
        $this->postJson('/media/v1/revisions',$this->signed(
            'root','v2','v3',2,'outsider'))->assertNotFound();
    }

    public function test_revision_links_do_not_prevent_safe_original_ttl_cleanup():void
    {
        $this->postJson('/media/v1/revisions',
            $this->signed('root','root','v2'))->assertCreated();
        $rootId=$this->files['root']['id'];
        DB::table('media_files_v1')->where('id',$rootId)->update([
            'expires_at'=>now()->subSecond()->getTimestampMs(),
        ]);
        $lifecycle=app(MediaLifecycle::class);
        $lifecycle->mark($rootId);
        $lifecycle->cleanup($rootId);
        $this->assertDatabaseMissing('media_files_v1',['id'=>$rootId]);
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$this->files['v2']['id'],'state'=>'active',
        ]);
        $this->assertDatabaseCount('media_revision_links_v1',1);
        $this->assertDatabaseCount('media_tombstones_v1',1);
        $this->getJson($this->url('root'))->assertGone();
    }
}
