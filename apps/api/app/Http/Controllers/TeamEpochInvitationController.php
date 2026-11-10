<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Signed P1-29C addendum: a member admitted after Team epoch 1 obtains
 * the *current* DEK via an individually scoped owner-signed invitation.
 *
 * The immutable epoch contract is never edited to insert new members.
 * Only accepted, authenticated members can read their signed envelope.
 */
final class TeamEpochInvitationController extends Controller
{
    public function __construct(private readonly PhotoSync $sync) {}

    private function signed(Request $r,object $actor,string $domain,array $fields):array
    {
        $input=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($input['contract'])
            &&is_string($input['signature']),422);
        $c=C::signed($input['contract'],$input['signature'],
            $actor->account_spki,$domain,$fields,11000);
        return [$input,$c,hash('sha256',$input['contract'])];
    }

    private function envelope(array $c):void
    {
        $e=$c['envelope'];
        abort_unless(is_array($e)&&!array_is_list($e),422);
        P::exact($e,['ephemeralSpki','salt','iv','ciphertext']);
        abort_unless(is_string($e['ephemeralSpki'])
            &&is_string($e['salt'])&&is_string($e['iv'])
            &&is_string($e['ciphertext']),422);
        P::spki($e['ephemeralSpki']);
        P::b64($e['salt'],16);
        P::b64($e['iv'],12);
        P::b64($e['ciphertext'],48);
    }

    public function create(Request $r,string $teamId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        [$input,$c,$hash]=$this->signed($r,$actor,'pb3.team-invite.v2',[
            'version','inviteId','operationId','teamId','ownerAccountId',
            'rootContractHash','keyEpoch','keyEpochHash','membershipRevision',
            'recipientAccountId','role','fileAccess','recipientKeyDigest',
            'expiresAt','envelope',
        ]);
        abort_unless(($c['version']??null)===2
            &&$c['teamId']===$teamId&&$c['ownerAccountId']===$actor->id
            &&$c['recipientAccountId']!==$actor->id
            &&in_array($c['role'],['curator','contributor','viewer'],true)
            &&$c['fileAccess']==='none'
            &&is_int($c['keyEpoch'])&&$c['keyEpoch']>=2&&$c['keyEpoch']<=1000001
            &&is_int($c['membershipRevision'])
            &&$c['membershipRevision']>=2&&$c['membershipRevision']<=1000000,422);
        foreach(['inviteId','operationId','teamId','ownerAccountId',
            'recipientAccountId'] as $field)C::uuid($c,$field);
        foreach(['rootContractHash','keyEpochHash','recipientKeyDigest'] as $field)
            abort_unless(is_string($c[$field])
                &&preg_match('/^[a-f0-9]{64}$/D',$c[$field])===1,422);
        C::millis($c['expiresAt']);
        abort_unless($c['expiresAt']>PhotoSync::nowMs()
            &&$c['expiresAt']<=PhotoSync::nowMs()+7*86400000,422);
        $this->envelope($c);
        return DB::transaction(function()use($actor,$teamId,$input,$c,$hash){
            $team=DB::table('team_records_v1')->where('id',$teamId)
                ->lockForUpdate()->first();
            abort_unless($team&&$team->owner_account_id===$actor->id,404);
            $existing=DB::table('team_invites_v2')->where('id',$c['inviteId'])->first();
            if($existing){
                abort_unless($existing->team_id===$teamId
                    &&hash_equals($existing->contract_hash,$hash)
                    &&hash_equals($existing->owner_signature,$input['signature']),409);
                return $this->sync->json([
                    'inviteId'=>$existing->id,'state'=>$existing->state,
                    'keyEpoch'=>(int)$existing->key_epoch,'unchanged'=>true,
                ]);
            }
            abort_unless($team->state==='active'&&!$team->rotation_required
                &&(int)$team->key_epoch===$c['keyEpoch']
                &&(int)$team->membership_revision===$c['membershipRevision']
                &&hash_equals($team->contract_hash,$c['rootContractHash']),409);
            $epoch=DB::table('team_key_epochs_v1')->where('team_id',$teamId)
                ->where('epoch',$c['keyEpoch'])->first();
            abort_unless($epoch&&hash_equals($epoch->contract_hash,
                $c['keyEpochHash']),409);
            abort_if(DB::table('team_invites_v2')
                ->where('operation_id',$c['operationId'])->exists(),409);
            abort_if(DB::table('team_invites_v2')->where('team_id',$teamId)
                ->where('recipient_account_id',$c['recipientAccountId'])
                ->where('key_epoch',$c['keyEpoch'])->exists(),409);
            $member=DB::table('team_members_v1')->where('team_id',$teamId)
                ->where('account_id',$c['recipientAccountId'])->first();
            abort_if($member&&$member->state==='active',409);
            $recipient=DB::table('identity_accounts')
                ->where('id',$c['recipientAccountId'])->where('status','ready')->first();
            abort_unless($recipient,404);
            $directory=DB::table('account_exchange_keys')
                ->where('account_id',$recipient->id)->first();
            abort_unless($directory
                &&hash_equals($directory->descriptor_hash,
                    $c['recipientKeyDigest']),409);
            DB::table('team_invites_v2')->insert([
                'id'=>$c['inviteId'],'team_id'=>$teamId,
                'owner_account_id'=>$actor->id,
                'recipient_account_id'=>$recipient->id,
                'operation_id'=>$c['operationId'],
                'key_epoch'=>$c['keyEpoch'],
                'membership_revision'=>$c['membershipRevision'],
                'root_contract_hash'=>$c['rootContractHash'],
                'epoch_contract_hash'=>$c['keyEpochHash'],
                'role'=>$c['role'],'state'=>'pending',
                'recipient_key_digest'=>$c['recipientKeyDigest'],
                'contract_hash'=>$hash,'contract_json'=>$input['contract'],
                'owner_signature'=>$input['signature'],
                'expires_at'=>$c['expiresAt'],
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'inviteId'=>$c['inviteId'],'keyEpoch'=>$c['keyEpoch'],
                'state'=>'pending','unchanged'=>false,
            ],201);
        },3);
    }

    public function inbox(Request $r)
    {
        [$actor]=$this->sync->actor($r);
        $after=$r->query('after');
        abort_unless($after===null||is_string($after),422);
        if($after!==null)P::uuid($after);
        $query=DB::table('team_invites_v2 as i')
            ->join('team_records_v1 as t','t.id','=','i.team_id')
            ->join('identity_accounts as o','o.id','=','i.owner_account_id')
            ->where('i.recipient_account_id',$actor->id);
        if($after!==null)$query->where('i.id','>',$after);
        $rows=$query->select(['i.*','t.rotation_required','t.key_epoch as current_epoch',
            'o.account_spki'])->orderBy('i.id')->limit(51)->get();
        $items=$rows->take(50)->map(static function($i){
            // After exclusion or next epoch, no old ECDH envelope is served.
            if($i->state==='revoked'||$i->state==='suspended'
                ||(int)$i->current_epoch!==(int)$i->key_epoch
                ||$i->rotation_required){
                return ['inviteId'=>$i->id,'teamId'=>$i->team_id,
                    'state'=>$i->state==='revoked'?'revoked':'suspended'];
            }
            return [
                'inviteId'=>$i->id,'teamId'=>$i->team_id,
                'ownerAccountId'=>$i->owner_account_id,
                'ownerAccountSpki'=>$i->account_spki,
                'recipientAccountId'=>$i->recipient_account_id,
                'role'=>$i->role,'state'=>$i->state,
                'keyEpoch'=>(int)$i->key_epoch,
                'membershipRevision'=>(int)$i->membership_revision,
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

    public function accept(Request $r,string $teamId,string $inviteId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);P::uuid($inviteId);
        [$input,$c]=$this->signed($r,$actor,'pb3.team-accept.v2',[
            'version','action','inviteId','teamId','recipientAccountId',
            'operationId','inviteHash','keyEpoch','keyEpochHash',
        ]);
        abort_unless(($c['version']??null)===2&&$c['action']==='accept'
            &&$c['inviteId']===$inviteId&&$c['teamId']===$teamId
            &&$c['recipientAccountId']===$actor->id
            &&is_int($c['keyEpoch'])&&$c['keyEpoch']>=2,422);
        foreach(['inviteId','teamId','recipientAccountId','operationId'] as $field)
            C::uuid($c,$field);
        foreach(['inviteHash','keyEpochHash'] as $field)
            abort_unless(is_string($c[$field])
                &&preg_match('/^[a-f0-9]{64}$/D',$c[$field])===1,422);
        return DB::transaction(function()use($actor,$teamId,$inviteId,$input,$c){
            $team=DB::table('team_records_v1')->where('id',$teamId)
                ->lockForUpdate()->first();
            abort_unless($team,404);
            $invite=DB::table('team_invites_v2')->where('id',$inviteId)
                ->where('team_id',$teamId)
                ->where('recipient_account_id',$actor->id)
                ->lockForUpdate()->first();
            abort_unless($invite,404);
            abort_unless(hash_equals($invite->contract_hash,$c['inviteHash'])
                &&(int)$invite->key_epoch===$c['keyEpoch']
                &&hash_equals($invite->epoch_contract_hash,$c['keyEpochHash']),409);
            if($invite->state==='accepted'){
                abort_unless($invite->accepted_operation_id===$c['operationId']
                    &&hash_equals((string)$invite->accepted_contract,
                        $input['contract'])
                    &&hash_equals((string)$invite->accepted_signature,
                        $input['signature']),409);
                return $this->sync->json([
                    'inviteId'=>$inviteId,'state'=>'accepted',
                    'keyEpoch'=>(int)$invite->key_epoch,'unchanged'=>true,
                ]);
            }
            abort_unless($team->state==='active'&&!$team->rotation_required
                &&(int)$team->key_epoch===(int)$invite->key_epoch
                &&(int)$team->membership_revision===(int)$invite->membership_revision
                &&$invite->state==='pending'
                &&(int)$invite->expires_at>PhotoSync::nowMs(),409);
            $epoch=DB::table('team_key_epochs_v1')
                ->where('team_id',$teamId)->where('epoch',$c['keyEpoch'])->first();
            abort_unless($epoch&&hash_equals($epoch->contract_hash,
                $c['keyEpochHash']),409);
            $directory=DB::table('account_exchange_keys')
                ->where('account_id',$actor->id)->first();
            abort_unless($directory&&hash_equals($directory->descriptor_hash,
                $invite->recipient_key_digest),409);
            abort_if(DB::table('team_invites_v2')
                ->where('accepted_operation_id',$c['operationId'])->exists(),409);
            $member=DB::table('team_members_v1')->where('team_id',$teamId)
                ->where('account_id',$actor->id)->lockForUpdate()->first();
            abort_if($member&&$member->state==='active',409);
            if($member){
                // Keep the old signed consent evidence. Reactivate only
                // after a fresh, new-epoch signed invitation and consent.
                DB::table('team_members_v1')->where('team_id',$teamId)
                    ->where('account_id',$actor->id)->update([
                        'state'=>'active','role'=>$invite->role,'updated_at'=>now(),
                    ]);
            }else{
                DB::table('team_members_v1')->insert([
                    'team_id'=>$teamId,'account_id'=>$actor->id,
                    'role'=>$invite->role,'state'=>'active',
                    'created_at'=>now(),'updated_at'=>now(),
                ]);
            }
            DB::table('team_invites_v2')->where('id',$inviteId)->update([
                'state'=>'accepted','accepted_operation_id'=>$c['operationId'],
                'accepted_contract'=>$input['contract'],
                'accepted_signature'=>$input['signature'],
                'accepted_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'inviteId'=>$inviteId,'state'=>'accepted',
                'keyEpoch'=>(int)$invite->key_epoch,'unchanged'=>false,
            ],201);
        },3);
    }

    public function participants(Request $r,string $teamId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        abort_unless(DB::table('team_records_v1')
            ->where('id',$teamId)->where('owner_account_id',$actor->id)->exists(),404);
        $after=$r->query('after');
        abort_unless($after===null||is_string($after),422);
        if($after!==null)P::uuid($after);
        $query=DB::table('team_invites_v2 as i')
            ->join('identity_accounts as a','a.id','=','i.recipient_account_id')
            ->where('i.team_id',$teamId);
        if($after!==null)$query->where('i.id','>',$after);
        $rows=$query->select(['i.*','a.account_spki as recipient_account_spki'])
            ->selectSub(DB::table('team_members_v1 as m')
                ->select('m.role')->whereColumn('m.team_id','i.team_id')
                ->whereColumn('m.account_id','i.recipient_account_id')
                ->limit(1),'effective_role')
            ->orderBy('i.id')->limit(51)->get();
        $items=$rows->take(50)->map(static fn($i)=>[
            'inviteId'=>$i->id,'recipientAccountId'=>$i->recipient_account_id,
            'recipientAccountSpki'=>$i->recipient_account_spki,
            'role'=>$i->role,'effectiveRole'=>$i->effective_role??$i->role,
            'state'=>$i->state,'keyEpoch'=>(int)$i->key_epoch,
            'membershipRevision'=>(int)$i->membership_revision,
            'expiresAt'=>(int)$i->expires_at,
            'contract'=>$i->contract_json,'signature'=>$i->owner_signature,
            'acceptedContract'=>$i->accepted_contract,
            'acceptedSignature'=>$i->accepted_signature,
        ])->values()->all();
        return $this->sync->json([
            'items'=>$items,
            'nextCursor'=>$rows->count()>50?$items[49]['inviteId']:null,
        ]);
    }

    public function member(Request $r,string $teamId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        $team=DB::table('team_records_v1 as t')
            ->join('identity_accounts as a','a.id','=','t.owner_account_id')
            ->where('t.id',$teamId)->where('t.state','active')
            ->select(['t.*','a.account_spki'])->first();
        abort_unless($team,404);
        abort_unless(!$team->rotation_required&&(int)$team->key_epoch>=2,409);
        $member=DB::table('team_members_v1')
            ->where('team_id',$teamId)->where('account_id',$actor->id)
            ->where('state','active')->first();
        abort_unless($member,404);
        $invite=DB::table('team_invites_v2')->where('team_id',$teamId)
            ->where('recipient_account_id',$actor->id)
            ->where('state','accepted')
            ->where('key_epoch',(int)$team->key_epoch)->first();
        abort_unless($invite,404);
        $epoch=DB::table('team_key_epochs_v1')->where('team_id',$teamId)
            ->where('epoch',(int)$team->key_epoch)->first();
        abort_unless($epoch&&hash_equals($epoch->contract_hash,
            $invite->epoch_contract_hash),409);
        $directory=DB::table('account_exchange_keys')
            ->where('account_id',$actor->id)->first();
        abort_unless($directory&&hash_equals($directory->descriptor_hash,
            $invite->recipient_key_digest),409);
        $signedEvent=DB::table('team_membership_events_v1')
            ->where('team_id',$teamId)
            ->where('target_account_id',$actor->id)
            ->where('action','change_role')->orderByDesc('to_revision')->first();
        return $this->sync->json([
            'teamId'=>$teamId,'ownerAccountId'=>$team->owner_account_id,
            'ownerAccountSpki'=>$team->account_spki,
            'membershipRevision'=>(int)$team->membership_revision,
            'keyEpoch'=>(int)$team->key_epoch,'keyEpochHash'=>$epoch->contract_hash,
            'effectiveRole'=>$member->role,
            'invite'=>[
                'contract'=>$invite->contract_json,
                'signature'=>$invite->owner_signature,
                'contractHash'=>$invite->contract_hash,
                'acceptedContract'=>$invite->accepted_contract,
                'acceptedSignature'=>$invite->accepted_signature,
            ],
            'epoch'=>[
                'contract'=>$epoch->contract_json,
                'signature'=>$epoch->owner_signature,
                'contractHash'=>$epoch->contract_hash,
            ],
            'latestRoleEvent'=>$signedEvent?[
                'contract'=>$signedEvent->contract_json,
                'signature'=>$signedEvent->owner_signature,
            ]:null,
        ]);
    }
}
