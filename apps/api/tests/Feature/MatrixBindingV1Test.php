<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

final class MatrixBindingV1Test extends TestCase
{
    use RefreshDatabase;

    private array $users=[];
    private const URL='https://matrix.example.test';
    private const TOKEN='test_syt_NeverStoreThisMatrixToken_1234';

    protected function setUp():void {
        parent::setUp();
        config()->set('matrix.homeserver_url',self::URL);
        foreach (['alice','bob'] as $label) {
            $accountKey=$this->pair();
            $deviceKey=$this->pair();
            $aid=(string)Str::uuid();$did=(string)Str::uuid();
            $this->users[$label]=['aid'=>$aid,'did'=>$did,
                'account'=>$accountKey,'device'=>$deviceKey];
            DB::table('identity_accounts')->insert([
                'id'=>$aid,'operation_id'=>(string)Str::uuid(),
                'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
                'account_spki'=>$accountKey['pub'],
                'reserved_until'=>now()->addDay(),
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('identity_devices')->insert([
                'id'=>$did,'account_id'=>$aid,
                'signing_spki'=>$deviceKey['pub'],
                'created_at'=>now(),'updated_at'=>now(),
            ]);
        }
    }

    private function pair():array {
        $key=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,
            'curve_name'=>'prime256v1']);
        $details=openssl_pkey_get_details($key);
        return ['key'=>$key,'pub'=>P::encode(base64_decode(
            preg_replace('/-----[^-]+-----|\s+/','',$details['key'])))];
    }
    private function signature($key,string $message):string {
        openssl_sign($message,$der,$key,OPENSSL_ALGO_SHA256);
        $cursor=2;$parts=[];
        for($i=0;$i<2;$i++){
            if(ord($der[$cursor++])!==2)throw new \RuntimeException('bad DER');
            $length=ord($der[$cursor++]);
            $part=substr($der,$cursor,$length);$cursor+=$length;
            $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return P::encode(implode('',$parts));
    }
    private function as(string $who):void {
        $u=$this->users[$who];
        $this->withHeader('Origin','https://localhost')->withSession([
            'identity_account'=>$u['aid'],
            'identity_device'=>$u['did'],
            'identity_issued'=>time(),
        ]);
    }
    private function request(string $who,string $mxid='@alice:matrix.example.test',
        string $device='MATRIX_DEVICE_A'):array {
        $u=$this->users[$who];
        $contract=json_encode([
            'version'=>1,
            'operationId'=>(string)Str::uuid(),
            'accountId'=>$u['aid'],
            'pb3DeviceId'=>$u['did'],
            'homeserverUrl'=>self::URL,
            'matrixUserId'=>$mxid,
            'matrixDeviceId'=>$device,
        ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $message="pb3.matrix-binding.v1\n".$contract;
        return [
            'contract'=>$contract,
            'accountSignature'=>$this->signature($u['account']['key'],$message),
            'deviceSignature'=>$this->signature($u['device']['key'],$message),
            'accessToken'=>self::TOKEN,
        ];
    }
    private function remote(string $user='@alice:matrix.example.test',
        string $device='MATRIX_DEVICE_A',int $status=200):void {
        Http::fake([
            self::URL.'/_matrix/client/v3/account/whoami'
                =>Http::response(['user_id'=>$user,'device_id'=>$device,
                    'is_guest'=>false],$status),
        ]);
    }

    public function test_rejects_unauthorized_or_unconfigured_without_network():void {
        Http::preventStrayRequests();
        $this->getJson('/matrix/v1/me')->assertUnauthorized();
        $this->postJson('/matrix/v1/bindings',[])->assertForbidden();
        $this->as('alice');
        config()->set('matrix.homeserver_url','http://127.0.0.1:8008');
        $this->getJson('/matrix/v1/me')->assertServiceUnavailable();
        $this->postJson('/matrix/v1/bindings',$this->request('alice'))
            ->assertServiceUnavailable();
        $this->assertDatabaseCount('matrix_account_bindings_v1',0);
        $this->assertDatabaseCount('matrix_device_bindings_v1',0);
        Http::assertNothingSent();
    }

    public function test_real_whoami_proves_signed_device_mapping_and_never_persists_token():void {
        $this->as('alice');$this->remote();
        $request=$this->request('alice');
        $this->postJson('/matrix/v1/bindings',$request)->assertCreated()
            ->assertJsonPath('bound',true)->assertJsonPath('unchanged',false)
            ->assertDontSee(self::TOKEN);
        $this->postJson('/matrix/v1/bindings',$request)->assertOk()
            ->assertJsonPath('unchanged',true);
        $this->getJson('/matrix/v1/me')->assertOk()
            ->assertJsonPath('bound',true)
            ->assertJsonPath('deviceBinding.contract',$request['contract'])
            ->assertDontSee(self::TOKEN);
        Http::assertSent(fn($out)=>
            $out->url()===self::URL.'/_matrix/client/v3/account/whoami'
            &&$out->hasHeader('Authorization','Bearer '.self::TOKEN));
        $rows=[
            DB::table('matrix_account_bindings_v1')->first(),
            DB::table('matrix_device_bindings_v1')->first(),
        ];
        $this->assertSame(1,DB::table('matrix_account_bindings_v1')->count());
        $this->assertSame(1,DB::table('matrix_device_bindings_v1')->count());
        $stored=json_encode($rows,JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString(self::TOKEN,$stored);
        $this->assertStringNotContainsString('accessToken',$stored);
        $this->assertDatabaseCount('photo_access_grants',0);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
    }

    public function test_forged_signature_mismatched_matrix_identity_and_guest_fail_closed():void {
        $this->as('alice');$this->remote('@mallory:matrix.example.test');
        $this->postJson('/matrix/v1/bindings',$this->request('alice'))
            ->assertUnauthorized();
        $this->remote();
        $forged=$this->request('alice');
        $forged['deviceSignature']=P::encode(random_bytes(64));
        $this->postJson('/matrix/v1/bindings',$forged)->assertUnauthorized();
        $bad=$this->request('alice');
        $bad['contract']=str_replace('MATRIX_DEVICE_A','MATRIX_DEVICE_B',$bad['contract']);
        $this->postJson('/matrix/v1/bindings',$bad)->assertUnauthorized();
        Http::fake([
            self::URL.'/_matrix/client/v3/account/whoami'
            =>Http::response(['user_id'=>'@alice:matrix.example.test',
                'device_id'=>'MATRIX_DEVICE_A','is_guest'=>true],200),
        ]);
        $this->postJson('/matrix/v1/bindings',$this->request('alice'))
            ->assertUnauthorized();
        $this->assertDatabaseCount('matrix_device_bindings_v1',0);
    }

    public function test_claiming_another_account_matrix_identity_or_rebinding_is_conflict():void {
        $this->as('alice');$this->remote();
        $first=$this->request('alice');
        $this->postJson('/matrix/v1/bindings',$first)->assertCreated();

        $this->as('bob');
        $this->postJson('/matrix/v1/bindings',$this->request('bob'))->assertConflict();
        $this->assertDatabaseCount('matrix_account_bindings_v1',1);

        $this->as('alice');
        $this->postJson('/matrix/v1/bindings',$this->request('alice'))
            ->assertConflict();
        $this->assertDatabaseCount('matrix_device_bindings_v1',1);
    }

    public function test_device_revoked_during_whoami_cannot_commit_stale_binding():void {
        $this->as('alice');
        $device=$this->users['alice']['did'];
        Http::fake(function()use($device){
            DB::table('identity_devices')->where('id',$device)
                ->update(['revoked_at'=>now()]);
            return Http::response([
                'user_id'=>'@alice:matrix.example.test',
                'device_id'=>'MATRIX_DEVICE_A','is_guest'=>false,
            ],200);
        });
        $this->postJson('/matrix/v1/bindings',$this->request('alice'))
            ->assertUnauthorized();
        $this->assertDatabaseCount('matrix_account_bindings_v1',0);
        $this->assertDatabaseCount('matrix_device_bindings_v1',0);
    }

    public function test_signed_matrix_binding_migration_will_not_drop_live_records():void {
        $this->as('alice');$this->remote();
        $this->postJson('/matrix/v1/bindings',$this->request('alice'))->assertCreated();
        $migration=require database_path(
            'migrations/2026_11_11_000001_create_matrix_bindings_v1.php');
        try {
            $migration->down();
            $this->fail('Nonempty signed Matrix bindings must not be dropped.');
        } catch (\RuntimeException $e) {
            $this->assertSame('pb3.matrix.rollback_forbidden',$e->getMessage());
        }
        $this->assertTrue(Schema::hasTable('matrix_account_bindings_v1'));
        $this->assertTrue(Schema::hasTable('matrix_device_bindings_v1'));
    }
}
