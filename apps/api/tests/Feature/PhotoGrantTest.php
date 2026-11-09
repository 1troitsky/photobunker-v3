<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Signed key directory + grant ACL. All ciphertext is synthetic. Actual ECDH
 * and cross-device AES-GCM receive/decrypt are checked in browser integration.
 */
final class PhotoGrantTest extends TestCase
{
    use RefreshDatabase;

    private array $people=[];
    private string $photoId;
    private array $assets=[];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('ciphertext');
        foreach(['owner','recipient','unrelated'] as $role)$this->newAccount($role);

        $this->photoId=(string)Str::uuid();
        $owner=$this->people['owner'];
        DB::table('photo_records')->insert([
            'id'=>$this->photoId,'account_id'=>$owner['id'],'device_id'=>$owner['device'],
            'operation_id'=>(string)Str::uuid(),'state'=>'active',
            'expires_at'=>now()->addDay()->getTimestampMs(),
            'contract_hash'=>str_repeat('a',64),'contract_json'=>'{}',
            'signature'=>'fixture','created_at'=>now(),'updated_at'=>now(),
        ]);
        foreach(['master','metadata'] as $kind) {
            $id=(string)Str::uuid();
            $bytes=random_bytes($kind==='master'?256:96);
            $key='cipher/v1/'.$owner['id'].'/'.$this->photoId.'/'.$id;
            Storage::disk('ciphertext')->put($key,$bytes);
            DB::table('photo_objects')->insert([
                'id'=>$id,'photo_id'=>$this->photoId,'kind'=>$kind,'revision'=>1,
                'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes),
                'manifest_json'=>'{}','object_key'=>$key,
                'state'=>'active','created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('storage_locations')->insert([
                'id'=>(string)Str::uuid(),'asset_id'=>$id,'provider'=>'app_s3',
                'object_key'=>$key,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes),
                'state'=>'active','created_at'=>now(),'updated_at'=>now(),
            ]);
            $this->assets[]=['assetId'=>$id,'ephemeralSpki'=>$owner['spki'],
                'salt'=>P::encode(random_bytes(16)),'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48))];
        }
        usort($this->assets,fn($a,$b)=>strcmp($a['assetId'],$b['assetId']));
    }

    private function newAccount(string $role):void
    {
        $pair=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
        $pem=openssl_pkey_get_details($pair)['key'];
        $spki=P::encode(base64_decode(preg_replace('/-----[^-]+-----|\s+/','',$pem)));
        $id=(string)Str::uuid();
        $device=(string)Str::uuid();
        $this->people[$role]=['id'=>$id,'device'=>$device,'signer'=>$pair,'spki'=>$spki];
        DB::table('identity_accounts')->insert([
            'id'=>$id,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('d',64),'status'=>'ready',
            'account_spki'=>$spki,'reserved_until'=>now()->addDay(),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$id,'signing_spki'=>$spki,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
    }

    private function become(string $role):void
    {
        $p=$this->people[$role];
        $this->withSession(['identity_account'=>$p['id'],'identity_device'=>$p['device'],
            'identity_issued'=>time()])->withHeader('Origin','https://localhost');
    }

    private function signature(string $role,string $message):string
    {
        openssl_sign($message,$der,$this->people[$role]['signer'],OPENSSL_ALGO_SHA256);
        $i=2;$parts=[];
        foreach([0,1] as $_){
            if(ord($der[$i++])!==2)throw new \RuntimeException('bad test DER');
            $length=ord($der[$i++]);
            $part=substr($der,$i,$length);$i+=$length;
            $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return P::encode(implode('',$parts));
    }

    private function publishRecipientKey():string
    {
        $this->become('recipient');
        $p=$this->people['recipient'];
        $seal=['iv'=>P::encode(random_bytes(12)),
            'ciphertext'=>P::encode(random_bytes(64))];
        $descriptor=json_encode([
            'version'=>1,'accountId'=>$p['id'],'exchangeSpki'=>$p['spki'],
            'sealedDigest'=>hash('sha256',json_encode($seal,JSON_UNESCAPED_SLASHES)),
        ],JSON_UNESCAPED_SLASHES);
        $this->postJson('/shares/v1/keys',[
            'descriptor'=>$descriptor,'sealedPrivate'=>$seal,
            'signature'=>$this->signature('recipient',"pb3.recipient-key.v1\n".$descriptor),
        ])->assertCreated();
        return hash('sha256',$descriptor);
    }

    private function contract(string $keyDigest,?int $expiresAt=null):array
    {
        $contract=json_encode([
            'version'=>1,'grantId'=>(string)Str::uuid(),'photoId'=>$this->photoId,
            'ownerAccountId'=>$this->people['owner']['id'],
            'recipientAccountId'=>$this->people['recipient']['id'],
            'recipientKeyDigest'=>$keyDigest,'scope'=>'read',
            'expiresAt'=>$expiresAt??now()->addHour()->getTimestampMs(),
            'assets'=>$this->assets,
        ],JSON_UNESCAPED_SLASHES);
        return ['contract'=>$contract,
            'signature'=>$this->signature('owner',"pb3.photo-grant.v1\n".$contract)];
    }

    public function test_directory_is_account_signed_and_immutable():void
    {
        $digest=$this->publishRecipientKey();
        $id=$this->people['recipient']['id'];
        $this->getJson('/shares/v1/keys/'.$id)->assertOk()
            ->assertJsonPath('descriptorHash',$digest);
        $this->getJson('/shares/v1/keys/me')->assertOk()
            ->assertJsonPath('present',true);
        $bad=$this->people['recipient'];
        $descriptor=json_encode(['version'=>1,'accountId'=>$bad['id'],
            'exchangeSpki'=>$bad['spki'],'sealedDigest'=>str_repeat('0',64)]);
        $this->postJson('/shares/v1/keys',[
            'descriptor'=>$descriptor,'signature'=>P::encode(random_bytes(64)),
            'sealedPrivate'=>['iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(64))],
        ])->assertStatus(422);
    }

    public function test_signed_grant_is_idempotent_and_recipient_acl_is_enforced():void
    {
        $keyDigest=$this->publishRecipientKey();
        $this->become('owner');
        $input=$this->contract($keyDigest);
        $id=json_decode($input['contract'],true)['grantId'];
        $this->postJson('/shares/v1/grants',$input)->assertCreated();
        $this->postJson('/shares/v1/grants',$input)->assertOk()->assertJsonPath('unchanged',true);
        $this->get('/shares/v1/grants/'.$id)->assertNotFound(); // owner is NOT recipient

        $this->become('unrelated');
        $this->getJson('/shares/v1/received')->assertOk()->assertJsonPath('items',[]);
        $this->getJson('/shares/v1/grants/'.$id)->assertNotFound();
        $this->get('/shares/v1/grants/'.$id.'/objects/'.$this->assets[0]['assetId'])
            ->assertNotFound();

        $this->become('recipient');
        $this->getJson('/shares/v1/received')->assertOk()
            ->assertJsonPath('items.0.grantId',$id);
        $this->getJson('/shares/v1/grants/'.$id)->assertOk()
            ->assertJsonPath('ownerAccountSpki',$this->people['owner']['spki']);
        $this->get('/shares/v1/grants/'.$id.'/objects/'.$this->assets[0]['assetId'])
            ->assertOk();
    }

    public function test_revoke_denies_future_reads_without_deleting_owner_photo():void
    {
        $keyDigest=$this->publishRecipientKey();
        $this->become('owner');
        $input=$this->contract($keyDigest);
        $id=json_decode($input['contract'],true)['grantId'];
        $this->postJson('/shares/v1/grants',$input)->assertCreated();
        $command=json_encode(['version'=>1,'grantId'=>$id,'operationId'=>(string)Str::uuid()]);
        $revoke=['command'=>$command,
            'signature'=>$this->signature('owner',"pb3.photo-revoke.v1\n".$command)];
        $this->postJson('/shares/v1/grants/'.$id.'/revoke',$revoke)
            ->assertOk()->assertJsonPath('state','revoked');
        $this->postJson('/shares/v1/grants/'.$id.'/revoke',$revoke)->assertOk();

        $this->become('recipient');
        $this->getJson('/shares/v1/grants/'.$id)->assertGone();
        $this->get('/shares/v1/grants/'.$id.'/objects/'.$this->assets[0]['assetId'])
            ->assertGone();
        $this->assertDatabaseHas('photo_records',['id'=>$this->photoId,'state'=>'active']);
    }

    public function test_grant_denies_key_substitution_bad_signature_and_expired_photo():void
    {
        $keyDigest=$this->publishRecipientKey();
        $this->become('owner');
        $valid=$this->contract($keyDigest);
        $bad=$valid;
        $bad['signature']=P::encode(random_bytes(64));
        $this->postJson('/shares/v1/grants',$bad)->assertUnauthorized();
        $contract=$this->contract(str_repeat('f',64));
        $this->postJson('/shares/v1/grants',$contract)->assertConflict();
        $this->postJson('/shares/v1/grants',$valid)->assertCreated();
        $id=json_decode($valid['contract'],true)['grantId'];

        DB::table('photo_records')->where('id',$this->photoId)
            ->update(['expires_at'=>now()->subSecond()->getTimestampMs()]);
        $this->become('recipient');
        $this->getJson('/shares/v1/grants/'.$id)->assertGone();
        $this->getJson('/shares/v1/received')->assertJsonPath('items',[]);
    }
}
