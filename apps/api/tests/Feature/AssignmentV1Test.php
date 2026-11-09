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

    private function createAssignment(int $expectedTotal=1):void
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
        $this->assertDatabaseCount('assignment_records_v1',$expectedTotal);
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

    private function signedGoalPolicy(
        string $role,int $from,int|null $goal,string|null $previousHash=null,
        string|null $operationId=null
    ):array
    {
        $this->as($role);
        $original=DB::table('assignment_records_v1')
            ->where('id',$this->assignmentId)->value('contract_json');
        $latest=DB::table('assignment_records_v1')
            ->where('id',$this->assignmentId)->value('latest_policy_contract');
        return $this->signed($role,'pb3.assignment-policy.v1',[
            'version'=>1,'operationId'=>$operationId??(string)Str::uuid(),
            'assignmentId'=>$this->assignmentId,
            'ownerAccountId'=>$this->people[$role]['account'],
            'rootPolicyHash'=>hash('sha256',$original),
            'previousPolicyHash'=>$previousHash??hash('sha256',$latest??$original),
            'fromPolicyRevision'=>$from,'toPolicyRevision'=>$from+1,
            'photoGoal'=>$goal,'allowedMedia'=>['photo'],
        ]);
    }

    private function signedCaptureRequirements(
        string $role,int $from,int|null $goal,
        bool $category,int $minDescription,bool $gps
    ):array
    {
        $this->as($role);
        $original=DB::table('assignment_records_v1')
            ->where('id',$this->assignmentId)->value('contract_json');
        $latest=DB::table('assignment_records_v1')
            ->where('id',$this->assignmentId)->value('latest_policy_contract');
        return $this->signed($role,'pb3.assignment-policy.v2',[
            'version'=>2,'operationId'=>(string)Str::uuid(),
            'assignmentId'=>$this->assignmentId,
            'ownerAccountId'=>$this->people[$role]['account'],
            'rootPolicyHash'=>hash('sha256',$original),
            'previousPolicyHash'=>hash('sha256',$latest??$original),
            'fromPolicyRevision'=>$from,'toPolicyRevision'=>$from+1,
            'photoGoal'=>$goal,'allowedMedia'=>['photo'],
            'requiredCategory'=>$category,
            'descriptionMinLength'=>$minDescription,
            'requiredGps'=>$gps,
        ]);
    }

    public function test_technical_request_limit_is_isolated_per_authenticated_account():void
    {
        // This operational limit is not the 3/month Free product entitlement.
        config()->set('operational_limits.assignments.requests_per_minute_per_account',3);
        $this->as('owner');
        for($n=0;$n<3;$n++)$this->getJson('/assignments/v1/usage')->assertOk();
        $this->getJson('/assignments/v1/usage')->assertStatus(429);

        // Two legitimate accounts behind the same IP must have independent
        // technical quotas. No owner id may be accepted from request data.
        $this->as('recipient');
        $this->getJson('/assignments/v1/usage')
            ->assertOk()->assertJsonPath('used',0);
        $this->as('owner');
        $this->getJson('/assignments/v1/usage')->assertStatus(429);
    }

    public function test_free_assignment_monthly_quota_is_authoritative_and_idempotent():void
    {
        $limit=config('plans.plans.free.assignment_creations_per_month');
        $this->assertSame(3,$limit);
        $this->as('owner');
        $this->getJson('/assignments/v1/usage')
            ->assertOk()->assertJsonPath('planId','free')
            ->assertJsonPath('limit',3)
            ->assertJsonPath('remaining',3)
            ->assertJsonPath('used',0);

        $acceptedIds=[];
        for($i=1;$i<=3;$i++){
            $this->assignmentId=(string)Str::uuid();
            $this->createAssignment($i);
            $acceptedIds[]=$this->assignmentId;
            $this->getJson('/assignments/v1/usage')
                ->assertOk()->assertJsonPath('used',$i)
                ->assertJsonPath('remaining',3-$i);
        }

        $last=DB::table('assignment_records_v1')
            ->where('id',$this->assignmentId)->first();
        $same=['contract'=>$last->contract_json,
            'signature'=>$last->owner_signature];
        // Retry signed operation after quota exhaustion: MUST ACK unchanged,
        // including the same full signed request rather than a new operation.
        $this->postJson('/assignments/v1',$same)
            ->assertOk()->assertJsonPath('unchanged',true);

        // Create a different valid signed operation: never count a new
        // record, even when a client reuses its prior encrypted envelope.
        $payload=json_decode($last->contract_json,true,32,JSON_THROW_ON_ERROR);
        $payload['assignmentId']=(string)Str::uuid();
        $payload['operationId']=(string)Str::uuid();
        $payload['startsAt']=now()->getTimestampMs();
        $other=$this->signed('owner','pb3.assignment.v1',$payload);
        $this->postJson('/assignments/v1',$other)->assertForbidden()
            ->assertJsonPath('error','assignment.monthly_quota_exceeded')
            ->assertJsonPath('limit',3);
        $this->assertDatabaseCount('assignment_records_v1',3);

        // Owner's draft or server-visible state cannot reset billing usage:
        // finished records are counted too; deleting is not an escape hatch.
        DB::table('assignment_records_v1')->where('id',$acceptedIds[0])
            ->update(['state'=>'finished']);
        $this->getJson('/assignments/v1/usage')
            ->assertJsonPath('used',3)->assertJsonPath('remaining',0);

        $this->as('outsider');
        $this->getJson('/assignments/v1/usage')
            ->assertJsonPath('used',0)->assertJsonPath('remaining',3);
        // Never expose another account's quota by an accountId query argument.
        $this->getJson('/assignments/v1/usage?accountId='.
            urlencode($this->people['owner']['account']))
            ->assertJsonPath('used',0);
    }

    public function test_quota_uses_server_utc_month_not_signed_capture_timestamp():void
    {
        $this->createAssignment();
        $url='/assignments/v1/usage';
        $this->getJson($url)->assertJsonPath('used',1);
        // A previous calendar month does not consume this month's Free
        // quota. Records keep the actual original server-created date.
        DB::table('assignment_records_v1')
            ->where('id',$this->assignmentId)
            ->update(['created_at'=>now('UTC')->subMonth()->startOfMonth()]);
        $this->getJson($url)->assertJsonPath('used',0)
            ->assertJsonPath('remaining',3);
        $this->assignmentId=(string)Str::uuid();
        $this->createAssignment(2);
        $this->getJson($url)->assertJsonPath('used',1)
            ->assertJsonPath('remaining',2);
    }

    public function test_policy_history_is_signed_append_only_and_visible_only_after_consent():void
    {
        $this->createAssignment();
        $url='/assignments/v1/'.$this->assignmentId.'/policy-history';
        $root=DB::table('assignment_records_v1')->where('id',$this->assignmentId)
            ->value('contract_json');
        $this->as('owner');
        $this->getJson($url)->assertOk()
            ->assertJsonPath('assignmentId',$this->assignmentId)
            ->assertJsonPath('policyRevision',1)
            ->assertJsonPath('rootPolicyHash',hash('sha256',$root))
            ->assertJsonPath('events',[]);
        $this->as('outsider');
        $this->getJson($url)->assertNotFound();
        $this->as('recipient');
        $this->getJson($url)->assertNotFound();
        $invite=$this->invite();
        $this->as('recipient');
        $this->getJson($url)->assertNotFound();
        $first=$this->signedGoalPolicy('owner',1,45);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/policy',$first)
            ->assertOk();
        $second=$this->signedCaptureRequirements('owner',2,45,true,12,true);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/policy',$second)
            ->assertOk();
        $this->accept($invite);
        $this->getJson($url)->assertOk()
            ->assertJsonPath('policyRevision',3)
            ->assertJsonPath('rootPolicyHash',hash('sha256',$root))
            ->assertJsonCount(2,'events')
            ->assertJsonPath('events.0.contract',$first['contract'])
            ->assertJsonPath('events.0.signature',$first['signature'])
            ->assertJsonPath('events.0.fromPolicyRevision',1)
            ->assertJsonPath('events.0.toPolicyRevision',2)
            ->assertJsonPath('events.0.contractHash',hash('sha256',$first['contract']))
            ->assertJsonPath('events.1.contract',$second['contract'])
            ->assertJsonPath('events.1.signature',$second['signature'])
            ->assertJsonPath('events.1.toPolicyRevision',3);
        $payload=$this->getJson($url)->assertOk()->json();
        $this->assertIsInt($payload['events'][0]['occurredAtMs']);
        $this->assertGreaterThanOrEqual($payload['events'][0]['occurredAtMs'],
            $payload['events'][1]['occurredAtMs']);
        $this->assertArrayNotHasKey('privateEnvelope',$payload);
        $this->assertStringNotContainsString('latitude',json_encode($payload));
        $this->as('outsider');
        $this->getJson($url)->assertNotFound();
    }

    public function test_signed_v2_private_metadata_requirements_keep_original_goal_and_replay():void
    {
        $this->createAssignment();
        $path='/assignments/v1/'.$this->assignmentId.'/policy';
        $required=$this->signedCaptureRequirements('owner',1,30,true,12,true);
        $this->postJson($path,$required)->assertOk()
            ->assertJsonPath('policyRevision',2)->assertJsonPath('photoGoal',30);
        $this->postJson($path,$required)->assertOk()->assertJsonPath('unchanged',true);
        $this->getJson('/assignments/v1')->assertOk()
            ->assertJsonPath('items.0.policyRevision',2)
            ->assertJsonPath('items.0.policyAmendmentContract',$required['contract'])
            ->assertJsonPath('items.0.policyAmendmentSignature',$required['signature']);
        $this->assertDatabaseCount('assignment_policy_events_v1',1);
        $old=$this->signedGoalPolicy('owner',2,45);
        $this->postJson($path,$old)->assertConflict(); // no v2 -> v1 downgrade
        $same=$this->signedCaptureRequirements('owner',2,30,true,12,true);
        $this->postJson($path,$same)->assertConflict(); // no-op
        $change=$this->signedCaptureRequirements('owner',2,45,true,12,true);
        $this->postJson($path,$change)->assertOk()
            ->assertJsonPath('policyRevision',3)->assertJsonPath('photoGoal',45);
        $this->postJson($path,$required)->assertOk()->assertJsonPath('unchanged',true);
        $this->assertDatabaseCount('assignment_policy_events_v1',2);
        $stored=DB::table('assignment_records_v1')
            ->where('id',$this->assignmentId)->first();
        $this->assertSame(30,json_decode($stored->contract_json,true)['photoGoal']);
        $this->assertSame(2,json_decode($stored->latest_policy_contract,true)['version']);
        $this->assertStringNotContainsString('41.647849',$stored->latest_policy_contract);
        $this->assertStringNotContainsString('private description',$stored->latest_policy_contract);
    }

    public function test_v2_requirements_reject_invalid_schema_forged_domain_and_min_length():void
    {
        $this->createAssignment();
        $path='/assignments/v1/'.$this->assignmentId.'/policy';
        $valid=$this->signedCaptureRequirements('owner',1,30,true,20,true);
        $body=json_decode($valid['contract'],true);
        foreach([-1,4001,1.5,'10'] as $bad){
            $invalid=$body;
            $invalid['descriptionMinLength']=$bad;
            $this->postJson($path,$this->signed('owner',
                'pb3.assignment-policy.v2',$invalid))->assertUnprocessable();
        }
        $invalid=$body;$invalid['requiredGps']='true';
        $this->postJson($path,$this->signed('owner',
            'pb3.assignment-policy.v2',$invalid))->assertUnprocessable();
        $invalid=$body;$invalid['allowedMedia']=['video'];
        $this->postJson($path,$this->signed('owner',
            'pb3.assignment-policy.v2',$invalid))->assertUnprocessable();
        $invalid=$body;$invalid['plainLocation']='41.6,41.7';
        $this->postJson($path,$this->signed('owner',
            'pb3.assignment-policy.v2',$invalid))->assertUnprocessable();
        $this->postJson($path,$this->signed('owner',
            'pb3.assignment-policy.v1',$body))->assertUnauthorized();
        $this->assertDatabaseCount('assignment_policy_events_v1',0);
    }

    public function test_owner_signed_goal_revisions_are_append_only_and_lost_ack_safe():void
    {
        $this->createAssignment();
        $this->invite();
        $first=$this->signedGoalPolicy('owner',1,45);
        $path='/assignments/v1/'.$this->assignmentId.'/policy';
        $this->postJson($path,$first)->assertOk()
            ->assertJsonPath('policyRevision',2)
            ->assertJsonPath('photoGoal',45)
            ->assertJsonPath('unchanged',false);
        $this->postJson($path,$first)->assertOk()->assertJsonPath('unchanged',true);
        $this->assertDatabaseCount('assignment_policy_events_v1',1);
        $this->getJson('/assignments/v1')->assertOk()
            ->assertJsonPath('items.0.photoGoal',45)
            ->assertJsonPath('items.0.policyRevision',2)
            ->assertJsonPath('items.0.policyAmendmentContract',$first['contract'])
            ->assertJsonPath('items.0.policyAmendmentSignature',$first['signature']);
        $record=DB::table('assignment_records_v1')
            ->where('id',$this->assignmentId)->first();
        $this->assertSame(30,json_decode($record->contract_json,true)['photoGoal']);
        $second=$this->signedGoalPolicy('owner',2,null);
        $this->postJson($path,$second)->assertOk()
            ->assertJsonPath('policyRevision',3)->assertJsonPath('photoGoal',null);
        $this->postJson($path,$first)->assertOk()->assertJsonPath('unchanged',true);
        $this->assertDatabaseCount('assignment_policy_events_v1',2);
        // State revisions remain independent and anchored to the immutable root.
        $finish=$this->signedState('owner','finish',1);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/state',$finish)
            ->assertOk()->assertJsonPath('state','finished');
        $this->postJson($path,$second)->assertOk()->assertJsonPath('unchanged',true);
        $this->getJson('/assignments/v1')
            ->assertJsonPath('items.0.policyRevision',3)
            ->assertJsonPath('items.0.revision',2)
            ->assertJsonPath('items.0.state','finished');
    }

    public function test_policy_change_rejects_forgery_stale_revision_cross_owner_and_noop():void
    {
        $this->createAssignment();
        $path='/assignments/v1/'.$this->assignmentId.'/policy';
        $wrong=$this->signedGoalPolicy('outsider',1,40);
        $this->postJson($path,$wrong)->assertNotFound();
        $tampered=$this->signedGoalPolicy('owner',1,40);
        $tampered['signature']=P::encode(random_bytes(64));
        $this->postJson($path,$tampered)->assertUnauthorized();
        $unchanged=$this->signedGoalPolicy('owner',1,30);
        $this->postJson($path,$unchanged)->assertConflict();
        $badPrevious=$this->signedGoalPolicy('owner',1,40,str_repeat('a',64));
        $this->postJson($path,$badPrevious)->assertConflict();
        $invalid=$this->signedGoalPolicy('owner',1,40);
        $payload=json_decode($invalid['contract'],true);
        $payload['allowedMedia']=['video'];
        $this->postJson($path,$this->signed('owner',
            'pb3.assignment-policy.v1',$payload))->assertUnprocessable();
        $first=$this->signedGoalPolicy('owner',1,40);
        $this->postJson($path,$first)->assertOk();
        $stale=$this->signedGoalPolicy('owner',1,50);
        $this->postJson($path,$stale)->assertConflict();
        $this->assertDatabaseCount('assignment_policy_events_v1',1);
        // No 1001st event: otherwise historical capture's bounded walk
        // would fail closed for every assignment photo after further edits.
        $overCapacity=$this->signedGoalPolicy('owner',1001,50);
        $this->postJson($path,$overCapacity)->assertUnprocessable();
        DB::table('assignment_records_v1')->where('id',$this->assignmentId)
            ->update(['ends_at'=>now()->subSecond()->getTimestampMs()]);
        $expiredEdit=$this->signedGoalPolicy('owner',2,50);
        $this->postJson($path,$expiredEdit)->assertConflict();
        DB::table('assignment_records_v1')->where('id',$this->assignmentId)
            ->update(['ends_at'=>null]);
        $finish=$this->signedState('owner','finish',1);
        $this->postJson('/assignments/v1/'.$this->assignmentId.'/state',$finish)
            ->assertOk();
        $later=$this->signedGoalPolicy('owner',2,50);
        $this->postJson($path,$later)->assertConflict();
        $this->assertDatabaseCount('assignment_policy_events_v1',1);
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
