<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

final class TeamKeyEpochTest extends TestCase
{
    use RefreshDatabase;
    private array $accounts=[];
    private string $teamId;
    private string $rootHash;

    protected function setUp():void
    {
        parent::setUp();
        foreach(['owner','alice','bob','stranger'] as $role){
            $key=openssl_pkey_new([
                'private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1',
            ]);
            $pub=openssl_pkey_get_details($key)['key'];
            $spki=P::encode(base64_decode(
                preg_replace('/-----[^-]+-----|\s+/','',$pub)));
            $id=(string)Str::uuid();
            $device=(string)Str::uuid();
            $this->accounts[$role]=['id'=>$id,'device'=>$device,
                'spki'=>$spki,'signer'=>$key];
            DB::table('identity_accounts')->insert([
                'id'=>$id,'operation_id'=>(string)Str::uuid(),
                'status'=>'ready','prepare_hash'=>str_repeat('c',64),
                'reserved_until'=>now()->addDay(),'account_spki'=>$spki,
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('identity_devices')->insert([
                'id'=>$device,'account_id'=>$id,'signing_spki'=>$spki,
                'created_at'=>now(),'updated_at'=>now(),
            ]);
        }
        $this->teamId=(string)Str::uuid();
        $this->loginAs('owner');
        $root=[
            'version'=>1,'teamId'=>$this->teamId,
            'operationId'=>(string)Str::uuid(),
            'ownerAccountId'=>$this->accounts['owner']['id'],
            'privateEnvelope'=>self::profile(),
        ];
        $signed=$this->signed('owner','pb3.team-create.v1',$root);
        $this->rootHash=hash('sha256',$signed['contract']);
        $this->postJson('/teams/v1',$signed)->assertCreated();
        foreach(['alice'=>'contributor','bob'=>'viewer'] as $r=>$role){
            $this->joinMember($r,$role);
        }
    }

    private function loginAs(string $who):void
    {
        $account=$this->accounts[$who];
        $this->withHeader('Origin','https://localhost')->withSession([
            'identity_account'=>$account['id'],
            'identity_device'=>$account['device'],
            'identity_issued'=>time(),
        ]);
    }

    private function signed(string $who,string $domain,array $payload):array
    {
        $raw=json_encode($payload,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        openssl_sign($domain."\n".$raw,$der,
            $this->accounts[$who]['signer'],OPENSSL_ALGO_SHA256);
        $cursor=2;$pieces=[];
        for($i=0;$i<2;$i++){
            if(ord($der[$cursor++])!==2)throw new \RuntimeException('bad DER');
            $length=ord($der[$cursor++]);
            $part=substr($der,$cursor,$length);
            $cursor+=$length;
            $pieces[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return ['contract'=>$raw,'signature'=>P::encode(implode('',$pieces))];
    }

    private static function profile():array
    {
        return ['version'=>1,'iv'=>P::encode(random_bytes(12)),
            'ciphertext'=>P::encode(random_bytes(130)),
            'wrappedKey'=>[
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
        ];
    }

    private function joinMember(string $who,string $role):void
    {
        $id=$this->accounts[$who]['id'];
        DB::table('account_exchange_keys')->insert([
            'account_id'=>$id,'descriptor'=>'fake-crypto-public',
            'account_signature'=>'fake','sealed_private'=>'{}',
            'descriptor_hash'=>str_repeat($who==='alice'?'a':'b',64),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('team_members_v1')->insert([
            'team_id'=>$this->teamId,'account_id'=>$id,
            'role'=>$role,'state'=>'active',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
    }

    private function quarantined():void
    {
        DB::table('team_members_v1')
            ->where('team_id',$this->teamId)
            ->where('account_id',$this->accounts['bob']['id'])
            ->update(['state'=>'revoked']);
        DB::table('team_records_v1')->where('id',$this->teamId)
            ->update(['rotation_required'=>true,'membership_revision'=>2]);
    }

    private function recipient(string $role):array
    {
        $who=$role==='contributor'?'alice':'bob';
        return [
            'accountId'=>$this->accounts[$who]['id'],
            'role'=>$role,
            'recipientKeyDigest'=>str_repeat($who==='alice'?'a':'b',64),
            'envelope'=>[
                'ephemeralSpki'=>$this->accounts['owner']['spki'],
                'salt'=>P::encode(random_bytes(16)),
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
        ];
    }

    private function epoch(?array $recipients=null):array
    {
        return [
            'version'=>1,'operationId'=>(string)Str::uuid(),
            'teamId'=>$this->teamId,
            'ownerAccountId'=>$this->accounts['owner']['id'],
            'fromEpoch'=>1,'toEpoch'=>2,'membershipRevision'=>2,
            'previousEpochHash'=>$this->rootHash,
            'privateEnvelope'=>self::profile(),
            'recipients'=>$recipients??[$this->recipient('contributor')],
            'retiredPendingInviteIds'=>[],
        ];
    }

    public function test_atomic_epoch_rotation_stops_revoked_member_and_exact_replay():void
    {
        $this->quarantined();
        $this->loginAs('bob');
        $this->getJson('/teams/v1/'.$this->teamId.'/epoch/member')->assertNotFound();
        $this->loginAs('alice');
        $this->getJson('/teams/v1/'.$this->teamId.'/epoch/member')->assertConflict();
        $this->loginAs('owner');
        $c=$this->epoch();
        $signed=$this->signed('owner','pb3.team-key-epoch.v1',$c);
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',$signed)
            ->assertCreated()->assertJsonPath('keyEpoch',2);
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',$signed)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->getJson('/teams/v1/'.$this->teamId.'/epoch/owner')
            ->assertOk()->assertJsonPath('keyEpoch',2)
            ->assertJsonPath('rotationRequired',false)
            ->assertJsonPath('contract',$signed['contract']);
        $this->assertDatabaseCount('team_epoch_grants_v1',1);
        $this->assertDatabaseHas('team_epoch_grants_v1',[
            'team_id'=>$this->teamId,'epoch'=>2,
            'recipient_account_id'=>$this->accounts['alice']['id'],
        ]);
        $this->assertDatabaseCount('team_key_epochs_v1',1);
        $this->loginAs('alice');
        $this->getJson('/teams/v1/'.$this->teamId.'/epoch/member')
            ->assertOk()->assertJsonPath('keyEpoch',2)
            ->assertJsonPath('effectiveRole','contributor')
            ->assertJsonPath('contract',$signed['contract'])
            ->assertJsonPath('recipient.accountId',$this->accounts['alice']['id']);
        $this->getJson('/teams/v1/'.$this->teamId.'/member')->assertConflict();
        $this->loginAs('bob');
        $this->getJson('/teams/v1/'.$this->teamId.'/epoch/member')->assertNotFound();
        $this->getJson('/teams/v1/'.$this->teamId.'/member')->assertNotFound();
        $this->loginAs('owner');
        $this->assertDatabaseCount('photo_access_grants',0);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
        $this->assertDatabaseCount('assignment_invites_v1',0);
    }

    public function test_roster_exclusion_role_digest_revision_and_root_hash_fail_closed():void
    {
        $this->quarantined();
        $this->loginAs('owner');
        $bad=$this->epoch([]);
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$bad))
            ->assertConflict();
        $unexpected=[$this->recipient('contributor'),$this->recipient('viewer')];
        usort($unexpected,static fn($a,$b)=>strcmp($a['accountId'],$b['accountId']));
        $bad=$this->epoch($unexpected);
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$bad))
            ->assertConflict();
        $bad=$this->epoch();$bad['recipients'][0]['role']='viewer';
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$bad))
            ->assertConflict();
        $bad=$this->epoch();$bad['recipients'][0]['recipientKeyDigest']=str_repeat('f',64);
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$bad))
            ->assertConflict();
        $bad=$this->epoch();$bad['previousEpochHash']=str_repeat('f',64);
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$bad))
            ->assertConflict();
        $bad=$this->epoch();$bad['membershipRevision']=1;
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$bad))
            ->assertUnprocessable();
        $bad=$this->epoch();
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.assignment-invite.v1',$bad))
            ->assertUnauthorized();
        $this->assertDatabaseCount('team_key_epochs_v1',0);
        $this->assertDatabaseCount('team_epoch_grants_v1',0);
        $this->getJson('/teams/v1/'.$this->teamId.'/epoch/owner')
            ->assertOk()->assertJsonPath('rotationRequired',true)
            ->assertJsonPath('keyEpoch',1);
    }

    public function test_cannot_rotate_without_quarantine_or_with_wrong_actor():void
    {
        $signed=$this->signed('owner','pb3.team-key-epoch.v1',$this->epoch());
        $this->loginAs('owner');
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',$signed)->assertConflict();
        $this->quarantined();
        $this->loginAs('alice');
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',$signed)->assertUnauthorized();
        $this->getJson('/teams/v1/'.$this->teamId.'/epoch/owner')->assertNotFound();
        $this->loginAs('stranger');
        $this->getJson('/teams/v1/'.$this->teamId.'/epoch/member')->assertNotFound();
        $this->getJson('/teams/v1/'.$this->teamId.'/epoch/owner')->assertNotFound();
    }

    public function test_nonempty_epoch_evidence_prevents_destructive_downgrade():void
    {
        $this->quarantined();
        $this->loginAs('owner');
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$this->epoch()))
            ->assertCreated();
        $migration=require database_path(
            'migrations/2026_11_10_000010_team_key_epochs_v1.php');
        try{$migration->down();$this->fail('Must not erase key epochs.');}
        catch(\RuntimeException $e){
            $this->assertSame('pb3.team_epochs.rollback_forbidden',$e->getMessage());
        }
        $this->assertTrue(Schema::hasTable('team_key_epochs_v1'));
        $this->assertDatabaseCount('team_key_epochs_v1',1);
        $this->assertDatabaseCount('team_epoch_grants_v1',1);
    }
}
