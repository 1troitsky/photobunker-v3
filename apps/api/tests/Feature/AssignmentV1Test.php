<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AssignmentV1Test extends TestCase
{
    use RefreshDatabase;

    private array $people=[];
    private string $assignmentId;

    protected function setUp():void
    {
        parent::setUp();
        foreach(['owner','recipient','outsider'] as $role) $this->person($role);
        $this->assignmentId=(string)Str::uuid();
    }

    private function person(string $role):void
    {
        $priv=openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1',
        ]);
        $pub=openssl_pkey_get_details($priv)['key'];
        $spki=P::encode(base64_decode(preg_replace('/-----[^-]+-----|\s+/','',$pub)));
        $account=(string)Str::uuid();
        $device=(string)Str::uuid();
        $this->people[$role]=[
            'account'=>$account,'device'=>$device,'spki'=>$spki,'signer'=>$priv,
        ];
        DB::table('identity_accounts')->insert([
            'id'=>$account,'operation_id'=>(string)Str::uuid(),
            'status'=>'ready','prepare_hash'=>str_repeat('1',64),
            'reserved_until'=>now()->addDay(),'account_spki'=>$spki,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$account,'signing_spki'=>$spki,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
    }

    private function as(string $role):void
    {
        $p=$this->people[$role];
        $this->withHeader('Origin','https://localhost')
            ->withSession(['identity_account'=>$p['account'],
                'identity_device'=>$p['device'],'identity_issued'=>time()]);
    }

    private function sign(string $role,string $domain,string $json):string
    {
        openssl_sign($domain."\n".$json,$der,$this->people[$role]['signer'],OPENSSL_ALGO_SHA256);
        $i=2;$pieces=[];
        for($j=0;$j<2;$j++){
            if(ord($der[$i++])!==2)throw new \RuntimeException('bad DER');
            $len=ord($der[$i++]);$part=substr($der,$i,$len);$i+=$len;
            $pieces[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return P::encode(implode('',$pieces));
    }

    private function signed(string $role,string $domain,array $payload):array
    {
        $json=json_encode($payload,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['contract'=>$json,'signature'=>$this->sign($role,$domain,$json)];
    }

    private function createAssignment():void
    {
        $this->as('owner');
        $payload=[
            'version'=>1,'assignmentId'=>$this->assignmentId,
            'operationId'=>(string)Str::uuid(),
            'ownerAccountId'=>$this->people['owner']['account'],
            'revision'=>1,'policyRevision'=>1,'state'=>'active',
            'startsAt'=>now()->getTimestampMs(),'endsAt'=>null,
            'photoGoal'=>30,'allowedMedia'=>['photo'],
            'privateEnvelope'=>[
                'version'=>1,'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(400)),
                'wrappedKey'=>[
                    'iv'=>P::encode(random_bytes(12)),
                    'ciphertext'=>P::encode(random_bytes(48)),
                ],
            ],
        ];
        $input=$this->signed('owner','pb3.assignment.v1',$payload);
        $this->postJson('/assignments/v1',$input)->assertCreated()
            ->assertJsonPath('assignmentId',$this->assignmentId);
        $this->postJson('/assignments/v1',$input)->assertOk()
            ->assertJsonPath('unchanged',true);
        $this->assertDatabaseCount('assignment_records_v1',1);
    }

    private function invite():string
    {
        $this->as('owner');
        $recipient=$this->people['recipient'];
        $directoryHash=str_repeat('a',64);
        DB::table('account_exchange_keys')->insertOrIgnore([
            'account_id'=>$recipient['account'],
            'descriptor'=>'fixture','account_signature'=>'fixture',
            'sealed_private'=>'{}','descriptor_hash'=>$directoryHash,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $id=(string)Str::uuid();
        $payload=[
            'version'=>1,'inviteId'=>$id,'assignmentId'=>$this->assignmentId,
            'ownerAccountId'=>$this->people['owner']['account'],
            'recipientAccountId'=>$recipient['account'],
            'recipientKeyDigest'=>$directoryHash,'role'=>'contributor',
            'expiresAt'=>now()->addDay()->getTimestampMs(),
            'envelope'=>[
                'ephemeralSpki'=>$this->people['owner']['spki'],
                'salt'=>P::encode(random_bytes(16)),
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
        ];
        $input=$this->signed('owner','pb3.assignment-invite.v1',$payload);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/invites',$input)
            ->assertCreated()->assertJsonPath('inviteId',$id);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/invites',$input)
            ->assertOk()->assertJsonPath('unchanged',true);
        return $id;
    }

    private function accept(string $inviteId):void
    {
        $this->as('recipient');
        $payload=[
            'version'=>1,'action'=>'accept','inviteId'=>$inviteId,
            'assignmentId'=>$this->assignmentId,
            'recipientAccountId'=>$this->people['recipient']['account'],
            'operationId'=>(string)Str::uuid(),
        ];
        $input=$this->signed('recipient','pb3.assignment-accept.v1',$payload);
        $url='/assignments/v1/'.$this->assignmentId.'/invites/'.$inviteId.'/accept';
        $this->postJson($url,$input)->assertOk()->assertJsonPath('state','accepted');
        $this->postJson($url,$input)->assertOk()->assertJsonPath('unchanged',true);
    }

    private function signedState(string $role,string $action,int $from,
        ?string $operationId=null):array
    {
        $this->as($role);
        $json=DB::table('assignment_records_v1')
            ->where('id',$this->assignmentId)->value('contract_json');
        $payload=[
            'version'=>1,
            'operationId'=>$operationId??(string)Str::uuid(),
            'assignmentId'=>$this->assignmentId,
            'ownerAccountId'=>$this->people[$role]['account'],
            'policyHash'=>hash('sha256',$json),
            'policyRevision'=>1,
            'fromRevision'=>$from,'toRevision'=>$from+1,
            'action'=>$action,
            'state'=>$action==='finish'?'finished':'active',
        ];
        return $this->signed($role,'pb3.assignment-state.v1',$payload);
    }

    public function test_r2_01_owner_state_transition_persists_exact_subsecond_receipt():void
    {
        $this->travelTo(now()->startOfSecond()->addMilliseconds(750));
        $expected=now()->getTimestampMs();
        $this->createAssignment();
        $finish=$this->signedState('owner','finish',1);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/state',$finish)
            ->assertOk()->assertJsonPath('state','finished');
        $event=DB::table('assignment_state_events_v1')
            ->where('assignment_id',$this->assignmentId)->first();
        $this->assertNotNull($event);
        $this->assertSame($expected,(int)$event->occurred_at_ms);
        $createdSecond=\Carbon\CarbonImmutable::parse($event->created_at,'UTC')
            ->getTimestampMs();
        $this->assertSame(750,$expected%1000);
        $this->assertSame($expected-750,$createdSecond);
        // A lost-ACK replay must preserve the original event receipt.
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/state',$finish)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->assertDatabaseCount('assignment_state_events_v1',1);
        $this->assertSame($expected,(int)DB::table('assignment_state_events_v1')
            ->where('assignment_id',$this->assignmentId)->value('occurred_at_ms'));
    }

    public function test_owner_finish_resume_are_signed_versioned_idempotent_and_keep_invites():void
    {
        $this->createAssignment();
        $inviteId=$this->invite();
        $this->accept($inviteId);
        $url='/assignments/v1/'.$this->assignmentId.'/state';
        $finish=$this->signedState('owner','finish',1);
        $this->postJson($url,$finish)->assertOk()
            ->assertJsonPath('state','finished')
            ->assertJsonPath('revision',2)
            ->assertJsonPath('unchanged',false);
        $this->postJson($url,$finish)->assertOk()
            ->assertJsonPath('unchanged',true);
        $this->assertDatabaseCount('assignment_state_events_v1',1);
        $this->assertDatabaseHas('assignment_records_v1',[
            'id'=>$this->assignmentId,'state'=>'finished','revision'=>2,
        ]);
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.state','finished')
            ->assertJsonPath('items.0.revision',2)
            ->assertJsonPath('items.0.stateContract',$finish['contract'])
            ->assertJsonPath('items.0.stateSignature',$finish['signature']);
        $this->as('recipient');
        // Accepted member retains their key envelope and can verify a
        // signed finished state, but has no new capture authority.
        $this->getJson('/assignments/v1/invites/received')
            ->assertJsonPath('items.0.inviteId',$inviteId);
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.state','finished');
        $resume=$this->signedState('owner','resume',2);
        $this->postJson($url,$resume)->assertOk()
            ->assertJsonPath('state','active')
            ->assertJsonPath('revision',3);
        $this->assertDatabaseCount('assignment_state_events_v1',2);
        $this->assertDatabaseHas('assignment_records_v1',[
            'id'=>$this->assignmentId,'state'=>'active','revision'=>3,
        ]);
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.stateContract',$resume['contract'])
            ->assertJsonPath('items.0.stateSignature',$resume['signature']);
    }

    public function test_state_change_rejects_forgery_stale_revision_and_expired_resume():void
    {
        $this->createAssignment();
        $url='/assignments/v1/'.$this->assignmentId.'/state';
        $wrong=$this->signedState('outsider','finish',1);
        $this->postJson($url,$wrong)->assertNotFound();
        $finish=$this->signedState('owner','finish',1);
        $tampered=$finish;
        $tampered['signature']=P::encode(random_bytes(64));
        $this->postJson($url,$tampered)->assertUnauthorized();
        $this->postJson($url,$finish)->assertOk();
        $stale=$this->signedState('owner','finish',1);
        $this->postJson($url,$stale)->assertConflict();
        // A completed assignment cannot be reopened after its hard end date,
        // and a rejected command must not add to the append-only audit.
        DB::table('assignment_records_v1')->where('id',$this->assignmentId)
            ->update(['ends_at'=>now()->subMinute()->getTimestampMs()]);
        $resume=$this->signedState('owner','resume',2);
        $this->postJson($url,$resume)->assertConflict();
        $this->assertDatabaseCount('assignment_state_events_v1',1);
        $this->assertDatabaseHas('assignment_records_v1',[
            'id'=>$this->assignmentId,'state'=>'finished',
        ]);
    }

    public function test_lost_ack_invite_and_accept_replay_after_finish_and_expiry():void
    {
        $this->createAssignment();
        $inviteId=$this->invite();
        $this->accept($inviteId);
        $row=DB::table('assignment_invites_v1')->where('id',$inviteId)->first();
        $finish=$this->signedState('owner','finish',1);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/state',$finish)
            ->assertOk()->assertJsonPath('state','finished');

        // A previously committed invite remains idempotent when the owner
        // retries after finishing: a lost HTTP ACK must not create another row.
        $this->as('owner');
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/invites',[
            'contract'=>$row->contract_json,'signature'=>$row->owner_signature,
        ])->assertOk()->assertJsonPath('unchanged',true);

        // But a DIFFERENT signed invite is forbidden, even for that recipient.
        $newInvite=json_decode($row->contract_json,true,32,JSON_THROW_ON_ERROR);
        $newInvite['inviteId']=(string)Str::uuid();
        $different=$this->signed('owner','pb3.assignment-invite.v1',$newInvite);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/invites',$different)
            ->assertConflict();

        DB::table('assignment_invites_v1')->where('id',$inviteId)
            ->update(['expires_at'=>now()->subMinute()->getTimestampMs()]);
        $this->as('recipient');
        $this->postJson('/assignments/v1/'.$this->assignmentId
            .'/invites/'.$inviteId.'/accept',[
                'contract'=>$row->accepted_contract,
                'signature'=>$row->accepted_signature,
            ])->assertOk()->assertJsonPath('unchanged',true);
        $this->assertDatabaseCount('assignment_invites_v1',1);
        $this->assertDatabaseCount('assignment_state_events_v1',1);
    }

    public function test_assignment_creation_is_signed_private_and_owner_scoped():void
    {
        $this->createAssignment();
        $record=DB::table('assignment_records_v1')->where('id',$this->assignmentId)->first();
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.photoGoal',30)
            ->assertJsonPath('items.0.policyContract',$record->contract_json)
            ->assertJsonPath('items.0.policySignature',$record->owner_signature)
            ->assertJsonPath('items.0.ownerAccountSpki',$this->people['owner']['spki']);
        // The client can independently authenticate the immutable signed
        // capture policy instead of relying on unsigned server flags.
        $this->assertTrue(P::verify($this->people['owner']['spki'],
            'pb3.assignment.v1'."\n".$record->contract_json,$record->owner_signature));
        $this->as('outsider');
        $this->getJson('/assignments/v1')->assertJsonPath('items',[]);
        $this->postJson('/assignments/v1',[
            'contract'=>'{}','signature'=>P::encode(random_bytes(64)),
        ])->assertStatus(422);
    }

    public function test_invitation_requires_signed_owner_and_recipient_consent():void
    {
        $this->createAssignment();
        $invite=$this->invite();
        $this->as('outsider');
        $this->getJson('/assignments/v1/invites/received')->assertJsonPath('items',[]);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/invites/'.$invite.'/accept',
            ['contract'=>'{}','signature'=>P::encode(random_bytes(64))])->assertStatus(422);
        $this->as('recipient');
        $this->getJson('/assignments/v1/invites/received')
            ->assertJsonPath('items.0.inviteId',$invite);
        $this->getJson('/assignments/v1')->assertJsonPath('items',[]);
        $this->accept($invite);
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.assignmentId',$this->assignmentId)
            ->assertJsonPath('items.0.ownerAccountSpki',$this->people['owner']['spki'])
            ->assertJsonPath('items.0.policyRevision',1);
        // Invitation expiry governs acceptance only. After consent, the
        // participant must retain their sealed assignment-key envelope.
        DB::table('assignment_invites_v1')->where('id',$invite)
            ->update(['expires_at'=>now()->subMinute()->getTimestampMs()]);
        $this->getJson('/assignments/v1/invites/received')
            ->assertJsonPath('items.0.inviteId',$invite)
            ->assertJsonPath('items.0.state','accepted');
    }

    public function test_confirmed_receipt_count_is_not_capped_by_fifty_item_page():void
    {
        $this->createAssignment();
        $invite=$this->invite();
        $this->accept($invite);
        $owner=$this->people['owner']['account'];
        $contributor=$this->people['recipient']['account'];
        $device=$this->people['recipient']['device'];
        $ids=[];
        for($i=0;$i<51;$i++){
            $photo=(string)Str::uuid();
            $grant=(string)Str::uuid();
            $ids[]=$grant;
            DB::table('photo_records')->insert([
                'id'=>$photo,'account_id'=>$contributor,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),
                'state'=>'active','expires_at'=>now()->addDay()->getTimestampMs(),
                'contract_hash'=>str_repeat('d',64),'contract_json'=>'{}',
                'signature'=>'fixture','created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('photo_access_grants')->insert([
                'id'=>$grant,'photo_id'=>$photo,'owner_account_id'=>$contributor,
                'recipient_account_id'=>$owner,'recipient_key_digest'=>str_repeat('a',64),
                'expires_at'=>now()->addDay()->getTimestampMs(),
                'state'=>'active','contract_hash'=>str_repeat('c',64),
                'contract_json'=>'{}','account_signature'=>'fixture',
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('assignment_submissions_v1')->insert([
                'id'=>(string)Str::uuid(),
                'assignment_id'=>$this->assignmentId,
                'contributor_account_id'=>$contributor,'photo_id'=>$photo,
                'photo_grant_id'=>$grant,'operation_id'=>(string)Str::uuid(),
                'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}',
                'contributor_signature'=>'fixture','policy_revision'=>1,
                'created_at'=>now(),
            ]);
        }
        // Goal=30 does not cap receipt count. List endpoint is limited to 50
        // rows, whereas the independent authenticated aggregate stays 51.
        $this->as('owner');
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.photoGoal',30)
            ->assertJsonPath('items.0.confirmedPhotoCount',51);
        $this->assertCount(50,$this->getJson('/assignments/v1/'
            .$this->assignmentId.'/submissions')->assertOk()->json('items'));
        $this->as('recipient');
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.confirmedPhotoCount',51);
        DB::table('photo_access_grants')->where('id',$ids[0])
            ->update(['state'=>'revoked']);
        DB::table('photo_access_grants')->where('id',$ids[1])
            ->update(['expires_at'=>now()->subMinute()->getTimestampMs()]);
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.confirmedPhotoCount',49);
        $this->as('outsider');
        $this->getJson('/assignments/v1')->assertJsonPath('items',[]);
    }

    public function test_submission_requires_contributor_signed_bind_and_active_photo_grant():void
    {
        $this->createAssignment();
        $invite=$this->invite();
        $this->accept($invite);
        $photo=(string)Str::uuid();
        $grant=(string)Str::uuid();
        $contributor=$this->people['recipient']['account'];
        $owner=$this->people['owner']['account'];
        DB::table('photo_records')->insert([
            'id'=>$photo,'account_id'=>$contributor,
            'device_id'=>$this->people['recipient']['device'],
            'operation_id'=>(string)Str::uuid(),
            'state'=>'active','expires_at'=>now()->addDay()->getTimestampMs(),
            'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}',
            'signature'=>'fixture','created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('photo_access_grants')->insert([
            'id'=>$grant,'photo_id'=>$photo,'owner_account_id'=>$contributor,
            'recipient_account_id'=>$owner,
            'recipient_key_digest'=>str_repeat('a',64),
            'expires_at'=>now()->addHour()->getTimestampMs(),
            'state'=>'active','contract_hash'=>str_repeat('c',64),
            'contract_json'=>'{}','account_signature'=>'fixture',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $c=[
            'version'=>1,'submissionId'=>(string)Str::uuid(),
            'operationId'=>(string)Str::uuid(),'assignmentId'=>$this->assignmentId,
            'contributorAccountId'=>$contributor,'photoId'=>$photo,
            'photoGrantId'=>$grant,'policyRevision'=>1,'kind'=>'photo',
        ];
        $input=$this->signed('recipient','pb3.assignment-submit.v1',$c);
        $this->as('outsider');
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/submissions',$input)
            ->assertUnauthorized(); // valid contract signature belongs to recipient
        $this->as('recipient');
        // A signed v2 capture for another assignment must not be laundered
        // through a valid photo grant into the current assignment.
        DB::table('photo_records')->where('id',$photo)->update([
            'contract_json'=>json_encode(['version'=>2,'capture'=>[
                'assignmentId'=>(string)Str::uuid(),
                'ownerAccountId'=>$owner,
                'policyRevision'=>1,
                'policyHash'=>hash('sha256','unrelated'),
                'capturedAt'=>now()->getTimestampMs(),
            ]],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
        ]);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/submissions',$input)
            ->assertConflict();
        // A personal v1 photo may still be explicitly granted and submitted.
        DB::table('photo_records')->where('id',$photo)->update([
            'contract_json'=>'{}',
        ]);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/submissions',$input)
            ->assertCreated();
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/submissions',$input)
            ->assertOk()->assertJsonPath('unchanged',true);

        $this->as('owner');
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.confirmedPhotoCount',1);
        $this->getJson('/assignments/v1/'.$this->assignmentId.'/submissions')
            ->assertJsonPath('items.0.photoId',$photo);
        $this->as('outsider');
        $this->getJson('/assignments/v1/'.$this->assignmentId.'/submissions')
            ->assertNotFound();

        // Removing the E2EE grant must not leave a bypass through assignments.
        DB::table('photo_access_grants')->where('id',$grant)->update(['state'=>'revoked']);
        $this->as('owner');
        $this->getJson('/assignments/v1/'.$this->assignmentId.'/submissions')
            ->assertJsonPath('items',[]);
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.confirmedPhotoCount',0);
        $this->assertDatabaseHas('photo_records',['id'=>$photo,'state'=>'active']);
        // An accepted submission may be retried after finish AND after its
        // separate E2EE grant is revoked. ACK must not reactivate the grant.
        $finish=$this->signedState('owner','finish',1);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/state',$finish)
            ->assertOk()->assertJsonPath('state','finished');
        $this->as('recipient');
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/submissions',$input)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->assertDatabaseCount('assignment_submissions_v1',1);
        $this->assertDatabaseHas('photo_access_grants',[
            'id'=>$grant,'state'=>'revoked',
        ]);
    }
}
