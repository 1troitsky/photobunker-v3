<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

final class TeamEpochInvitationTest extends TestCase
{
    use RefreshDatabase;
    private array $users=[];
    private string $teamId;
    private string $rootHash;
    private string $epochHash;
    private string $epochContract;
    private string $epochSignature;

    protected function setUp():void
    {
        parent::setUp();
        foreach(['owner','guest','stranger'] as $who){
            $key=openssl_pkey_new([
                'private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1',
            ]);
            $pub=openssl_pkey_get_details($key)['key'];
            $spki=P::encode(base64_decode(
                preg_replace('/-----[^-]+-----|\s+/','',$pub)));
            $account=(string)Str::uuid();
            $device=(string)Str::uuid();
            $this->users[$who]=[
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
        $root=[
            'version'=>1,'teamId'=>$this->teamId,
            'operationId'=>(string)Str::uuid(),
            'ownerAccountId'=>$this->users['owner']['id'],
            'privateEnvelope'=>self::profile(),
        ];
        $rootSigned=$this->signed('owner','pb3.team-create.v1',$root);
        $this->rootHash=hash('sha256',$rootSigned['contract']);
        $epoch=[
            'version'=>1,'operationId'=>(string)Str::uuid(),
            'teamId'=>$this->teamId,'ownerAccountId'=>$this->users['owner']['id'],
            'fromEpoch'=>1,'toEpoch'=>2,'membershipRevision'=>2,
            'previousEpochHash'=>$this->rootHash,
            'privateEnvelope'=>self::profile(),'recipients'=>[],
            'retiredPendingInviteIds'=>[],
        ];
        $signed=$this->signed('owner','pb3.team-key-epoch.v1',$epoch);
        $this->epochContract=$signed['contract'];
        $this->epochSignature=$signed['signature'];
        $this->epochHash=hash('sha256',$this->epochContract);
        DB::table('team_records_v1')->insert([
            'id'=>$this->teamId,'owner_account_id'=>$this->users['owner']['id'],
            'operation_id'=>$root['operationId'],
            'contract_hash'=>$this->rootHash,
            'contract_json'=>$rootSigned['contract'],
            'owner_signature'=>$rootSigned['signature'],
            'state'=>'active','membership_revision'=>2,
            'key_epoch'=>2,'rotation_required'=>false,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('team_members_v1')->insert([
            'team_id'=>$this->teamId,
            'account_id'=>$this->users['owner']['id'],
            'role'=>'owner','state'=>'active',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('team_key_epochs_v1')->insert([
            'team_id'=>$this->teamId,'epoch'=>2,
            'operation_id'=>$epoch['operationId'],
            'membership_revision'=>2,'previous_epoch_hash'=>$this->rootHash,
            'contract_hash'=>$this->epochHash,
            'contract_json'=>$this->epochContract,
            'owner_signature'=>$this->epochSignature,
            'recipient_count'=>0,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('account_exchange_keys')->insert([
            'account_id'=>$this->users['guest']['id'],
            'descriptor'=>'test-key-directory-public',
            'account_signature'=>'signed', 'sealed_private'=>'{}',
            'descriptor_hash'=>str_repeat('a',64),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
    }

    private function login(string $who):void
    {
        $user=$this->users[$who];
        $this->withHeader('Origin','https://localhost')->withSession([
            'identity_account'=>$user['id'],
            'identity_device'=>$user['device'],
            'identity_issued'=>time(),
        ]);
    }

    private function signed(string $who,string $domain,array $contract):array
    {
        $raw=json_encode($contract,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        openssl_sign($domain."\n".$raw,$der,
            $this->users[$who]['signer'],OPENSSL_ALGO_SHA256);
        $cursor=2;$parts=[];
        for($i=0;$i<2;$i++){
            if(ord($der[$cursor++])!==2)throw new \RuntimeException('invalid DER');
            $length=ord($der[$cursor++]);
            $part=substr($der,$cursor,$length);
            $cursor+=$length;
            $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return ['contract'=>$raw,'signature'=>P::encode(implode('',$parts))];
    }

    private static function profile():array
    {
        return [
            'version'=>1,'iv'=>P::encode(random_bytes(12)),
            'ciphertext'=>P::encode(random_bytes(125)),
            'wrappedKey'=>[
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
        ];
    }

    private function invite(array $changes=[]):array
    {
        return array_replace([
            'version'=>2,'inviteId'=>(string)Str::uuid(),
            'operationId'=>(string)Str::uuid(),
            'teamId'=>$this->teamId,
            'ownerAccountId'=>$this->users['owner']['id'],
            'rootContractHash'=>$this->rootHash,
            'keyEpoch'=>2,'keyEpochHash'=>$this->epochHash,
            'membershipRevision'=>2,
            'recipientAccountId'=>$this->users['guest']['id'],
            'role'=>'viewer','fileAccess'=>'none',
            'recipientKeyDigest'=>str_repeat('a',64),
            'expiresAt'=>now()->addDay()->getTimestampMs(),
            'envelope'=>[
                'ephemeralSpki'=>$this->users['owner']['spki'],
                'salt'=>P::encode(random_bytes(16)),
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
        ],$changes);
    }

    private function postInvite(array $c):array
    {
        $this->login('owner');
        $signed=$this->signed('owner','pb3.team-invite.v2',$c);
        $this->postJson('/teams/v2/'.$this->teamId.'/invites',$signed)
            ->assertCreated()->assertJsonPath('state','pending')
            ->assertJsonPath('keyEpoch',2);
        return $signed;
    }

    private function consent(array $invite,string $digest):array
    {
        return [
            'version'=>2,'action'=>'accept','inviteId'=>$invite['inviteId'],
            'teamId'=>$this->teamId,
            'recipientAccountId'=>$this->users['guest']['id'],
            'operationId'=>(string)Str::uuid(),'inviteHash'=>$digest,
            'keyEpoch'=>2,'keyEpochHash'=>$this->epochHash,
        ];
    }

    public function test_signed_team_epoch_invitation_notification_is_recipient_scoped_and_revoked_on_rotation():void
    {
        $invite=$this->invite();
        $signed=$this->postInvite($invite);
        $guest=$this->users['guest']['id'];
        $row=DB::table('notification_event_ledger_v1')
            ->where('account_id',$guest)
            ->where('subject_type','team_invite_v2')
            ->where('subject_id',$invite['inviteId'])->first();
        $this->assertNotNull($row);
        $this->assertSame('sequenced',$row->admission_state);
        // Signed replay must not append another event or alter recipient.
        $this->postJson('/teams/v2/'.$this->teamId.'/invites',$signed)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->assertSame(1,DB::table('notification_event_ledger_v1')
            ->where('account_id',$guest)->count());
        $target='/notifications/v1/events/'.$row->event_id.'/target';
        $this->getJson($target)->assertNotFound(); // owner
        $this->login('stranger');
        $this->getJson($target)->assertNotFound();
        $this->login('guest');
        $this->getJson('/notifications/v1/events')->assertOk()
            ->assertJsonCount(1,'items')
            ->assertJsonPath('items.0.kind','team-invite')
            ->assertJsonPath('items.0.targetId',$invite['inviteId']);
        $this->getJson($target)->assertOk()
            ->assertJsonPath('kind','team-invite')
            ->assertJsonPath('targetId',$invite['inviteId']);
        // Epoch drift disallows the stale envelope without touching the
        // immutable event audit history or signed invitation contract.
        DB::table('team_records_v1')->where('id',$this->teamId)
            ->update(['rotation_required'=>true]);
        $this->getJson($target)->assertNotFound();
        $this->getJson('/notifications/v1/events')->assertOk()
            ->assertJsonCount(0,'items');
        DB::table('team_records_v1')->where('id',$this->teamId)
            ->update(['rotation_required'=>false,'key_epoch'=>3]);
        $this->getJson($target)->assertNotFound();
        $this->assertDatabaseHas('notification_event_ledger_v1',[
            'account_id'=>$guest,'event_id'=>$row->event_id,
        ]);
    }

    public function test_team_notification_expiry_and_revoked_state_fail_closed():void
    {
        $invite=$this->invite();
        $this->postInvite($invite);
        $row=DB::table('notification_event_ledger_v1')
            ->where('subject_id',$invite['inviteId'])->first();
        $target='/notifications/v1/events/'.$row->event_id.'/target';
        $this->login('guest');
        $this->getJson($target)->assertOk();
        DB::table('team_invites_v2')->where('id',$invite['inviteId'])
            ->update(['expires_at'=>now()->subSecond()->getTimestampMs()]);
        $this->getJson($target)->assertNotFound();
        DB::table('team_invites_v2')->where('id',$invite['inviteId'])
            ->update(['expires_at'=>now()->addHour()->getTimestampMs(),'state'=>'revoked']);
        $this->getJson($target)->assertNotFound();
        $this->getJson('/notifications/v1/events')->assertOk()
            ->assertJsonCount(0,'items');
    }

    public function test_v2_invite_and_explicit_consent_allow_new_epoch_member_only():void
    {
        $invite=$this->invite();
        $signed=$this->postInvite($invite);
        $this->postJson('/teams/v2/'.$this->teamId.'/invites',$signed)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->getJson('/teams/v2/'.$this->teamId.'/participants')
            ->assertOk()->assertJsonPath('items.0.state','pending');
        $this->login('guest');
        $this->getJson('/teams/v2/'.$this->teamId.'/member')->assertNotFound();
        $this->getJson('/teams/v2/'.$this->teamId.'/participants')->assertNotFound();
        $this->getJson('/teams/v2/invites/received')
            ->assertOk()->assertJsonPath('items.0.state','pending')
            ->assertJsonPath('items.0.keyEpoch',2);
        $accept=$this->signed('guest','pb3.team-accept.v2',$this->consent(
            $invite,hash('sha256',$signed['contract'])));
        $url='/teams/v2/'.$this->teamId.'/invites/'.$invite['inviteId'].'/accept';
        $this->postJson($url,$accept)->assertCreated()
            ->assertJsonPath('state','accepted');
        $this->postJson($url,$accept)->assertOk()
            ->assertJsonPath('unchanged',true);
        $this->getJson('/teams/v2/'.$this->teamId.'/member')
            ->assertOk()->assertJsonPath('keyEpoch',2)
            ->assertJsonPath('effectiveRole','viewer')
            ->assertJsonPath('invite.contract',$signed['contract'])
            ->assertJsonPath('invite.acceptedContract',$accept['contract'])
            ->assertJsonPath('epoch.contractHash',$this->epochHash);
        $this->assertDatabaseHas('team_members_v1',[
            'team_id'=>$this->teamId,
            'account_id'=>$this->users['guest']['id'],
            'state'=>'active','role'=>'viewer',
        ]);
        $this->assertDatabaseCount('photo_access_grants',0);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
        $this->assertDatabaseCount('assignment_invites_v1',0);
        $this->login('stranger');
        $this->getJson('/teams/v2/'.$this->teamId.'/member')->assertNotFound();
        $this->getJson('/teams/v2/invites/received')->assertOk()
            ->assertJsonCount(0,'items');
    }

    public function test_stale_epoch_hash_membership_role_and_forged_signers_fail_closed():void
    {
        $this->login('owner');
        foreach([
            ['keyEpoch'=>3],['keyEpochHash'=>str_repeat('f',64)],
            ['membershipRevision'=>3],
            ['recipientKeyDigest'=>str_repeat('f',64)],
        ] as $invalid){
            $this->postJson('/teams/v2/'.$this->teamId.'/invites',
                $this->signed('owner','pb3.team-invite.v2',
                    $this->invite($invalid)))->assertConflict();
        }
        $this->postJson('/teams/v2/'.$this->teamId.'/invites',
            $this->signed('owner','pb3.assignment-invite.v1',$this->invite()))
            ->assertUnauthorized();
        $this->login('guest');
        $this->postJson('/teams/v2/'.$this->teamId.'/invites',
            $this->signed('guest','pb3.team-invite.v2',$this->invite()))
            ->assertUnprocessable();
        $this->assertDatabaseCount('team_invites_v2',0);
    }

    public function test_remove_new_epoch_member_revokes_signed_invite_and_forbids_old_key():void
    {
        $invite=$this->invite();
        $signed=$this->postInvite($invite);
        $this->login('guest');
        $accept=$this->signed('guest','pb3.team-accept.v2',$this->consent(
            $invite,hash('sha256',$signed['contract'])));
        $this->postJson('/teams/v2/'.$this->teamId.'/invites/'
            .$invite['inviteId'].'/accept',$accept)->assertCreated();
        $this->login('owner');
        $event=[
            'version'=>1,'operationId'=>(string)Str::uuid(),
            'teamId'=>$this->teamId,
            'ownerAccountId'=>$this->users['owner']['id'],
            'inviteId'=>$invite['inviteId'],
            'targetAccountId'=>$this->users['guest']['id'],
            'action'=>'remove','previousRole'=>'viewer','nextRole'=>null,
            'fromRevision'=>2,'toRevision'=>3,
        ];
        $command=$this->signed('owner','pb3.team-membership.v1',$event);
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',$command)
            ->assertCreated()->assertJsonPath('rotationRequired',true);
        $this->assertDatabaseHas('team_invites_v2',[
            'id'=>$invite['inviteId'],'state'=>'revoked',
        ]);
        $this->assertDatabaseCount('team_membership_events_v1',1);
        $this->login('guest');
        $this->getJson('/teams/v2/invites/received')->assertOk()
            ->assertJsonPath('items.0.state','revoked')
            ->assertJsonMissingPath('items.0.contract')
            ->assertJsonMissingPath('items.0.signature');
        $this->getJson('/teams/v2/'.$this->teamId.'/member')->assertConflict();
        $this->login('owner');
        $this->getJson('/teams/v2/'.$this->teamId.'/participants')
            ->assertOk()->assertJsonPath('items.0.state','revoked');
    }

    public function test_pending_expiry_cas_and_cross_account_consent_are_denied():void
    {
        $invite=$this->invite();
        $signed=$this->postInvite($invite);
        $url='/teams/v2/'.$this->teamId.'/invites/'.$invite['inviteId'].'/accept';
        $payload=$this->consent($invite,hash('sha256',$signed['contract']));
        $this->login('stranger');
        $this->postJson($url,$this->signed('stranger','pb3.team-accept.v2',
            $payload))->assertUnprocessable();
        $this->login('guest');
        $bad=$payload;$bad['keyEpochHash']=str_repeat('f',64);
        $this->postJson($url,$this->signed('guest','pb3.team-accept.v2',
            $bad))->assertConflict();
        DB::table('team_records_v1')->where('id',$this->teamId)
            ->update(['membership_revision'=>3]);
        $this->postJson($url,$this->signed('guest','pb3.team-accept.v2',
            $payload))->assertConflict();
        $this->assertDatabaseCount('team_members_v1',1);
    }

    public function test_previously_excluded_member_requires_fresh_epoch_consent_to_rejoin():void
    {
        DB::table('team_members_v1')->insert([
            'team_id'=>$this->teamId,
            'account_id'=>$this->users['guest']['id'],
            'role'=>'contributor','state'=>'revoked',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $invite=$this->invite(['role'=>'viewer']);
        $command=$this->postInvite($invite);
        $this->assertDatabaseHas('team_members_v1',[
            'team_id'=>$this->teamId,
            'account_id'=>$this->users['guest']['id'],
            'role'=>'contributor','state'=>'revoked',
        ]);
        $this->login('guest');
        $this->getJson('/teams/v2/'.$this->teamId.'/member')->assertNotFound();
        $this->postJson('/teams/v2/'.$this->teamId.'/invites/'
            .$invite['inviteId'].'/accept',$this->signed('guest',
                'pb3.team-accept.v2',$this->consent($invite,
                    hash('sha256',$command['contract']))))
            ->assertCreated();
        $this->assertDatabaseCount('team_members_v1',2);
        $this->assertDatabaseHas('team_members_v1',[
            'team_id'=>$this->teamId,
            'account_id'=>$this->users['guest']['id'],
            'role'=>'viewer','state'=>'active',
        ]);
        $this->getJson('/teams/v2/'.$this->teamId.'/member')
            ->assertOk()->assertJsonPath('effectiveRole','viewer');
        $this->assertDatabaseCount('photo_access_grants',0);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
    }

    public function test_new_epoch_revokes_older_pending_v2_invitation_without_key_redistribution():void
    {
        $pending=$this->invite();
        $this->postInvite($pending);
        DB::table('team_records_v1')->where('id',$this->teamId)
            ->update(['rotation_required'=>true,'membership_revision'=>3]);
        $epoch3=[
            'version'=>1,'operationId'=>(string)Str::uuid(),
            'teamId'=>$this->teamId,'ownerAccountId'=>$this->users['owner']['id'],
            'fromEpoch'=>2,'toEpoch'=>3,'membershipRevision'=>3,
            'previousEpochHash'=>$this->epochHash,
            'privateEnvelope'=>self::profile(),'recipients'=>[],
            'retiredPendingInviteIds'=>[$pending['inviteId']],
        ];
        $this->login('owner');
        // The same signed array MUST cover pending v2 invitations, not
        // merely old v1 IDs. Reject all incomplete or forged sweeps before
        // any epoch grant or recipient revocation can be committed.
        $missing=$epoch3;$missing['retiredPendingInviteIds']=[];
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$missing))
            ->assertConflict();
        $different=$epoch3;
        $different['retiredPendingInviteIds']=[(string)Str::uuid()];
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$different))
            ->assertConflict();
        $duplicated=$epoch3;
        $duplicated['retiredPendingInviteIds']=[
            $pending['inviteId'],$pending['inviteId'],
        ];
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$duplicated))
            ->assertUnprocessable();
        $extra=$epoch3;
        $extra['retiredPendingInviteIds']=[
            $pending['inviteId'],(string)Str::uuid(),
        ];
        sort($extra['retiredPendingInviteIds'],SORT_STRING);
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',
            $this->signed('owner','pb3.team-key-epoch.v1',$extra))
            ->assertConflict();
        $this->assertDatabaseHas('team_invites_v2',[
            'id'=>$pending['inviteId'],'state'=>'pending',
        ]);
        $this->assertDatabaseCount('team_key_epochs_v1',1);
        $signed=$this->signed('owner','pb3.team-key-epoch.v1',$epoch3);
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',$signed)
            ->assertCreated()->assertJsonPath('keyEpoch',3);
        $this->postJson('/teams/v1/'.$this->teamId.'/epoch',$signed)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->assertDatabaseHas('team_invites_v2',[
            'id'=>$pending['inviteId'],'state'=>'revoked',
        ]);
        $this->login('guest');
        $this->getJson('/teams/v2/invites/received')
            ->assertOk()->assertJsonPath('items.0.state','revoked')
            ->assertJsonMissingPath('items.0.envelope')
            ->assertJsonMissingPath('items.0.contract');
        $this->getJson('/teams/v2/'.$this->teamId.'/member')->assertNotFound();
        $this->login('owner');
        $next=$this->invite([
            'keyEpoch'=>3,
            'keyEpochHash'=>hash('sha256',$signed['contract']),
            'membershipRevision'=>3,
        ]);
        $this->postJson('/teams/v2/'.$this->teamId.'/invites',
            $this->signed('owner','pb3.team-invite.v2',$next))
            ->assertCreated()->assertJsonPath('keyEpoch',3);
        $this->assertDatabaseCount('team_invites_v2',2);
        $this->getJson('/teams/v2/'.$this->teamId.'/participants')
            ->assertOk()->assertJsonCount(2,'items');
    }

    public function test_member_role_receipt_is_bound_to_the_current_invite_not_its_timestamp():void
    {
        $invite=$this->invite();$signed=$this->postInvite($invite);
        $this->login('guest');
        $this->postJson('/teams/v2/'.$this->teamId.'/invites/'.$invite['inviteId'].'/accept',
            $this->signed('guest','pb3.team-accept.v2',
                $this->consent($invite,hash('sha256',$signed['contract']))))->assertCreated();
        $accepted=DB::table('team_invites_v2')->where('id',$invite['inviteId'])->first();
        // Different genuine signed invitation history, same timestamp precision.
        // A receipt for an earlier membership must never become current again.
        $old=[
            'version'=>1,'operationId'=>(string)Str::uuid(),'teamId'=>$this->teamId,
            'ownerAccountId'=>$this->users['owner']['id'],'inviteId'=>(string)Str::uuid(),
            'targetAccountId'=>$this->users['guest']['id'],'action'=>'change_role',
            'previousRole'=>'viewer','nextRole'=>'contributor','fromRevision'=>1,'toRevision'=>2,
        ];
        $oldSigned=$this->signed('owner','pb3.team-membership.v1',$old);
        DB::table('team_membership_events_v1')->insert([
            'operation_id'=>$old['operationId'],'team_id'=>$this->teamId,
            'target_account_id'=>$old['targetAccountId'],'invite_id'=>$old['inviteId'],
            'action'=>'change_role','previous_role'=>'viewer','next_role'=>'contributor',
            'from_revision'=>1,'to_revision'=>2,'contract_hash'=>hash('sha256',$oldSigned['contract']),
            'contract_json'=>$oldSigned['contract'],'owner_signature'=>$oldSigned['signature'],
            'created_at'=>$accepted->accepted_at,'updated_at'=>$accepted->accepted_at,
        ]);
        $this->getJson('/teams/v2/'.$this->teamId.'/member')->assertOk()
            ->assertJsonPath('effectiveRole','viewer')->assertJsonPath('latestRoleEvent',null);
        $this->login('owner');
        $current=array_replace($old,[
            'operationId'=>(string)Str::uuid(),'inviteId'=>$invite['inviteId'],
            'fromRevision'=>2,'toRevision'=>3,
        ]);
        $currentSigned=$this->signed('owner','pb3.team-membership.v1',$current);
        $this->postJson('/teams/v1/'.$this->teamId.'/membership',$currentSigned)->assertCreated();
        $this->login('guest');
        $this->getJson('/teams/v2/'.$this->teamId.'/member')->assertOk()
            ->assertJsonPath('effectiveRole','contributor')
            ->assertJsonPath('latestRoleEvent.contract',$currentSigned['contract']);
    }

    public function test_signed_invitation_history_cannot_be_dropped():void
    {
        $this->postInvite($this->invite());
        $migration=require database_path(
            'migrations/2026_11_10_000011_team_epoch_invitations_v2.php');
        try{$migration->down();$this->fail('Signed v2 invites must survive downgrade.');}
        catch(\RuntimeException $e){
            $this->assertSame('pb3.team_invites_v2.rollback_forbidden',
                $e->getMessage());
        }
        $this->assertTrue(Schema::hasTable('team_invites_v2'));
        $this->assertDatabaseCount('team_invites_v2',1);
    }
}
