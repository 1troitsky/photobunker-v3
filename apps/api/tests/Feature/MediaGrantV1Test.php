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
 * Only the recipient may retrieve the immutable signed media metadata and
 * ciphertext chunks. Actual ECDH and AES-GCM second-account decrypt require
 * Chromium/Garage E2E; synthetic bytes here never appear as plaintext.
 */
final class MediaGrantV1Test extends TestCase
{
    use RefreshDatabase;

    private array $people=[];
    private string $mediaId;
    private string $mediaHash;
    private string $mediaContract;
    private array $chunks=[];

    protected function setUp():void
    {
        parent::setUp();
        Storage::fake('ciphertext');
        foreach(['owner','recipient','unrelated'] as $role)
            $this->newAccount($role);
        $this->mediaId=(string)Str::uuid();
        $owner=$this->people['owner'];
        $expires=now()->addDays(2)->getTimestampMs();
        $chunks=[];
        foreach(['data','metadata'] as $kind){
            $id=(string)Str::uuid();
            $body=random_bytes($kind==='data'?272:87);
            $chunk=[
                'chunkId'=>$id,'index'=>count($chunks),
                'kind'=>$kind,'plainBytes'=>strlen($body)-16,
                'bytes'=>strlen($body),'sha256'=>hash('sha256',$body),
                'iv'=>P::encode(random_bytes(12)),
            ];
            $chunks[]=$chunk;
            $this->chunks[$id]=$body;
            $key='cipher/media/v1/'.$owner['id'].'/'.$this->mediaId.'/'.$id;
            Storage::disk('ciphertext')->put($key,$body);
            DB::table('media_chunks_v1')->insertOrIgnore([]); // fixture below
        }
        $this->mediaContract=json_encode([
            'version'=>1,'accountId'=>$owner['id'],'mediaId'=>$this->mediaId,
            'operationId'=>(string)Str::uuid(),'mediaType'=>'video',
            'expiresAt'=>$expires,'chunkBytes'=>1048576,
            'plainBytes'=>strlen($this->chunks[$chunks[0]['chunkId']])-16,
            'wrappedDEK'=>[
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
            'chunks'=>$chunks,
        ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $this->mediaHash=hash('sha256',$this->mediaContract);
        DB::table('media_files_v1')->insert([
            'id'=>$this->mediaId,'account_id'=>$owner['id'],
            'device_id'=>$owner['device'],
            'operation_id'=>(string)Str::uuid(),
            'media_type'=>'video','state'=>'active','expires_at'=>$expires,
            'plain_bytes'=>256,'cipher_bytes'=>array_sum(array_column($chunks,'bytes')),
            'contract_hash'=>$this->mediaHash,'contract_json'=>$this->mediaContract,
            'signature'=>'device-fixture','receipt'=>json_encode([
                'mediaId'=>$this->mediaId,
            ]),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        foreach($chunks as $chunk){
            $id=$chunk['chunkId'];
            DB::table('media_chunks_v1')->insert([
                'id'=>$id,'media_id'=>$this->mediaId,
                'chunk_index'=>$chunk['index'],'kind'=>$chunk['kind'],
                'plain_bytes'=>$chunk['plainBytes'],'bytes'=>$chunk['bytes'],
                'sha256'=>$chunk['sha256'],'iv'=>$chunk['iv'],
                'state'=>'active','created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('media_chunk_locations_v1')->insert([
                'id'=>(string)Str::uuid(),'chunk_id'=>$id,
                'provider'=>'app_s3',
                'object_key'=>'cipher/media/v1/'.$owner['id'].'/'.
                    $this->mediaId.'/'.$id,
                'sha256'=>$chunk['sha256'],'bytes'=>$chunk['bytes'],
                'state'=>'active','created_at'=>now(),'updated_at'=>now(),
            ]);
        }
    }

    private function newAccount(string $role):void
    {
        $key=openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1',
        ]);
        $pem=openssl_pkey_get_details($key)['key'];
        $spki=P::encode(base64_decode(
            preg_replace('/-----[^-]+-----|\s+/','',$pem)));
        $id=(string)Str::uuid();$device=(string)Str::uuid();
        $this->people[$role]=[
            'id'=>$id,'device'=>$device,'spki'=>$spki,'signer'=>$key,
        ];
        DB::table('identity_accounts')->insert([
            'id'=>$id,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('d',64),
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
        $person=$this->people[$role];
        $this->withSession([
            'identity_account'=>$person['id'],
            'identity_device'=>$person['device'],
            'identity_issued'=>time(),
        ])->withHeader('Origin','https://localhost');
    }
    private function signature(string $role,string $message):string
    {
        openssl_sign($message,$der,$this->people[$role]['signer'],
            OPENSSL_ALGO_SHA256);
        $i=2;$pieces=[];
        foreach([0,1] as $_){
            if(ord($der[$i++])!==2)
                throw new \RuntimeException('test.bad_signature_der');
            $n=ord($der[$i++]);
            $pieces[]=str_pad(ltrim(substr($der,$i,$n),"\0"),32,"\0",STR_PAD_LEFT);
            $i+=$n;
        }
        return P::encode(implode('',$pieces));
    }
    private function publishRecipientKey():string
    {
        $this->asRole('recipient');
        $person=$this->people['recipient'];
        $seal=[
            'iv'=>P::encode(random_bytes(12)),
            'ciphertext'=>P::encode(random_bytes(64)),
        ];
        $descriptor=json_encode([
            'version'=>1,'accountId'=>$person['id'],
            'exchangeSpki'=>$person['spki'],
            'sealedDigest'=>hash('sha256',
                json_encode($seal,JSON_UNESCAPED_SLASHES)),
        ],JSON_UNESCAPED_SLASHES);
        $this->postJson('/shares/v1/keys',[
            'descriptor'=>$descriptor,
            'signature'=>$this->signature('recipient',
                "pb3.recipient-key.v1\n".$descriptor),
            'sealedPrivate'=>$seal,
        ])->assertCreated();
        return hash('sha256',$descriptor);
    }
    private function grantInput(string $recipientDigest,
        ?int $deadline=null,?string $mediaHash=null):array
    {
        $grant=[
            'version'=>1,'grantId'=>(string)Str::uuid(),
            'mediaId'=>$this->mediaId,
            'ownerAccountId'=>$this->people['owner']['id'],
            'recipientAccountId'=>$this->people['recipient']['id'],
            'recipientKeyDigest'=>$recipientDigest,
            'mediaContractHash'=>$mediaHash??$this->mediaHash,
            'scope'=>'read',
            'expiresAt'=>$deadline??now()->addHour()->getTimestampMs(),
            'envelope'=>[
                'ephemeralSpki'=>$this->people['owner']['spki'],
                'salt'=>P::encode(random_bytes(16)),
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
        ];
        $json=json_encode($grant,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return [
            'contract'=>$json,
            'signature'=>$this->signature('owner',
                "pb3.media-grant.v1\n".$json),
        ];
    }

    public function test_recipient_only_gets_signed_media_and_authenticated_chunks():void
    {
        $digest=$this->publishRecipientKey();
        $this->asRole('owner');
        $grant=$this->grantInput($digest);
        $id=json_decode($grant['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$grant)
            ->assertCreated()->assertJsonPath('unchanged',false);
        $this->postJson('/media-shares/v1/grants',$grant)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->getJson('/media-shares/v1/grants/'.$id)->assertNotFound();
        $this->asRole('unrelated');
        $this->getJson('/media-shares/v1/received')
            ->assertOk()->assertJsonPath('items',[]);
        $this->getJson('/media-shares/v1/grants/'.$id)->assertNotFound();
        foreach(array_keys($this->chunks) as $chunkId){
            $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$chunkId)
                ->assertNotFound();
        }
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/received')
            ->assertOk()->assertJsonPath('items.0.grantId',$id)
            ->assertJsonPath('items.0.mediaType','video');
        $this->getJson('/media-shares/v1/grants/'.$id)
            ->assertOk()->assertJsonPath('ownerAccountSpki',
                $this->people['owner']['spki'])
            ->assertJsonPath('mediaContract',$this->mediaContract)
            ->assertJsonPath('contract',$grant['contract']);
        foreach(array_keys($this->chunks) as $chunkId){
            $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$chunkId)
                ->assertOk()->assertHeader('X-Cipher-SHA256',
                    hash('sha256',$this->chunks[$chunkId]));
        }
        $this->assertDatabaseCount('media_recipient_grants_v1',1);
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$this->mediaId,'state'=>'active',
        ]);
    }

    public function test_signed_revoke_is_idempotent_and_denies_future_reads():void
    {
        $digest=$this->publishRecipientKey();
        $this->asRole('owner');
        $grant=$this->grantInput($digest);
        $id=json_decode($grant['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$grant)->assertCreated();
        $command=json_encode([
            'version'=>1,'grantId'=>$id,'operationId'=>(string)Str::uuid(),
        ]);
        $revoke=[
            'command'=>$command,
            'signature'=>$this->signature('owner',
                "pb3.media-revoke.v1\n".$command),
        ];
        $this->postJson('/media-shares/v1/grants/'.$id.'/revoke',$revoke)
            ->assertOk()->assertJsonPath('state','revoked');
        $this->postJson('/media-shares/v1/grants/'.$id.'/revoke',$revoke)
            ->assertOk();
        $this->postJson('/media-shares/v1/grants',$grant)->assertGone();
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
        $this->getJson('/media-shares/v1/received')
            ->assertJsonPath('items',[]);
        $chunkId=array_key_first($this->chunks);
        $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$chunkId)
            ->assertGone();
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$this->mediaId,'state'=>'active',
        ]);
    }

    public function test_wrong_key_digest_forged_owner_signature_or_mutated_media_denied():void
    {
        $digest=$this->publishRecipientKey();
        $this->asRole('owner');
        $grant=$this->grantInput($digest);
        $forged=$grant;
        $forged['signature']=P::encode(random_bytes(64));
        $this->postJson('/media-shares/v1/grants',$forged)
            ->assertUnauthorized();
        $this->postJson('/media-shares/v1/grants',
            $this->grantInput(str_repeat('f',64)))->assertConflict();
        $this->postJson('/media-shares/v1/grants',
            $this->grantInput($digest,null,str_repeat('0',64)))
            ->assertConflict();
        $this->postJson('/media-shares/v1/grants',$grant)->assertCreated();
        $id=json_decode($grant['contract'],true)['grantId'];
        // A privileged DB corruption must not redirect a signed grant to a
        // different immutable media contract without failing closed.
        DB::table('media_files_v1')->where('id',$this->mediaId)
            ->update(['contract_hash'=>str_repeat('a',64)]);
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
        $this->getJson('/media-shares/v1/received')
            ->assertJsonPath('items',[]);
    }

    public function test_expired_media_blocks_grant_and_get_without_deletion():void
    {
        $digest=$this->publishRecipientKey();
        $this->asRole('owner');
        $grant=$this->grantInput($digest);
        $id=json_decode($grant['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$grant)->assertCreated();
        DB::table('media_files_v1')->where('id',$this->mediaId)
            ->update(['expires_at'=>now()->subSecond()->getTimestampMs()]);
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
        $this->getJson('/media-shares/v1/received')
            ->assertJsonPath('items',[]);
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$this->mediaId,'state'=>'active',
        ]);
    }
}
