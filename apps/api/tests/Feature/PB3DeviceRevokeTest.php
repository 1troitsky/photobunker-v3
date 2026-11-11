<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Signed PB3-only revocation. Deliberately NEVER treats the independent
 * Matrix bearer as remotely revoked; the server does not possess that key.
 */
final class PB3DeviceRevokeTest extends TestCase {
    use RefreshDatabase;

    private array $accounts=[];

    protected function setUp():void {
        parent::setUp();
        config()->set('matrix.homeserver_url','https://matrix.example.test');
        foreach(['alice','bob'] as $label) {
            $root=$this->pair();
            $accountId=(string)Str::uuid();
            $one=$this->pair();
            $two=$this->pair();
            $first=(string)Str::uuid();
            $second=(string)Str::uuid();
            $this->accounts[$label]=[
                'id'=>$accountId,'root'=>$root,'one'=>['id'=>$first,'key'=>$one],
                'two'=>['id'=>$second,'key'=>$two],
            ];
            DB::table('identity_accounts')->insert([
                'id'=>$accountId,'operation_id'=>(string)Str::uuid(),
                'prepare_hash'=>str_repeat('a',64),
                'status'=>'ready','revision'=>1,
                'account_spki'=>$root['spki'],
                'reserved_until'=>now()->addDay(),
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            foreach([[$first,$one],[$second,$two]] as [$deviceId,$device]) {
                DB::table('identity_devices')->insert([
                    'id'=>$deviceId,'account_id'=>$accountId,
                    'signing_spki'=>$device['spki'],
                    'created_at'=>now(),'updated_at'=>now(),
                ]);
            }
        }
    }

    private function pair():array {
        $key=openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,
            'curve_name'=>'prime256v1',
        ]);
        $details=openssl_pkey_get_details($key);
        $der=base64_decode(preg_replace('/-----[^-]+-----|\s+/',
            '',(string)$details['key']));
        return ['key'=>$key,'spki'=>P::encode($der)];
    }
    private function signature($key,string $message):string {
        openssl_sign($message,$der,$key,OPENSSL_ALGO_SHA256);
        $offset=2;$parts=[];
        foreach([0,1] as $_) {
            if(ord($der[$offset++])!==2)throw new \RuntimeException('DER');
            $length=ord($der[$offset++]);
            $part=substr($der,$offset,$length);$offset+=$length;
            $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return P::encode(implode('',$parts));
    }
    private function acting(string $who,string $from='one'):void {
        $u=$this->accounts[$who];
        $this->withHeader('Origin','https://localhost')->withSession([
            'identity_account'=>$u['id'],
            'identity_device'=>$u[$from]['id'],
            'identity_issued'=>time(),
        ]);
    }
    private function signed(string $who,string $target,string $from='one',
        int $revision=1):array {
        $u=$this->accounts[$who];
        $contract=json_encode([
            'version'=>1,'operationId'=>(string)Str::uuid(),
            'accountId'=>$u['id'],'actorDeviceId'=>$u[$from]['id'],
            'targetDeviceId'=>$target,'accountRevision'=>$revision,
        ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $msg="pb3.identity-device-revoke.v1\n".$contract;
        return [
            'contract'=>$contract,
            'accountSignature'=>$this->signature($u['root']['key'],$msg),
            'deviceSignature'=>$this->signature($u[$from]['key']['key'],$msg),
        ];
    }
    private function revoke(string $target,array $payload) {
        return $this->postJson(
            '/identity/v2/devices/'.$target.'/revoke',$payload
        );
    }

    public function test_signed_account_and_device_revoke_is_atomic_idempotent_and_blocks_matrix_pb3_api():void {
        $u=$this->accounts['alice'];
        $target=$u['two']['id'];
        $this->acting('alice');
        // Matrix historical binding is immutable audit material, not a
        // bearer credential; revocation cannot claim remote Matrix logout.
        DB::table('matrix_account_bindings_v1')->insert([
            'account_id'=>$u['id'],'homeserver_url'=>'https://matrix.example.test',
            'matrix_user_id'=>'@alice:matrix.example.test',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $original=$this->signed('alice',$target);
        $this->revoke($target,$original)->assertOk()
            ->assertJsonPath('pb3Revoked',true)
            ->assertJsonPath('unchanged',false)
            ->assertJsonPath('matrixRemoteRevoked',false)
            ->assertJsonPath('matrixRevocationStatus','not_performed')
            ->assertDontSee('accessToken');
        $this->revoke($target,$original)->assertOk()
            ->assertJsonPath('unchanged',true);
        $this->assertDatabaseHas('identity_devices',[
            'id'=>$target,'account_id'=>$u['id'],
        ]);
        $this->assertNotNull(DB::table('identity_devices')
            ->where('id',$target)->value('revoked_at'));
        $this->assertDatabaseCount('matrix_account_bindings_v1',1);
        // The still-open cookie on the revoked PB3 device must never
        // authorize future Matrix-binding or identity endpoints.
        $this->acting('alice','two');
        $this->getJson('/identity/v2/me')->assertUnauthorized();
        $this->getJson('/matrix/v1/me')->assertUnauthorized();
        $this->postJson('/matrix/v1/bindings',[])
            ->assertUnauthorized();
        $this->acting('alice','one');
        $this->getJson('/matrix/v1/me')->assertOk()
            ->assertJsonPath('matrixUserId','@alice:matrix.example.test');
    }

    public function test_revoke_rejects_cookie_only_unsigned_wrong_signer_foreign_target_and_revision():void {
        $a=$this->accounts['alice'];
        $b=$this->accounts['bob'];
        $this->acting('alice');
        $target=$a['two']['id'];
        $this->revoke($target,[])->assertUnprocessable();
        $valid=$this->signed('alice',$target);
        $forged=$valid;
        $forged['accountSignature']=P::encode(random_bytes(64));
        $this->revoke($target,$forged)->assertUnauthorized();
        $forged=$valid;
        $forged['deviceSignature']=P::encode(random_bytes(64));
        $this->revoke($target,$forged)->assertUnauthorized();
        $this->revoke($target,$this->signed('alice',$b['two']['id']))
            ->assertUnprocessable();
        $this->revoke($b['two']['id'],
            $this->signed('alice',$b['two']['id']))->assertNotFound();
        $this->revoke($target,$this->signed('alice',$target,'one',2))
            ->assertUnprocessable();
        $differentTarget=str_replace($target,$a['one']['id'],
            $valid['contract']);
        $this->revoke($a['one']['id'],[
            ...$valid,'contract'=>$differentTarget,
        ])->assertUnauthorized();
        $this->assertNull(DB::table('identity_devices')
            ->where('id',$target)->value('revoked_at'));
        $this->withoutHeader('Origin');
        $this->revoke($target,$valid)->assertForbidden();
    }

    public function test_self_revoke_ends_session_and_denies_replays_even_with_valid_root():void {
        $u=$this->accounts['alice'];
        $this->acting('alice');
        $target=$u['one']['id'];
        $valid=$this->signed('alice',$target);
        $this->revoke($target,$valid)->assertOk()
            ->assertJsonPath('matrixRemoteRevoked',false);
        $this->getJson('/identity/v2/me')->assertUnauthorized();
        // Exact network replay from the revoked caller MUST NOT recover
        // an authenticated session, even when it carries valid signatures.
        $this->revoke($target,$valid)->assertUnauthorized();
        $this->acting('alice','two');
        $this->getJson('/identity/v2/me')->assertOk();
        $this->getJson('/identity/v2/devices')->assertOk();
    }
}
