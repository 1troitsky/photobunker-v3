<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

final class MatrixRecoveryEscrowTest extends TestCase
{
    use RefreshDatabase;
    private array $people=[];
    private const HOMESERVER='https://matrix.example.test';

    protected function setUp():void {
        parent::setUp();
        foreach(['alice','bob'] as $name) {
            $key=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,
                'curve_name'=>'prime256v1']);
            $details=openssl_pkey_get_details($key);
            $spki=P::encode(base64_decode(
                preg_replace('/-----[^-]+-----|\s+/','',$details['key'])));
            $accountId=(string)Str::uuid();
            $deviceId=(string)Str::uuid();
            $mxid='@'.$name.':matrix.example.test';
            $this->people[$name]=[
                'account'=>$accountId,'device'=>$deviceId,'key'=>$key,
                'mxid'=>$mxid,
            ];
            DB::table('identity_accounts')->insert([
                'id'=>$accountId,'operation_id'=>(string)Str::uuid(),
                'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
                'account_spki'=>$spki,'revision'=>1,
                'reserved_until'=>now()->addDay(),
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('identity_devices')->insert([
                'id'=>$deviceId,'account_id'=>$accountId,
                'signing_spki'=>$spki,
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('matrix_account_bindings_v1')->insert([
                'account_id'=>$accountId,'homeserver_url'=>self::HOMESERVER,
                'matrix_user_id'=>$mxid,
                'created_at'=>now(),'updated_at'=>now(),
            ]);
        }
    }
    private function as(string $who,?string $device=null):void {
        $person=$this->people[$who];
        $this->withHeader('Origin','https://localhost')->withSession([
            'identity_account'=>$person['account'],
            'identity_device'=>$device??$person['device'],
            'identity_issued'=>time(),
        ]);
    }
    private function rawSignature($key,string $text):string {
        openssl_sign($text,$der,$key,OPENSSL_ALGO_SHA256);
        $offset=2;$parts=[];
        foreach([0,1] as $_) {
            if(ord($der[$offset++])!==2)throw new \RuntimeException('DER');
            $length=ord($der[$offset++]);
            $part=substr($der,$offset,$length);$offset+=$length;
            $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return P::encode(implode('',$parts));
    }
    private function payload(string $who):array {
        $p=$this->people[$who];
        $contract=json_encode([
            'version'=>1,'operationId'=>(string)Str::uuid(),
            'accountId'=>$p['account'],'accountRevision'=>1,
            'homeserverUrl'=>self::HOMESERVER,'matrixUserId'=>$p['mxid'],
            'purpose'=>'matrix-ssss-key',
            'keyId'=>P::encode(random_bytes(16)),
            'iv'=>P::encode(random_bytes(12)),
            'ciphertext'=>P::encode(random_bytes(48)),
        ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['contract'=>$contract,
            'signature'=>$this->rawSignature($p['key'],
                "pb3.matrix-ssss-escrow.v1\n".$contract),
        ];
    }

    public function test_authenticated_account_signed_opaque_escrow_is_idempotent():void {
        $this->as('alice');
        $body=$this->payload('alice');
        $this->postJson('/matrix/v1/recovery/ssss',$body)
            ->assertCreated()->assertJsonPath('stored',true)
            ->assertJsonPath('unchanged',false);
        $this->postJson('/matrix/v1/recovery/ssss',$body)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->getJson('/matrix/v1/recovery/ssss')->assertOk()
            ->assertJsonPath('present',true)
            ->assertJsonPath('contract',$body['contract'])
            ->assertJsonPath('signature',$body['signature'])
            ->assertDontSee('accessToken');
        $this->assertDatabaseCount('matrix_recovery_escrows_v1',1);
        $row=DB::table('matrix_recovery_escrows_v1')->first();
        $this->assertSame($body['contract'],$row->contract_json);
        $this->assertSame($body['signature'],$row->account_signature);
        $this->assertSame(64,strlen($row->contract_hash));
        $this->assertStringNotContainsString('accessToken',
            json_encode($row,JSON_THROW_ON_ERROR));
        $this->assertDatabaseCount('photo_access_grants',0);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
    }

    public function test_unauthenticated_and_other_owner_cannot_read_or_replace():void {
        $this->getJson('/matrix/v1/recovery/ssss')->assertUnauthorized();
        $this->postJson('/matrix/v1/recovery/ssss',[])
            ->assertForbidden();
        $this->as('alice');
        $payload=$this->payload('alice');
        $this->postJson('/matrix/v1/recovery/ssss',$payload)
            ->assertCreated();
        $this->as('bob');
        $this->getJson('/matrix/v1/recovery/ssss')
            ->assertOk()->assertJsonPath('present',false)
            ->assertDontSee($payload['contract']);
        $this->postJson('/matrix/v1/recovery/ssss',$payload)
            ->assertUnprocessable();
        $this->assertDatabaseCount('matrix_recovery_escrows_v1',1);
    }

    public function test_rejects_forged_signature_malformed_ciphertext_and_different_payload():void {
        $this->as('alice');
        $valid=$this->payload('alice');
        $forged=$valid;
        $forged['signature']=P::encode(random_bytes(64));
        $this->postJson('/matrix/v1/recovery/ssss',$forged)
            ->assertUnauthorized();
        $bad=$valid;
        $c=json_decode($bad['contract'],true);
        $c['ciphertext']=P::encode(random_bytes(47));
        $bad['contract']=json_encode($c,JSON_UNESCAPED_SLASHES);
        $bad['signature']=$this->rawSignature(
            $this->people['alice']['key'],
            "pb3.matrix-ssss-escrow.v1\n".$bad['contract']);
        $this->postJson('/matrix/v1/recovery/ssss',$bad)
            ->assertUnprocessable();
        $wrong=$valid;
        $c=json_decode($wrong['contract'],true);
        $c['matrixUserId']='@mallory:matrix.example.test';
        $wrong['contract']=json_encode($c,JSON_UNESCAPED_SLASHES);
        $wrong['signature']=$this->rawSignature(
            $this->people['alice']['key'],
            "pb3.matrix-ssss-escrow.v1\n".$wrong['contract']);
        $this->postJson('/matrix/v1/recovery/ssss',$wrong)
            ->assertUnprocessable();
        $this->postJson('/matrix/v1/recovery/ssss',$valid)
            ->assertCreated();
        $this->postJson('/matrix/v1/recovery/ssss',$this->payload('alice'))
            ->assertConflict();
        $this->assertDatabaseCount('matrix_recovery_escrows_v1',1);
    }

    public function test_recovered_pb3_device_may_read_same_opaque_envelope():void {
        $this->as('alice');
        $payload=$this->payload('alice');
        $this->postJson('/matrix/v1/recovery/ssss',$payload)
            ->assertCreated();
        $device=(string)Str::uuid();
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$this->people['alice']['account'],
            'signing_spki'=>DB::table('identity_devices')
                ->where('id',$this->people['alice']['device'])->value('signing_spki'),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->as('alice',$device);
        $this->getJson('/matrix/v1/recovery/ssss')->assertOk()
            ->assertJsonPath('contract',$payload['contract']);
        $this->assertDatabaseCount('matrix_recovery_escrows_v1',1);
    }

    public function test_revocation_and_pb3_key_revision_change_fail_closed():void {
        $this->as('alice');
        $payload=$this->payload('alice');
        $this->postJson('/matrix/v1/recovery/ssss',$payload)->assertCreated();
        DB::table('identity_accounts')->where('id',$this->people['alice']['account'])
            ->update(['revision'=>2]);
        $this->getJson('/matrix/v1/recovery/ssss')->assertConflict();
        $this->postJson('/matrix/v1/recovery/ssss',$payload)
            ->assertUnprocessable();
        DB::table('identity_devices')->where('id',$this->people['alice']['device'])
            ->update(['revoked_at'=>now()]);
        $this->getJson('/matrix/v1/recovery/ssss')->assertUnauthorized();
        $this->assertDatabaseCount('matrix_recovery_escrows_v1',1);
    }

    public function test_schema_rollback_refuses_destroying_live_key_escrow():void {
        $this->as('alice');
        $this->postJson('/matrix/v1/recovery/ssss',$this->payload('alice'))
            ->assertCreated();
        $migration=require database_path(
            'migrations/2026_11_11_000002_create_matrix_recovery_escrows_v1.php'
        );
        try {
            $migration->down();
            $this->fail('Nonempty Matrix recovery escrow must survive rollback');
        }catch(\RuntimeException $e){
            $this->assertSame('pb3.matrix_recovery.rollback_forbidden',
                $e->getMessage());
        }
        $this->assertTrue(Schema::hasTable('matrix_recovery_escrows_v1'));
    }
}
