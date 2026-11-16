<?php
declare(strict_types=1);
namespace Tests\Feature;

use App\Http\Controllers\PublicCardController;
use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PublicCardTest extends TestCase
{
    use RefreshDatabase;
    private mixed $private;
    private string $account,$device,$source,$token,$cipher;
    private array $contract;
    protected function setUp():void
    {
        parent::setUp();Storage::fake('ciphertext');
        $this->private=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
        $detail=openssl_pkey_get_details($this->private);
        $pub=P::encode(base64_decode(preg_replace('/-----[^-]+-----|\s+/','',$detail['key'])));
        $this->account=(string)Str::uuid();$this->device=(string)Str::uuid();$this->source=(string)Str::uuid();
        DB::table('identity_accounts')->insert(['id'=>$this->account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready','account_spki'=>$pub,
            'reserved_until'=>now()->addDay(),'created_at'=>now(),'updated_at'=>now()]);
        DB::table('identity_devices')->insert(['id'=>$this->device,'account_id'=>$this->account,
            'signing_spki'=>$pub,'created_at'=>now(),'updated_at'=>now()]);
        $sourceJson='{"version":1}';
        DB::table('photo_records')->insert(['id'=>$this->source,'account_id'=>$this->account,
            'device_id'=>$this->device,'operation_id'=>(string)Str::uuid(),'state'=>'active',
            'expires_at'=>now()->addDays(2)->getTimestampMs(),'contract_hash'=>hash('sha256',$sourceJson),
            'contract_json'=>$sourceJson,'signature'=>'test-source-not-public-signature','created_at'=>now(),'updated_at'=>now()]);
        $this->token=P::encode(random_bytes(32));$this->cipher=random_bytes(128);
        $this->contract=['version'=>1,'cardId'=>(string)Str::uuid(),'accountId'=>$this->account,
            'sourceKind'=>'photo','sourceId'=>$this->source,'sourceContractHash'=>hash('sha256',$sourceJson),
            'tokenHash'=>hash('sha256',$this->token),'expiresAt'=>now()->addHour()->getTimestampMs(),
            'bytes'=>strlen($this->cipher),'sha256'=>hash('sha256',$this->cipher),'iv'=>P::encode(random_bytes(12)),
            'width'=>1,'height'=>1,'allowDownload'=>false,'ownerEnvelope'=>['iv'=>P::encode(random_bytes(12)),'ciphertext'=>P::encode(random_bytes(128))]];
        $this->withSession(['identity_account'=>$this->account,'identity_device'=>$this->device,'identity_issued'=>time()]);
        $this->withHeader('Origin','https://localhost');
    }
    private function signature(string $text):string
    {
        openssl_sign($text,$der,$this->private,OPENSSL_ALGO_SHA256);$index=2;
        $integer=function()use(&$index,$der):string{
            self::assertSame(2,ord($der[$index++]));$n=ord($der[$index++]);
            $bytes=substr($der,$index,$n);$index+=$n;
            return str_pad(ltrim($bytes,"\0"),32,"\0",STR_PAD_LEFT);
        };
        return P::encode($integer().$integer());
    }
    private function reserve(?array $contract=null)
    {
        $json=json_encode($contract??$this->contract,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return $this->postJson('/public-cards/v1/reserve',['contract'=>$json,
            'signature'=>$this->signature(PublicCardController::DOMAIN.$json)]);
    }
    private function upload(?string $bytes=null)
    {
        $body=$bytes??$this->cipher;
        return $this->call('PUT','/public-cards/v1/owned/'.$this->contract['cardId'].'/payload',[],[],[],
            ['CONTENT_TYPE'=>'application/octet-stream','CONTENT_LENGTH'=>(string)strlen($body),
                'HTTP_ORIGIN'=>'https://localhost','HTTP_ACCEPT'=>'application/json'],$body);
    }
    public function test_signed_reservation_upload_readback_and_lost_ack_retry():void
    {
        $this->reserve()->assertCreated();$this->reserve()->assertOk();
        $this->getJson('/public-cards/v1/'.$this->token)->assertNotFound();
        $this->upload()->assertOk();$this->upload()->assertOk();
        $read=$this->getJson('/public-cards/v1/'.$this->token)->assertOk();
        self::assertSame($this->cipher,P::b64($read->json('ciphertext')));
        $read->assertHeader('Cache-Control','no-store, private');
        $this->assertDatabaseCount('public_cards_v1',1);
        self::assertStringNotContainsString('key=',json_encode($read->json()));
    }
    public function test_revoke_is_idempotent_and_replay_cannot_republish():void
    {
        $this->reserve()->assertCreated();$this->upload()->assertOk();
        $body=['signature'=>$this->signature("pb3.public-card-revoke.v1\n".$this->contract['cardId'])];
        for($i=0;$i<2;$i++)$this->postJson('/public-cards/v1/owned/'.$this->contract['cardId'].'/revoke',$body)->assertOk();
        $this->getJson('/public-cards/v1/'.$this->token)->assertNotFound();
        $this->reserve()->assertStatus(410);$this->upload()->assertStatus(410);
    }
    public function test_expiry_and_source_deletion_deny_known_token():void
    {
        $this->reserve()->assertCreated();$this->upload()->assertOk();
        $this->travel(2)->hours();$this->getJson('/public-cards/v1/'.$this->token)->assertNotFound();
        $this->travelBack();DB::table('photo_records')->where('id',$this->source)->update(['state'=>'deleting']);
        $this->getJson('/public-cards/v1/'.$this->token)->assertNotFound();
    }
    public function test_foreign_sources_and_assignment_capture_are_not_personal_publication():void
    {
        $foreign=$this->contract;$foreign['accountId']=(string)Str::uuid();$this->reserve($foreign)->assertForbidden();
        DB::table('photo_records')->where('id',$this->source)->update(['contract_json'=>'{"version":2,"capture":{}}']);
        $this->reserve()->assertForbidden();
    }
    public function test_payload_tampering_ttl_escalation_origin_and_signature_fail_closed():void
    {
        $bad=$this->contract;$bad['expiresAt']=now()->addDays(3)->getTimestampMs();$this->reserve($bad)->assertUnprocessable();
        $bad=$this->contract;$bad['sourceContractHash']=str_repeat('b',64);$this->reserve($bad)->assertForbidden();
        $this->reserve()->assertCreated();$this->upload(str_repeat('x',128))->assertUnprocessable();
        $this->getJson('/public-cards/v1/'.$this->token)->assertNotFound();
        $this->withHeader('Origin','https://evil.invalid');$this->reserve()->assertForbidden();
    }
    public function test_signed_contract_mutation_and_token_collision_cannot_replace_object():void
    {
        $this->reserve()->assertCreated();
        $bad=$this->contract;$bad['allowDownload']=true;$this->reserve($bad)->assertConflict();
        $bad=$this->contract;$bad['cardId']=(string)Str::uuid();$this->reserve($bad)->assertConflict();
        $this->postJson('/public-cards/v1/reserve',['contract'=>json_encode($this->contract,JSON_UNESCAPED_SLASHES),
            'signature'=>P::encode(random_bytes(64))])->assertForbidden();
    }
    public function test_revoked_device_cannot_publish_or_revoke_and_unknown_tokens_reveal_nothing():void
    {
        DB::table('identity_devices')->where('id',$this->device)->update(['revoked_at'=>now()]);
        $this->reserve()->assertUnauthorized();
        $this->getJson('/public-cards/v1/'.P::encode(random_bytes(32)))->assertNotFound();
    }
    private function duringStorageRead(callable $change):void
    {
        $this->app->instance(\App\Storage\StorageAdapter::class,new class(
            $this->app->make(\App\Storage\StorageAdapter::class),$change,
        ) implements \App\Storage\StorageAdapter {
            private bool $changed=false;
            public function __construct(private $inner,private $change){}
            public function putStream(string $key,mixed $stream):bool{return $this->inner->putStream($key,$stream);}
            public function readStream(string $key):mixed{
                if(!$this->changed){$this->changed=true;($this->change)();}
                return $this->inner->readStream($key);
            }
            public function exists(string $key):bool{return $this->inner->exists($key);}
            public function size(string $key):int{return $this->inner->size($key);}
            public function delete(string $key):bool{return $this->inner->delete($key);}
        });
    }
    public function test_account_admission_change_during_storage_read_denies_public_response():void
    {
        $this->reserve()->assertCreated();$this->upload()->assertOk();
        $this->duringStorageRead(fn()=>DB::table('identity_accounts')
            ->where('id',$this->account)->update(['status'=>'reserved']));
        $this->getJson('/public-cards/v1/'.$this->token)->assertNotFound();
    }
    public function test_device_revocation_during_upload_readback_cannot_activate_publication():void
    {
        $this->reserve()->assertCreated();
        $this->duringStorageRead(fn()=>DB::table('identity_devices')
            ->where('id',$this->device)->update(['revoked_at'=>now()]));
        $this->upload()->assertUnauthorized();
        $this->assertDatabaseHas('public_cards_v1',['id'=>$this->contract['cardId'],'state'=>'pending']);
    }
}
