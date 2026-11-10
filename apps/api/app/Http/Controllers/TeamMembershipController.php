<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P1-29A: signed/serialized membership ACL events.
 * On removal, immediately quarantine all future server-distributed Team DEKs
 * until a separate cryptographically reviewed epoch rotation commits.
 * This cannot delete an already decrypted plaintext from a former member.
 */
final class TeamMembershipController extends Controller
{
    public function __construct(private readonly PhotoSync $sync) {}

    public function status(Request $r,string $teamId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        $t=DB::table('team_records_v1')->where('id',$teamId)
            ->where('owner_account_id',$actor->id)->first();
        abort_unless($t,404);
        return $this->sync->json([
            'teamId'=>$teamId,
            'membershipRevision'=>(int)$t->membership_revision,
            'keyEpoch'=>(int)$t->key_epoch,
            'rotationRequired'=>(bool)$t->rotation_required,
        ]);
    }

    public function history(Request $r,string $teamId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        $t=DB::table('team_records_v1')->where('id',$teamId)
            ->where('owner_account_id',$actor->id)->first();
        abort_unless($t,404);
        // Bounded explicit audit chain, not a global public permissions feed.
        $after=$r->query('after');
        abort_unless($after===null||ctype_digit((string)$after),422);
        $cursor=$after===null?0:(int)$after;
        abort_unless($cursor>=0&&$cursor<=1000000,422);
        $rows=DB::table('team_membership_events_v1')
            ->where('team_id',$teamId)->where('to_revision','>',$cursor)
            ->orderBy('to_revision')->limit(51)->get();
        $items=$rows->take(50)->map(static fn($e)=>[
            'operationId'=>$e->operation_id,'teamId'=>$e->team_id,
            'targetAccountId'=>$e->target_account_id,'inviteId'=>$e->invite_id,
            'action'=>$e->action,'previousRole'=>$e->previous_role,
            'nextRole'=>$e->next_role,'fromRevision'=>(int)$e->from_revision,
            'toRevision'=>(int)$e->to_revision,
            'contract'=>$e->contract_json,'signature'=>$e->owner_signature,
        ])->values()->all();
        return $this->sync->json([
            'items'=>$items,
            'membershipRevision'=>(int)$t->membership_revision,
            'rotationRequired'=>(bool)$t->rotation_required,
            'nextCursor'=>$rows->count()>50?$items[49]['toRevision']:null,
        ]);
    }

    public function mutate(Request $r,string $teamId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        $input=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($input['contract'])&&is_string($input['signature']),422);
        $c=C::signed($input['contract'],$input['signature'],
            $actor->account_spki,'pb3.team-membership.v1',[
                'version','operationId','teamId','ownerAccountId',
                'inviteId','targetAccountId','action',
                'previousRole','nextRole','fromRevision','toRevision',
        ],9000);
        abort_unless(($c['version']??null)===1&&$c['teamId']===$teamId
            &&$c['ownerAccountId']===$actor->id
            &&$c['targetAccountId']!==$actor->id
            &&in_array($c['action'],['change_role','remove'],true)
            &&in_array($c['previousRole'],['curator','contributor','viewer'],true)
            &&is_int($c['fromRevision'])&&$c['fromRevision']>=1
            &&$c['fromRevision']<=999999
            &&is_int($c['toRevision'])
            &&$c['toRevision']===$c['fromRevision']+1,422);
        foreach(['operationId','teamId','ownerAccountId',
            'inviteId','targetAccountId'] as $field)C::uuid($c,$field);
        if($c['action']==='remove'){
            abort_unless($c['nextRole']===null,422);
        }else{
            abort_unless(in_array($c['nextRole'],
                ['curator','contributor','viewer'],true)
                &&$c['nextRole']!==$c['previousRole'],422);
        }
        $hash=hash('sha256',$input['contract']);
        return DB::transaction(function()use($teamId,$actor,$c,$input,$hash){
            $t=DB::table('team_records_v1')->where('id',$teamId)
                ->lockForUpdate()->first();
            abort_unless($t&&$t->owner_account_id===$actor->id,404);
            $earlier=DB::table('team_membership_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($earlier){
                abort_unless($earlier->team_id===$teamId
                    &&hash_equals($earlier->contract_hash,$hash)
                    &&hash_equals($earlier->owner_signature,$input['signature']),409);
                return $this->sync->json([
                    'operationId'=>$c['operationId'],
                    'membershipRevision'=>(int)$t->membership_revision,
                    'rotationRequired'=>(bool)$t->rotation_required,
                    'unchanged'=>true,
                ]);
            }
            abort_unless($t->state==='active'
                &&(int)$t->membership_revision===$c['fromRevision']
                // A previous removal blocks all further ACL mutations until
                // a new key epoch has been committed to remaining members.
                &&!$t->rotation_required,409);
            $invite=DB::table('team_invites_v1')
                ->where('id',$c['inviteId'])->where('team_id',$teamId)
                ->where('recipient_account_id',$c['targetAccountId'])
                ->lockForUpdate()->first();
            abort_unless($invite,404);
            abort_unless(in_array($invite->state,['pending','accepted'],true),409);
            $member=DB::table('team_members_v1')
                ->where('team_id',$teamId)
                ->where('account_id',$c['targetAccountId'])
                ->lockForUpdate()->first();
            if($invite->state==='accepted'){
                abort_unless($member&&$member->state==='active',409);
                $currentRole=$member->role;
            }else{
                abort_unless(!$member,409);
                $currentRole=$invite->role;
            }
            abort_unless($c['previousRole']===$currentRole,409);
            if($c['action']==='change_role'){
                // Pending invite's owner-signed original role cannot change:
                // its cryptographic envelope binds the role. Only change an
                // already accepted membership; immutable invite stays intact.
                abort_unless($invite->state==='accepted',409);
                DB::table('team_members_v1')
                    ->where('team_id',$teamId)
                    ->where('account_id',$c['targetAccountId'])
                    ->update(['role'=>$c['nextRole'],'updated_at'=>now()]);
            }else{
                // Remove pending or accepted invite. Preserve signed
                // consent and contract as immutable audit evidence.
                DB::table('team_invites_v1')->where('id',$invite->id)
                    ->update(['state'=>'revoked','updated_at'=>now()]);
                if($member){
                    DB::table('team_members_v1')
                        ->where('team_id',$teamId)
                        ->where('account_id',$c['targetAccountId'])
                        ->update(['state'=>'revoked','updated_at'=>now()]);
                }
            }
            DB::table('team_membership_events_v1')->insert([
                'operation_id'=>$c['operationId'],'team_id'=>$teamId,
                'target_account_id'=>$c['targetAccountId'],
                'invite_id'=>$c['inviteId'],'action'=>$c['action'],
                'previous_role'=>$currentRole,'next_role'=>$c['nextRole'],
                'from_revision'=>$c['fromRevision'],
                'to_revision'=>$c['toRevision'],
                'contract_hash'=>$hash,'contract_json'=>$input['contract'],
                'owner_signature'=>$input['signature'],
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('team_records_v1')->where('id',$teamId)->update([
                'membership_revision'=>$c['toRevision'],
                'rotation_required'=>$c['action']==='remove',
                'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'operationId'=>$c['operationId'],
                'membershipRevision'=>$c['toRevision'],
                'rotationRequired'=>$c['action']==='remove',
                'unchanged'=>false,
            ],201);
        },3);
    }
}
