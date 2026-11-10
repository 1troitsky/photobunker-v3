<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class TeamV1Test extends TestCase
{
    use RefreshDatabase;
    private array $accounts=[];

    protected function setUp():void
    {
        parent::setUp();
        foreach(['owner','outsider'] as $role){
            $key=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,
                'curve_name'=>'prime256v1']);
            $details=openssl_pkey_get_details($key);
            $spki=P::encode(base64_decode(
                preg_replace('/-----[^-]+-----|\s+/','',$details['key'])));
            $id=(string)Str::uuid();
            $device=(string)Str::uuid();
            $this->accounts[$role]=['id'=>$id,'device'=>$device,'key'=>$key];
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
        }
    }

    private function as(string $role):void
    {
        $p=$this->accounts[$role];
        $this->withHeader('Origin','https://localhost')
            ->withSession(['identity_account'=>$p['id'],
                'identity_device'=>$p['device'],'identity_issued'=>time()]);
    }

    private function signed(string $role,array $c,string $domain='pb3.team-create.v1'):array
    {
        $json=json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        openssl_sign($domain."\n".$json,$der,$this->accounts[$role]['key'],
            OPENSSL_ALGO_SHA256);
        $i=2;$parts=[];
        foreach([0,1] as $_){
            if(ord($der[$i++])!==2)throw new \RuntimeException('bad test DER');
            $len=ord($der[$i++]);$part=substr($der,$i,$len);$i+=$len;
            $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return ['contract'=>$json,'signature'=>P::encode(implode('',$parts))];
    }

    private function contract(string $role):array
    {
        return [
            'version'=>1,
            'teamId'=>(string)Str::uuid(),
            'operationId'=>(string)Str::uuid(),
            'ownerAccountId'=>$this->accounts[$role]['id'],
            'privateEnvelope'=>[
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(100)),
            ],
        ];
    }

    public function test_signed_encrypted_create_is_idempotent_and_owner_only():void
    {
        $this->as('owner');
        $body=$this->signed('owner',$this->contract('owner'));
        $id=json_decode($body['contract'],true)['teamId'];
        $this->postJson('/teams/v1',$body)->assertCreated()
            ->assertJsonPath('unchanged',false);
        $this->postJson('/teams/v1',$body)->assertOk()
            ->assertJsonPath('unchanged',true);
        $this->getJson('/teams/v1')->assertOk()
            ->assertJsonPath('items.0.teamId',$id)
            ->assertJsonPath('items.0.memberCount',1);
        $this->getJson('/teams/v1/'.$id)->assertOk()
            ->assertJsonPath('teamId',$id);
        $this->assertDatabaseHas('team_members_v1',[
            'team_id'=>$id,'account_id'=>$this->accounts['owner']['id'],
            'role'=>'owner','state'=>'active',
        ]);
        $this->assertDatabaseCount('team_records_v1',1);
        $this->assertDatabaseCount('assignment_records_v1',0);
        $this->assertDatabaseCount('photo_access_grants',0);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);

        $this->as('outsider');
        $this->getJson('/teams/v1')->assertOk()->assertJsonCount(0,'items');
        $this->getJson('/teams/v1/'.$id)->assertNotFound();
        $this->postJson('/teams/v1',$body)->assertUnauthorized();
    }

    public function test_replay_conflicts_tampered_signatures_and_cross_account_id():void
    {
        $this->as('owner');
        $c=$this->contract('owner');
        $this->postJson('/teams/v1',$this->signed('owner',$c))->assertCreated();
        $changed=$c;$changed['privateEnvelope']['ciphertext']=P::encode(random_bytes(100));
        $this->postJson('/teams/v1',$this->signed('owner',$changed))
            ->assertConflict();
        $other=$c;$other['teamId']=(string)Str::uuid();
        $this->postJson('/teams/v1',$this->signed('owner',$other))
            ->assertConflict();
        $this->postJson('/teams/v1',$this->signed('owner',$this->contract('owner'),
            'pb3.assignment.v1'))->assertUnauthorized();
        $forged=$this->signed('owner',$this->contract('owner'));
        $forged['signature']=P::encode(random_bytes(64));
        $this->postJson('/teams/v1',$forged)->assertUnauthorized();
        $wrong=$this->contract('outsider');
        $this->postJson('/teams/v1',$this->signed('owner',$wrong))->assertUnprocessable();
        $this->assertDatabaseCount('team_records_v1',1);
    }

    public function test_privacy_shape_and_bounded_owner_pagination():void
    {
        // Isolate pagination from the separately enforced production rate limit.
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->as('owner');
        for($i=0;$i<51;$i++){
            $this->postJson('/teams/v1',$this->signed('owner',
                $this->contract('owner')))->assertCreated();
        }
        $first=$this->getJson('/teams/v1')->assertOk()->json();
        $this->assertCount(50,$first['items']);
        $this->assertIsString($first['nextCursor']);
        $second=$this->getJson('/teams/v1?after='.$first['nextCursor'])->assertOk()->json();
        $this->assertCount(1,$second['items']);
        $this->assertNull($second['nextCursor']);
        $this->getJson('/teams/v1?after=invalid')->assertUnprocessable();
        $this->assertDatabaseCount('team_members_v1',51);
    }
}
