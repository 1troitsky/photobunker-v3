<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Identity\Protocol as P;
use App\Events\DatabaseEventInboxLedger;
use App\Events\EventAdmission;
use App\Events\EventConsumer;
use Illuminate\Support\Str;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P1-28: independent owner-authorized E2EE invitations and recipient-signed
 * consent. A team membership DOES NOT authorize any assignment/file grant.
 */
final class TeamInvitationController extends Controller
{
    public function __construct(private readonly PhotoSync $sync) {}

    private function signed(Request $r,object $actor,string $domain,array $fields):array
    {
        $input=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($input['contract'])&&is_string($input['signature']),422);
        $contract=C::signed($input['contract'],$input['signature'],
            $actor->account_spki,$domain,$fields,9000);
        return [$input,$contract,hash('sha256',$input['contract'])];
    }

    public function invite(Request $r,string $teamId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        [$input,$c,$hash]=$this->signed($r,$actor,'pb3.team-invite.v1',[
            'version','inviteId','operationId','teamId','ownerAccountId',
            'teamContractHash','recipientAccountId','role','fileAccess','recipientKeyDigest',
            'expiresAt','envelope',
        ]);
        abort_unless(($c['version']??null)===1
            &&$c['teamId']===$teamId
            &&$c['ownerAccountId']===$actor->id
            &&$c['recipientAccountId']!==$actor->id
            &&in_array($c['role'],['curator','contributor','viewer'],true)
            &&$c['fileAccess']==='none',422);
        foreach(['inviteId','operationId','teamId','ownerAccountId',
            'recipientAccountId'] as $field)C::uuid($c,$field);
        abort_unless(is_string($c['recipientKeyDigest'])
            &&preg_match('/^[a-f0-9]{64}$/D',$c['recipientKeyDigest'])===1,422);
        abort_unless(is_string($c['teamContractHash'])
            &&preg_match('/^[a-f0-9]{64}$/D',$c['teamContractHash'])===1,422);
        C::millis($c['expiresAt']);
        abort_unless($c['expiresAt']>PhotoSync::nowMs()
            &&$c['expiresAt']<=PhotoSync::nowMs()+7*86400000,422);
        $envelope=$c['envelope'];
        abort_unless(is_array($envelope)&&!array_is_list($envelope),422);
        P::exact($envelope,['ephemeralSpki','salt','iv','ciphertext']);
        abort_unless(is_string($envelope['ephemeralSpki'])
            &&is_string($envelope['salt'])&&is_string($envelope['iv'])
            &&is_string($envelope['ciphertext']),422);
        P::spki($envelope['ephemeralSpki']);
        P::b64($envelope['salt'],16);
        P::b64($envelope['iv'],12);
        P::b64($envelope['ciphertext'],48);

        return DB::transaction(function()use($actor,$teamId,$input,$c,$hash){
            $recipientLock=DB::table('identity_accounts')
                ->where('id',$c['recipientAccountId'])->lockForUpdate()->first();
            abort_unless($recipientLock && $recipientLock->status==='ready',404);
            $team=DB::table('team_records_v1')
                ->where('id',$teamId)->lockForUpdate()->first();
            abort_unless($team&&$team->owner_account_id===$actor->id,404);
            $existing=DB::table('team_invites_v1')->where('id',$c['inviteId'])->first();
            if($existing){
                abort_unless($existing->team_id===$teamId
                    &&$existing->owner_account_id===$actor->id
                    &&hash_equals($existing->contract_hash,$hash)
                    &&hash_equals($existing->owner_signature,$input['signature']),409);
                return $this->sync->json([
                    'inviteId'=>$existing->id,'state'=>$existing->state,
                    'unchanged'=>true,
                ]);
            }
            abort_unless($team->state==='active'&&!$team->rotation_required
                &&(int)$team->key_epoch===1
                &&hash_equals($team->contract_hash,$c['teamContractHash']),409);
            abort_if(DB::table('team_invites_v1')
                ->where('operation_id',$c['operationId'])->exists(),409);
            abort_if(DB::table('team_invites_v1')
                ->where('team_id',$teamId)
                ->where('recipient_account_id',$c['recipientAccountId'])
                ->exists(),409);
            $recipient=DB::table('identity_accounts')
                ->where('id',$c['recipientAccountId'])->where('status','ready')->first();
            abort_unless($recipient,404);
            $directory=DB::table('account_exchange_keys')
                ->where('account_id',$recipient->id)->first();
            abort_unless($directory
                &&hash_equals($directory->descriptor_hash,$c['recipientKeyDigest']),409);
            DB::table('team_invites_v1')->insert([
                'id'=>$c['inviteId'],'team_id'=>$teamId,
                'owner_account_id'=>$actor->id,
                'recipient_account_id'=>$recipient->id,
                'operation_id'=>$c['operationId'],'role'=>$c['role'],
                'state'=>'pending','recipient_key_digest'=>$c['recipientKeyDigest'],
                'contract_hash'=>$hash,'contract_json'=>$input['contract'],
                'owner_signature'=>$input['signature'],
                'expires_at'=>$c['expiresAt'],
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            $event=[
                'schemaVersion'=>1,'eventId'=>(string) Str::uuid(),
                'eventType'=>'TeamInitialInvitationCreated',
                'accountId'=>(string)$recipient->id,
                'subjectType'=>'team_invite_v1',
                'subjectId'=>$c['inviteId'],
                'occurredAtMs'=>PhotoSync::nowMs(),'revision'=>1,
            ];
            abort_unless((new EventConsumer(new DatabaseEventInboxLedger()))
                ->ingest($event,(string)$recipient->id)===EventAdmission::Accepted,
                503,'team.invite_event_unavailable');
            return $this->sync->json([
                'inviteId'=>$c['inviteId'],'state'=>'pending','unchanged'=>false,
            ],201);
        },3);
    }

    public function inbox(Request $r)
    {
        [$actor]=$this->sync->actor($r);
        $after=$r->query('after');
        abort_unless($after===null||is_string($after),422);
        if($after!==null)P::uuid($after);
        $q=DB::table('team_invites_v1 as i')
            ->join('identity_accounts as a','a.id','=','i.owner_account_id')
            ->join('team_records_v1 as t','t.id','=','i.team_id')
            ->where('i.recipient_account_id',$actor->id);
        if($after!==null)$q->where('i.id','>',$after);
        $rows=$q->select(['i.*','a.account_spki','t.rotation_required',
                't.key_epoch as current_epoch'])
            ->orderBy('i.id')
            ->limit(51)->get();
        $items=$rows->take(50)->map(function($i){
            if($i->state==='revoked'){
                // Never re-distribute old signed ECDH key envelopes to a
                // removed recipient. A minimal tombstone only signals local
                // UI/cache invalidation; all signed evidence stays owner-only.
                return [
                    'inviteId'=>$i->id,'teamId'=>$i->team_id,
                    'state'=>'revoked',
                ];
            }
            if($i->rotation_required){
                // Never distribute the stale ECDH envelope during quarantine.
                return [
                    'inviteId'=>$i->id,'teamId'=>$i->team_id,
                    'state'=>'suspended',
                ];
            }
            if((int)$i->current_epoch>1){
                // The original v1 envelope must not be re-delivered after a
                // new DEK is published. An active recipient independently
                // verifies the *current* signed epoch and individual grant.
                return [
                    'inviteId'=>$i->id,'teamId'=>$i->team_id,
                    'state'=>'superseded',
                    'ownerAccountId'=>$i->owner_account_id,
                    'ownerAccountSpki'=>$i->account_spki,
                ];
            }
            return [
                'inviteId'=>$i->id,'teamId'=>$i->team_id,
                'ownerAccountId'=>$i->owner_account_id,
                'ownerAccountSpki'=>$i->account_spki,
                'recipientAccountId'=>$i->recipient_account_id,
                'role'=>$i->role,'state'=>$i->state,
                'expiresAt'=>(int)$i->expires_at,
                'contract'=>$i->contract_json,
                'signature'=>$i->owner_signature,
                'contractHash'=>$i->contract_hash,
                'expired'=>$i->state==='pending'
                    &&(int)$i->expires_at<=PhotoSync::nowMs(),
            ];
        })->values()->all();
        return $this->sync->json([
            'items'=>$items,
            'nextCursor'=>$rows->count()>50?$items[49]['inviteId']:null,
        ]);
    }


    /** Owner-only bounded signed roster; accepted state is server-authenticated
     * and each recipient consent signature is returned for independent checks.
     */
    public function participants(Request $r,string $teamId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        $team=DB::table('team_records_v1')->where('id',$teamId)
            ->where('owner_account_id',$actor->id)->first();
        abort_unless($team,404);
        $after=$r->query('after');
        abort_unless($after===null||is_string($after),422);
        if($after!==null)P::uuid($after);
        $q=DB::table('team_invites_v1 as i')
            ->join('identity_accounts as recipient','recipient.id','=','i.recipient_account_id')
            ->where('i.team_id',$teamId);
        if($after!==null)$q->where('i.id','>',$after);
        $rows=$q->select(['i.*','recipient.account_spki as recipient_account_spki'])
            ->selectSub(DB::table('team_members_v1 as m')
                ->select('m.role')->whereColumn('m.team_id','i.team_id')
                ->whereColumn('m.account_id','i.recipient_account_id')
                ->where('i.state','accepted')
                ->where('m.state','active')
                ->limit(1),'effective_role')
            ->selectSub(DB::table('team_membership_events_v1 as e')
                ->select('e.next_role')->whereColumn('e.invite_id','i.id')
                ->where('e.action','change_role')
                ->orderByDesc('e.to_revision')->limit(1),'historic_role')
            ->orderBy('i.id')->limit(51)->get();
        $items=$rows->take(50)->map(static fn($i)=>[
            'inviteId'=>$i->id,
            'recipientAccountId'=>$i->recipient_account_id,
            'recipientAccountSpki'=>$i->recipient_account_spki,
            'role'=>$i->role,
            'effectiveRole'=>$i->effective_role??$i->historic_role??$i->role,
            'state'=>$i->state,
            'expiresAt'=>(int)$i->expires_at,
            'contract'=>$i->contract_json,
            'signature'=>$i->owner_signature,
            'acceptedContract'=>$i->accepted_contract,
            'acceptedSignature'=>$i->accepted_signature,
        ])->values()->all();
        return $this->sync->json([
            'items'=>$items,
            'nextCursor'=>$rows->count()>50?$items[49]['inviteId']:null,
        ]);
    }

    public function accept(Request $r,string $teamId,string $inviteId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);P::uuid($inviteId);
        [$input,$c,$hash]=$this->signed($r,$actor,'pb3.team-accept.v1',[
            'version','action','inviteId','teamId','recipientAccountId',
            'operationId','inviteHash',
        ]);
        abort_unless(($c['version']??null)===1&&$c['action']==='accept'
            &&$c['inviteId']===$inviteId&&$c['teamId']===$teamId
            &&$c['recipientAccountId']===$actor->id,422);
        foreach(['inviteId','teamId','recipientAccountId','operationId'] as $field)
            C::uuid($c,$field);
        abort_unless(is_string($c['inviteHash'])
            &&preg_match('/^[a-f0-9]{64}$/D',$c['inviteHash'])===1,422);
        return DB::transaction(function()use($c,$actor,$teamId,$inviteId,$input){
            $team=DB::table('team_records_v1')
                ->where('id',$teamId)->lockForUpdate()->first();
            abort_unless($team,404);
            $invite=DB::table('team_invites_v1')
                ->where('id',$inviteId)->where('team_id',$teamId)
                ->where('recipient_account_id',$actor->id)
                ->lockForUpdate()->first();
            abort_unless($invite,404);
            abort_unless(hash_equals($invite->contract_hash,$c['inviteHash']),409);
            if($invite->state==='accepted'){
                abort_unless($invite->accepted_operation_id===$c['operationId']
                    &&hash_equals((string)$invite->accepted_contract,
                        $input['contract'])
                    &&hash_equals((string)$invite->accepted_signature,
                        $input['signature']),409);
                return $this->sync->json([
                    'inviteId'=>$inviteId,'state'=>'accepted',
                    'unchanged'=>true,
                ]);
            }
            abort_unless($team->state==='active'&&!$team->rotation_required
                &&(int)$team->key_epoch===1
                &&$invite->state==='pending'
                &&(int)$invite->expires_at>PhotoSync::nowMs(),409);
            $directory=DB::table('account_exchange_keys')
                ->where('account_id',$actor->id)->first();
            abort_unless($directory
                &&hash_equals($directory->descriptor_hash,
                    $invite->recipient_key_digest),409);
            abort_if(DB::table('team_invites_v1')
                ->where('accepted_operation_id',$c['operationId'])->exists(),409);
            abort_if(DB::table('team_members_v1')
                ->where('team_id',$teamId)
                ->where('account_id',$actor->id)->exists(),409);
            DB::table('team_members_v1')->insert([
                'team_id'=>$teamId,'account_id'=>$actor->id,
                'role'=>$invite->role,'state'=>'active',
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('team_invites_v1')->where('id',$inviteId)->update([
                'state'=>'accepted','accepted_operation_id'=>$c['operationId'],
                'accepted_contract'=>$input['contract'],
                'accepted_signature'=>$input['signature'],
                'accepted_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'inviteId'=>$inviteId,'state'=>'accepted','unchanged'=>false,
            ],201);
        },3);
    }

    /** The recipient can fetch the immutable signed team and DEK envelope
     * only after signed acceptance; this does not confer media ACL.
     */
    public function memberTeam(Request $r,string $teamId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        $team=DB::table('team_records_v1 as t')
            ->join('identity_accounts as a','a.id','=','t.owner_account_id')
            ->where('t.id',$teamId)->where('t.state','active')
            ->whereExists(function($q)use($actor){
                $q->selectRaw('1')->from('team_members_v1 as m')
                  ->whereColumn('m.team_id','t.id')
                  ->where('m.account_id',$actor->id)
                  ->where('m.state','active');
            })
            ->select(['t.*','a.account_spki'])->first();
        abort_unless($team,404);
        // Never serve the old Team DEK once any member is excluded.
        // The surviving member gets 409 until a new key epoch is committed.
        abort_unless(!$team->rotation_required
            &&(int)$team->key_epoch===1,409);
        // Member's own accepted invite is required to unwrap the team DEK.
        $invite=DB::table('team_invites_v1')
            ->where('team_id',$teamId)
            ->where('recipient_account_id',$actor->id)
            ->where('state','accepted')->first();
        abort_unless($invite,404);
        $member=DB::table('team_members_v1')
            ->where('team_id',$teamId)
            ->where('account_id',$actor->id)
            ->where('state','active')->first();
        abort_unless($member,404);
        $event=DB::table('team_membership_events_v1')
            ->where('team_id',$teamId)
            ->where('target_account_id',$actor->id)
            ->where('action','change_role')
            ->orderByDesc('to_revision')->first();
        return $this->sync->json([
            'teamId'=>$teamId,'ownerAccountId'=>$team->owner_account_id,
            'ownerAccountSpki'=>$team->account_spki,
            'contract'=>$team->contract_json,'signature'=>$team->owner_signature,
            'invite'=>$this->inviteForMember($invite),
            'effectiveRole'=>$member->role,
            'latestRoleEvent'=>$event?[
                'contract'=>$event->contract_json,
                'signature'=>$event->owner_signature,
            ]:null,
        ]);
    }

    private function inviteForMember(object $row):array
    {
        return [
            'inviteId'=>$row->id,'role'=>$row->role,
            'contract'=>$row->contract_json,
            'signature'=>$row->owner_signature,
            'contractHash'=>$row->contract_hash,
        ];
    }
}
