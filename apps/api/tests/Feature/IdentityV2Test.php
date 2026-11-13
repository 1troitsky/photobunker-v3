<?php
declare(strict_types=1);
namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class IdentityV2Test extends TestCase
{
    use RefreshDatabase;

    private function pair(): array {
        $key=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
        $details=openssl_pkey_get_details($key);
        $body=preg_replace('/-----[^-]+-----|\s+/', '', $details['key']);
        return ['key'=>$key,'pub'=>P::encode(base64_decode($body))];
    }
    private function rawSignature(string $message,$key): string {
        openssl_sign($message,$der,$key,OPENSSL_ALGO_SHA256);
        $bytes=$der;
        if(ord($bytes[0])!==0x30)throw new \RuntimeException('DER error');
        $index=2;
        $decode=function()use(&$index,$bytes):string{
            if(ord($bytes[$index++])!==2)throw new \RuntimeException('DER integer');
            $len=ord($bytes[$index++]);
            $integer=substr($bytes,$index,$len);$index+=$len;
            return str_pad(ltrim($integer,"\0"),32,"\0",STR_PAD_LEFT);
        };
        return P::encode($decode().$decode());
    }
    private function postIdentity(string $path,array $data) {
        return $this->withHeader('Origin','https://localhost')->postJson('/identity/v2/'.$path,$data);
    }
    private function challenge(array $payload):array {
        return $this->postIdentity('challenges',['payload'=>$payload])->assertOk()->json();
    }
    public function test_protocol_strict_base64_and_p1363_signature():void {
        $pair=$this->pair();
        $msg='photobunker.identity.v2';
        $sig=$this->rawSignature($msg,$pair['key']);
        $this->assertTrue(P::verify($pair['pub'],$msg,$sig));
        $this->assertFalse(P::verify($pair['pub'],$msg.'tamper',$sig));
        $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);
        P::b64('AA=',1);
    }
    public function test_prepare_idempotence_and_conflicting_retry():void {
        $op=(string)Str::uuid();$proof=P::encode(random_bytes(32));
        $a=$this->postIdentity('prepare',['operationId'=>$op,'reservationProof'=>$proof])->assertOk()->json();
        $b=$this->postIdentity('prepare',['operationId'=>$op,'reservationProof'=>$proof])->assertOk()->json();
        $this->assertSame($a['accountId'],$b['accountId']);
        $this->postIdentity('prepare',['operationId'=>$op,'reservationProof'=>P::encode(random_bytes(32))])->assertStatus(409);
        $this->assertDatabaseCount('identity_accounts',1);
    }
    public function test_register_first_device_without_existing_device_then_reject_replay_expiry_and_wrong_signature():void {
        $account=$this->pair();$device=$this->pair();
        $op=(string)Str::uuid();$deviceId=(string)Str::uuid();$locator=P::encode(random_bytes(16));
        $prepared=$this->postIdentity('prepare',['operationId'=>$op,'reservationProof'=>P::encode(random_bytes(32))])->assertOk()->json();
        $aid=$prepared['accountId'];
        $envelope=['v'=>2,'alg'=>'A256GCM','accountId'=>$aid,'locator'=>$locator,
            'keyId'=>P::encode(random_bytes(16)),'purpose'=>'recovery','revision'=>1,
            'iv'=>P::encode(random_bytes(12)),'ciphertext'=>P::encode(random_bytes(48))];
        $envelopeHash=hash('sha256',P::envelope($envelope,$aid,$locator,'recovery',1));
        $payload=['accountId'=>$aid,'accountSpki'=>$account['pub'],'deviceId'=>$deviceId,
          'deviceSpki'=>$device['pub'],'envelopeHash'=>$envelopeHash,'locator'=>$locator,
          'operationId'=>$op,'purpose'=>'register'];
        $challenge=$this->challenge($payload);
        $body=['challengeId'=>$challenge['id'],
          'signature'=>$this->rawSignature($challenge['message'],$account['key']),
          'deviceSignature'=>$this->rawSignature($challenge['message'],$device['key']),
          'envelope'=>$envelope];
        $this->postIdentity('proof',$body)->assertOk()->assertJsonPath('accountId',$aid);
        $this->assertDatabaseHas('identity_devices',['account_id'=>$aid,'id'=>$deviceId]);
        // Initial registration and AccountCreated are committed together.
        $this->assertDatabaseHas('notification_event_ledger_v1',[
            'account_id'=>$aid,'subject_type'=>'account','subject_id'=>$aid,
            'revision'=>1,'admission_state'=>'sequenced',
        ]);
        $this->getJson('/notifications/v1/events')->assertOk()
            ->assertJsonCount(1,'items')
            ->assertJsonPath('items.0.kind','security')
            ->assertJsonPath('items.0.targetId',null);
        $time=$this->getJson('/identity/v2/time')->assertOk()
            ->assertHeader('Cache-Control','no-store, private')->json('serverUtc');
        $this->assertIsString($time);
        $this->assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/',$time);
        $this->postIdentity('proof',$body)->assertUnauthorized();
        $new=$this->challenge(['accountId'=>$aid,'deviceId'=>$deviceId,'purpose'=>'login']);
        $wrong=['challengeId'=>$new['id'],'signature'=>$this->rawSignature($new['message'],$account['key']),
           'deviceSignature'=>'','envelope'=>null];
        $this->assertSame(64,strlen(P::b64($wrong['signature'],64)));
        $this->assertFalse(P::verify($device['pub'],$new['message'],$wrong['signature']));
        $this->postIdentity('proof',$wrong)->assertUnauthorized();
        $right=['challengeId'=>$new['id'],'signature'=>$this->rawSignature($new['message'],$device['key']),
           'deviceSignature'=>'','envelope'=>null];
        DB::table('identity_challenges')->where('id',$new['id'])->update(['expires_at'=>now()->subMinute()]);
        $this->postIdentity('proof',$right)->assertUnauthorized();
        $recovered=$this->pair();$recoveredId=(string)Str::uuid();
        $recoverPayload=['accountId'=>$aid,'deviceId'=>$recoveredId,'deviceSpki'=>$recovered['pub'],
            'purpose'=>'recover','revision'=>'1'];
        foreach([1,2] as $_){
            $recoverChallenge=$this->challenge($recoverPayload);
            $this->postIdentity('proof',[
                'challengeId'=>$recoverChallenge['id'],
                'signature'=>$this->rawSignature($recoverChallenge['message'],$account['key']),
                'deviceSignature'=>$this->rawSignature($recoverChallenge['message'],$recovered['key']),
                'envelope'=>null,
            ])->assertOk()->assertJsonPath('deviceId',$recoveredId);
        }
        $this->assertDatabaseCount('identity_devices',2);
        // Recovery and ordinary login must never re-emit AccountCreated.
        $this->assertSame(1,DB::table('notification_event_ledger_v1')
            ->where('account_id',$aid)->count());

    }
    public function test_origin_protection_and_no_unauthenticated_devices():void {
        $this->postJson('/identity/v2/prepare',['operationId'=>(string)Str::uuid(),
          'reservationProof'=>P::encode(random_bytes(32))])->assertForbidden();
        $this->getJson('/identity/v2/devices')->assertUnauthorized();
        $this->getJson('/identity/v2/time')->assertUnauthorized();
    }
}
