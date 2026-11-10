<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

final class TeamInvitationTest extends TestCase
{
    use RefreshDatabase;

    private array $accounts=[];
    private string $teamId;
    private string $teamHash;

    protected function setUp():void
    {
        parent::setUp();
        foreach(['owner','recipient','outsider'] as $role){
            $key=openssl_pkey_new([
                'private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1',
            ]);
            $pub=openssl_pkey_get_details($key)['key'];
            $spki=P::encode(base64_decode(
                preg_replace('/-----[^-]+-----|\s+/','',$pub)));
            $account=(string)Str::uuid();
            $device=(string)Str::uuid();
            $this->accounts[$role]=[
                'id'=>$account,'device'=>$device,'spki'=>$spki,'signer'=>$key,
            ];
            DB::table('identity_accounts')->insert([
                'id'=>$account,'operation_id'=>(string)Str::uuid(),
                'status'=>'ready','prepare_hash'=>str_repeat('b',64),
                'reserved_until'=>now()->addDay(),'account_spki'=>$spki,
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('identity_devices')->insert([
                'id'=>$device,'account_id'=>$account,'signing_spki'=>$spki,
                'created_at'=>now(),'updated_at'=>now(),
            ]);
        }
        $this->teamId=(string)Str::uuid();
        $this->publishKey('recipient',str_repeat('a',64));
        $this->createTeam();
    }

    private function as(string $role):void
    {
        $p=$this->accounts[$role];
        $this->withHeader('Origin','https://localhost')
            ->withSession([
                'identity_account'=>$p['id'],
                'identity_device'=>$p['device'],
                'identity_issued'=>time(),
            ]);
    }

    private function sign(string $role,string $domain,array $payload):array
    {
        $raw=json_encode($payload,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        openssl_sign($domain."\n".$raw,$der,
            $this->accounts[$role]['signer'],OPENSSL_ALGO_SHA256);
        $i=2;$pieces=[];
        for($j=0;$j<2;$j++){
            if(ord($der[$i++])!==2)throw new \RuntimeException('bad DER');
            $len=ord($der[$i++]);
            $v=substr($der,$i,$len);$i+=$len;
            $pieces[]=str_pad(ltrim($v,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return ['contract'=>$raw,'signature'=>P::encode(implode('',$pieces))];
    }

    private function publishKey(string $role,string $hash):void
    {
        DB::table('account_exchange_keys')->insert([
            'account_id'=>$this->accounts[$role]['id'],
            'descriptor'=>'test-directory-public-only',
            'account_signature'=>'fixture',
            'sealed_private'=>'{}',
            'descriptor_hash'=>$hash,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
    }

    private function createTeam():void
    {
        $this->as('owner');
        $root=[
            'version'=>1,'teamId'=>$this->teamId,
            'operationId'=>(string)Str::uuid(),
            'ownerAccountId'=>$this->accounts['owner']['id'],
            'privateEnvelope'=>[
                'version'=>1,'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(100)),
                'wrappedKey'=>[
                    'iv'=>P::encode(random_bytes(12)),
                    'ciphertext'=>P::encode(random_bytes(48)),
                ],
            ],
        ];
        $signed=$this->sign('owner','pb3.team-create.v1',$root);
        $this->teamHash=hash('sha256',$signed['contract']);
        $this->postJson('/teams/v1',$signed)->assertCreated();
    }

    private function invitation(string $role='contributor'):array
    {
        return [
            'version'=>1,
            'inviteId'=>(string)Str::uuid(),
            'operationId'=>(string)Str::uuid(),
            'teamId'=>$this->teamId,
            'ownerAccountId'=>$this->accounts['owner']['id'],
            'teamContractHash'=>$this->teamHash,
            'recipientAccountId'=>$this->accounts['recipient']['id'],
            'role'=>$role,'fileAccess'=>'none',
            'recipientKeyDigest'=>str_repeat('a',64),
            'expiresAt'=>now()->addDay()->getTimestampMs(),
            'envelope'=>[
                'ephemeralSpki'=>$this->accounts['owner']['spki'],
                'salt'=>P::encode(random_bytes(16)),
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
        ];
    }

    private function invite(?array $c=null):array
    {
        $c??=$this->invitation();
        $this->as('owner');
        $signed=$this->sign('owner','pb3.team-invite.v1',$c);
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',$signed)
            ->assertCreated()->assertJsonPath('state','pending');
        return $signed;
    }

    private function accept(string $inviteId,string $inviteHash):array
    {
        return [
            'version'=>1,'action'=>'accept','teamId'=>$this->teamId,
            'inviteId'=>$inviteId,
            'recipientAccountId'=>$this->accounts['recipient']['id'],
            'operationId'=>(string)Str::uuid(),'inviteHash'=>$inviteHash,
        ];
    }

    public function test_explicit_invite_and_signed_consent_grant_only_team_membership():void
    {
        $signed=$this->invite();
        $i=json_decode($signed['contract'],true,32,JSON_THROW_ON_ERROR);
        $url='/teams/v1/'.$this->teamId.'/invites/'.$i['inviteId'].'/accept';
        $this->as('owner');
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',$signed)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->getJson('/teams/v1/'.$this->teamId)->assertOk()
            ->assertJsonPath('memberCount',1);

        $this->getJson('/teams/v1/'.$this->teamId.'/participants')->assertOk()
            ->assertJsonPath('items.0.state','pending')
            ->assertJsonPath('items.0.recipientAccountId',
                $this->accounts['recipient']['id']);
        $this->as('recipient');
        $this->getJson('/teams/v1/'.$this->teamId.'/participants')->assertNotFound();
        $this->getJson('/teams/v1/'.$this->teamId.'/member')->assertNotFound();
        $this->getJson('/teams/v1/invites/received')->assertOk()
            ->assertJsonPath('items.0.inviteId',$i['inviteId'])
            ->assertJsonPath('items.0.role','contributor')
            ->assertJsonPath('items.0.expired',false)
            ->assertJsonPath('items.0.contract',$signed['contract']);
        $accept=$this->sign('recipient','pb3.team-accept.v1',
            $this->accept($i['inviteId'],hash('sha256',$signed['contract'])));
        $this->postJson($url,$accept)->assertCreated()
            ->assertJsonPath('state','accepted');
        $this->postJson($url,$accept)->assertOk()
            ->assertJsonPath('unchanged',true);
        $this->getJson('/teams/v1/'.$this->teamId.'/member')
            ->assertOk()->assertJsonPath('invite.inviteId',$i['inviteId'])
            ->assertJsonPath('ownerAccountId',$this->accounts['owner']['id']);
        $this->assertDatabaseHas('team_members_v1',[
            'team_id'=>$this->teamId,
            'account_id'=>$this->accounts['recipient']['id'],
            'role'=>'contributor','state'=>'active',
        ]);
        // No implicit assignment/media/photo grants, and no assignment consent.
        $this->assertDatabaseCount('assignment_invites_v1',0);
        $this->assertDatabaseCount('photo_access_grants',0);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
        $this->as('owner');
        $this->getJson('/teams/v1/'.$this->teamId.'/participants')->assertOk()
            ->assertJsonPath('items.0.state','accepted')
            ->assertJsonPath('items.0.acceptedContract',$accept['contract']);
        $this->getJson('/teams/v1/'.$this->teamId)->assertOk()
            ->assertJsonPath('memberCount',2);
        $this->as('outsider');
        $this->getJson('/teams/v1/invites/received')
            ->assertOk()->assertJsonCount(0,'items');
        $this->getJson('/teams/v1/'.$this->teamId.'/member')->assertNotFound();
        $this->postJson($url,$accept)->assertUnauthorized();
    }

    public function test_unauthorized_scopes_untrusted_keys_and_replayed_id_conflict():void
    {
        $this->as('owner');
        $c=$this->invitation();
        $bad=$c;$bad['fileAccess']='full';
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',
            $this->sign('owner','pb3.team-invite.v1',$bad))
            ->assertUnprocessable();
        $bad=$c;$bad['role']='owner';
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',
            $this->sign('owner','pb3.team-invite.v1',$bad))
            ->assertUnprocessable();
        $bad=$c;$bad['teamContractHash']=str_repeat('b',64);
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',
            $this->sign('owner','pb3.team-invite.v1',$bad))
            ->assertConflict();
        $bad=$c;$bad['recipientKeyDigest']=str_repeat('b',64);
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',
            $this->sign('owner','pb3.team-invite.v1',$bad))
            ->assertConflict();
        $bad=$c;$bad['recipientAccountId']=$this->accounts['owner']['id'];
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',
            $this->sign('owner','pb3.team-invite.v1',$bad))
            ->assertUnprocessable();
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',
            $this->sign('owner','pb3.assignment-invite.v1',$c))
            ->assertUnauthorized();
        $signed=$this->invite($c);
        $this->as('owner');
        $mutated=$c;$mutated['role']='viewer';
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',
            $this->sign('owner','pb3.team-invite.v1',$mutated))
            ->assertConflict();
        $other=$c;$other['inviteId']=(string)Str::uuid();
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',
            $this->sign('owner','pb3.team-invite.v1',$other))
            ->assertConflict();

        $this->as('recipient');
        $payload=$this->accept($c['inviteId'],str_repeat('b',64));
        $url='/teams/v1/'.$this->teamId.'/invites/'.$c['inviteId'].'/accept';
        $this->postJson($url,$this->sign('recipient','pb3.team-accept.v1',$payload))
            ->assertConflict();
        $payload['inviteHash']=hash('sha256',$signed['contract']);
        $this->postJson($url,$this->sign('recipient','pb3.assignment-accept.v1',$payload))
            ->assertUnauthorized();
        $this->assertDatabaseCount('team_members_v1',1);
    }

    public function test_expired_invite_or_changed_recipient_key_cannot_be_accepted():void
    {
        $signed=$this->invite();
        $c=json_decode($signed['contract'],true,32,JSON_THROW_ON_ERROR);
        $this->as('recipient');
        $url='/teams/v1/'.$this->teamId.'/invites/'.$c['inviteId'].'/accept';
        $accept=$this->sign('recipient','pb3.team-accept.v1',
            $this->accept($c['inviteId'],hash('sha256',$signed['contract'])));
        DB::table('account_exchange_keys')
            ->where('account_id',$this->accounts['recipient']['id'])
            ->update(['descriptor_hash'=>str_repeat('b',64)]);
        $this->postJson($url,$accept)->assertConflict();
        DB::table('account_exchange_keys')
            ->where('account_id',$this->accounts['recipient']['id'])
            ->update(['descriptor_hash'=>str_repeat('a',64)]);
        DB::table('team_invites_v1')->where('id',$c['inviteId'])
            ->update(['expires_at'=>now()->subMinute()->getTimestampMs()]);
        $this->postJson($url,$accept)->assertConflict();
        $this->assertDatabaseCount('team_members_v1',1);
    }


    private function acceptedRecipient():array
    {
        $signed=$this->invite();
        $invite=json_decode($signed['contract'],true,32,JSON_THROW_ON_ERROR);
        $accept=$this->sign('recipient','pb3.team-accept.v1',$this->accept(
            $invite['inviteId'],hash('sha256',$signed['contract'])));
        $this->as('recipient');
        $this->postJson('/teams/v1/'.$this->teamId
            .'/invites/'.$invite['inviteId'].'/accept',$accept)->assertCreated();
        return $invite;
    }

    private function membershipEvent(string $action,array $invite,
        string $currentRole='contributor',?string $nextRole=null,
        int $fromRevision=1):array
    {
        return [
            'version'=>1,'operationId'=>(string)Str::uuid(),
            'teamId'=>$this->teamId,
            'ownerAccountId'=>$this->accounts['owner']['id'],
            'inviteId'=>$invite['inviteId'],
            'targetAccountId'=>$this->accounts['recipient']['id'],
            'action'=>$action,'previousRole'=>$currentRole,
            'nextRole'=>$nextRole,'fromRevision'=>$fromRevision,
            'toRevision'=>$fromRevision+1,
        ];
    }

    private function changeMember(array $contract):array
    {
        $this->as('owner');
        $signed=$this->sign('owner','pb3.team-membership.v1',$contract);
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',$signed)
            ->assertCreated()
            ->assertJsonPath('membershipRevision',$contract['toRevision']);
        return $signed;
    }

    public function test_signed_role_change_uses_revision_and_does_not_grant_files():void
    {
        $invite=$this->acceptedRecipient();
        $this->as('owner');
        $payload=$this->membershipEvent('change_role',$invite,'contributor','viewer');
        $signed=$this->changeMember($payload);
        $this->assertDatabaseHas('team_members_v1',[
            'team_id'=>$this->teamId,
            'account_id'=>$this->accounts['recipient']['id'],
            'state'=>'active','role'=>'viewer',
        ]);
        $this->getJson('/teams/v1/'.$this->teamId.'/participants')
            ->assertOk()->assertJsonPath('items.0.role','contributor')
            ->assertJsonPath('items.0.effectiveRole','viewer');
        $this->getJson('/teams/v1/'.$this->teamId.'/membership-status')
            ->assertOk()->assertJsonPath('membershipRevision',2)
            ->assertJsonPath('rotationRequired',false);
        $this->getJson('/teams/v1/'.$this->teamId.'/membership-history')
            ->assertOk()->assertJsonPath('items.0.contract',$signed['contract'])
            ->assertJsonPath('items.0.signature',$signed['signature']);
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',$signed)
            ->assertOk()->assertJsonPath('unchanged',true);
        $altered=$payload;$altered['nextRole']='curator';
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',
            $this->sign('owner','pb3.team-membership.v1',$altered))
            ->assertConflict();
        $stale=$this->membershipEvent('change_role',$invite,'viewer','curator');
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',
            $this->sign('owner','pb3.team-membership.v1',$stale))
            ->assertConflict();
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',
            $this->sign('owner','pb3.assignment-state.v1',$payload))
            ->assertUnauthorized();
        $this->assertDatabaseCount('photo_access_grants',0);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
        $this->assertDatabaseCount('assignment_invites_v1',0);
        $this->as('recipient');
        $this->getJson('/teams/v1/'.$this->teamId.'/member')->assertOk();
        $this->getJson('/teams/v1/'.$this->teamId.'/membership-history')->assertNotFound();
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',$signed)->assertUnauthorized();
    }

    public function test_member_removal_immediately_revokes_acl_and_quarantines_old_dek():void
    {
        $invite=$this->acceptedRecipient();
        $change=$this->membershipEvent('remove',$invite);
        $signed=$this->changeMember($change);
        $this->assertDatabaseHas('team_members_v1',[
            'team_id'=>$this->teamId,
            'account_id'=>$this->accounts['recipient']['id'],
            'role'=>'contributor','state'=>'revoked',
        ]);
        $this->assertDatabaseHas('team_invites_v1',[
            'id'=>$invite['inviteId'],'state'=>'revoked',
        ]);
        $this->getJson('/teams/v1/'.$this->teamId.'/membership-status')
            ->assertOk()->assertJsonPath('rotationRequired',true);
        $this->getJson('/teams/v1/'.$this->teamId)->assertOk()
            ->assertJsonPath('memberCount',1)
            ->assertJsonPath('rotationRequired',true);
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',$signed)
            ->assertOk()->assertJsonPath('unchanged',true);
        $another=$this->membershipEvent('change_role',$invite,'contributor','viewer',2);
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',
            $this->sign('owner','pb3.team-membership.v1',$another))
            ->assertConflict();
        $next=$this->invitation('viewer');
        $this->postJson('/teams/v1/'.$this->teamId.'/invites',
            $this->sign('owner','pb3.team-invite.v1',$next))
            ->assertConflict();
        $this->as('recipient');
        $this->getJson('/teams/v1/'.$this->teamId.'/member')->assertNotFound();
        $this->getJson('/teams/v1/invites/received')->assertOk()
            ->assertJsonPath('items.0.state','revoked');
        $this->assertDatabaseCount('team_membership_events_v1',1);
        $this->assertDatabaseCount('photo_access_grants',0);
    }

    public function test_surviving_member_is_denied_old_team_dek_until_new_epoch():void
    {
        $first=$this->acceptedRecipient();
        $this->publishKey('outsider',str_repeat('c',64));
        $other=$this->invitation('viewer');
        $other['recipientAccountId']=$this->accounts['outsider']['id'];
        $other['recipientKeyDigest']=str_repeat('c',64);
        $signed=$this->invite($other);
        $this->as('outsider');
        $accept=[
            'version'=>1,'action'=>'accept','inviteId'=>$other['inviteId'],
            'teamId'=>$this->teamId,
            'recipientAccountId'=>$this->accounts['outsider']['id'],
            'operationId'=>(string)Str::uuid(),
            'inviteHash'=>hash('sha256',$signed['contract']),
        ];
        $this->postJson('/teams/v1/'.$this->teamId.'/invites/'
            .$other['inviteId'].'/accept',
            $this->sign('outsider','pb3.team-accept.v1',$accept))->assertCreated();
        $this->getJson('/teams/v1/'.$this->teamId.'/member')->assertOk();
        $this->changeMember($this->membershipEvent('remove',$first));
        $this->as('outsider');
        // An accepted, still active survivor must not receive the known old
        // DEK; explicit new epoch publication is needed for EVERY survivor.
        $this->assertDatabaseHas('team_members_v1',[
            'team_id'=>$this->teamId,
            'account_id'=>$this->accounts['outsider']['id'],
            'state'=>'active','role'=>'viewer',
        ]);
        $this->getJson('/teams/v1/'.$this->teamId.'/member')->assertConflict();
        $this->assertDatabaseCount('photo_access_grants',0);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
    }

    public function test_pending_invite_can_be_revoked_before_any_consent():void
    {
        $signed=$this->invite();
        $invite=json_decode($signed['contract'],true,32,JSON_THROW_ON_ERROR);
        $this->changeMember($this->membershipEvent('remove',$invite));
        $this->assertDatabaseCount('team_members_v1',1);
        $this->as('recipient');
        $accept=$this->sign('recipient','pb3.team-accept.v1',
            $this->accept($invite['inviteId'],hash('sha256',$signed['contract'])));
        $this->postJson('/teams/v1/'.$this->teamId
            .'/invites/'.$invite['inviteId'].'/accept',$accept)->assertConflict();
        $this->getJson('/teams/v1/'.$this->teamId.'/member')->assertNotFound();
        $this->assertDatabaseCount('team_membership_events_v1',1);
    }

    public function test_owner_identity_and_transition_invariants_cannot_be_forged():void
    {
        $invite=$this->acceptedRecipient();
        $this->as('owner');
        $payload=$this->membershipEvent('change_role',$invite,'contributor','viewer');
        $bad=$payload;$bad['targetAccountId']=$this->accounts['owner']['id'];
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',
            $this->sign('owner','pb3.team-membership.v1',$bad))
            ->assertUnprocessable();
        $bad=$payload;$bad['toRole']='owner';
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',
            $this->sign('owner','pb3.team-membership.v1',$bad))
            ->assertUnprocessable();
        $bad=$payload;$bad['fromRevision']=0;$bad['toRevision']=1;
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',
            $this->sign('owner','pb3.team-membership.v1',$bad))
            ->assertUnprocessable();
        $bad=$payload;$bad['previousRole']='curator';
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',
            $this->sign('owner','pb3.team-membership.v1',$bad))
            ->assertConflict();
        $this->assertDatabaseCount('team_membership_events_v1',0);
    }

    public function test_signed_member_history_blocks_destructive_downgrade():void
    {
        $invite=$this->acceptedRecipient();
        $this->changeMember($this->membershipEvent('remove',$invite));
        $migration=require database_path(
            'migrations/2026_11_10_000009_team_membership_revision_v1.php');
        try{
            $migration->down();
            $this->fail('Membership history downgrade must be refused.');
        }catch(\RuntimeException $e){
            $this->assertSame('pb3.team_membership.rollback_forbidden',$e->getMessage());
        }
        $this->assertTrue(Schema::hasColumn('team_records_v1','rotation_required'));
        $this->assertTrue(Schema::hasTable('team_membership_events_v1'));
        $this->assertDatabaseCount('team_membership_events_v1',1);
    }

    public function test_nonempty_signed_invite_history_blocks_downgrade():void
    {
        $this->invite();
        $migration=require database_path(
            'migrations/2026_11_10_000008_create_team_invites_v1.php');
        try{
            $migration->down();
            $this->fail('Signed team history must never be silently removed.');
        }catch(\RuntimeException $e){
            $this->assertSame('pb3.team_invites.rollback_forbidden',$e->getMessage());
        }
        $this->assertTrue(Schema::hasTable('team_invites_v1'));
        $this->assertDatabaseCount('team_invites_v1',1);
    }
}
