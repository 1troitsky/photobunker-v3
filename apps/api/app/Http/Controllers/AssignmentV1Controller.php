<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P1-04 narrow server vertical: encrypted assignment, signed invitation,
 * signed consent and photo/recipient-grant binding. No direct S3 access.
 */
final class AssignmentV1Controller extends Controller
{
    public function __construct(private readonly PhotoSync $sync) {}

    private function signed(Request $r,object $account,string $domain,array $keys): array
    {
        $data=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($data['contract'])&&is_string($data['signature']),422);
        return C::signed($data['contract'],$data['signature'],
          $account->account_spki,$domain,$keys);
    }

    private function assignment(string $id):object
    {
        P::uuid($id);
        $a=DB::table('assignment_records_v1')->where('id',$id)->first();
        abort_unless($a,404);
        return $a;
    }

    public function create(Request $r)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment.v1',[
            'version','assignmentId','operationId','ownerAccountId',
            'revision','policyRevision','state','startsAt','endsAt',
            'photoGoal','allowedMedia','privateEnvelope',
        ]);
        C::creation($c,$actor->id);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($c,$actor,$hash,$r){
            // Serialize concurrent creation from the same owner.
            DB::table('identity_accounts')->where('id',$actor->id)->lockForUpdate()->first();
            $existing=DB::table('assignment_records_v1')
              ->where('id',$c['assignmentId'])->first();
            if($existing){
                abort_unless($existing->owner_account_id===$actor->id
                  &&hash_equals($existing->contract_hash,$hash),409);
                return $this->sync->json(['assignmentId'=>$existing->id,
                  'state'=>'active','revision'=>1,'unchanged'=>true]);
            }
            abort_if(DB::table('assignment_records_v1')
              ->where('operation_id',$c['operationId'])->exists(),409);
            DB::table('assignment_records_v1')->insert([
                'id'=>$c['assignmentId'],'owner_account_id'=>$actor->id,
                'operation_id'=>$c['operationId'],'contract_hash'=>$hash,
                'contract_json'=>$r->json('contract'),'owner_signature'=>$r->json('signature'),
                'private_envelope_json'=>C::envelope($c['privateEnvelope']),
                'state'=>'active','revision'=>1,'policy_revision'=>1,
                'photo_goal'=>$c['photoGoal'],'starts_at'=>$c['startsAt'],
                'ends_at'=>$c['endsAt'],'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json(['assignmentId'=>$c['assignmentId'],
              'state'=>'active','revision'=>1,'unchanged'=>false],201);
        },3);
    }

    public function index(Request $r)
    {
        [$actor]=$this->sync->actor($r);
        $after=$r->query('after');
        if($after!==null){abort_unless(is_string($after),422);P::uuid($after);}
        $q=DB::table('assignment_records_v1 as a')
          ->where(function($query)use($actor){
              $query->where('a.owner_account_id',$actor->id)
                ->orWhereExists(function($sub)use($actor){
                    $sub->selectRaw('1')->from('assignment_invites_v1 as i')
                      ->whereColumn('i.assignment_id','a.id')
                      ->where('i.recipient_account_id',$actor->id)
                      ->where('i.state','accepted');
                });
          });
        if($after!==null)$q->where('a.id','>',$after);
        $rows=$q->orderBy('a.id')->limit(51)->get([
            'a.id','a.owner_account_id','a.state','a.revision',
            'a.policy_revision','a.photo_goal','a.starts_at','a.ends_at',
            'a.private_envelope_json',
        ]);
        $more=$rows->count()>50;
        $items=$rows->take(50)->map(fn($x)=>[
            'assignmentId'=>$x->id,'ownerAccountId'=>$x->owner_account_id,
            'state'=>$x->state,'revision'=>(int)$x->revision,
            'policyRevision'=>(int)$x->policy_revision,
            'photoGoal'=>$x->photo_goal===null?null:(int)$x->photo_goal,
            'startsAt'=>(int)$x->starts_at,
            'endsAt'=>$x->ends_at===null?null:(int)$x->ends_at,
            'privateEnvelope'=>json_decode($x->private_envelope_json,true,16,JSON_THROW_ON_ERROR),
        ])->values()->all();
        return $this->sync->json(['items'=>$items,
            'nextCursor'=>$more&&$items?end($items)['assignmentId']:null]);
    }

    public function invite(Request $r,string $assignmentId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment-invite.v1',[
            'version','inviteId','assignmentId','ownerAccountId',
            'recipientAccountId','recipientKeyDigest','role','expiresAt','envelope',
        ]);
        C::invite($c,$actor->id,$assignmentId);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($c,$actor,$assignmentId,$r,$hash){
            $a=DB::table('assignment_records_v1')
                ->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a&&$a->owner_account_id===$actor->id,404);
            abort_unless($a->state==='active',409);
            $recipient=DB::table('identity_accounts')
              ->where('id',$c['recipientAccountId'])->where('status','ready')->first();
            abort_unless($recipient,404);
            $key=DB::table('account_exchange_keys')->where('account_id',$recipient->id)->first();
            abort_unless($key&&hash_equals($key->descriptor_hash,$c['recipientKeyDigest']),409);
            $other=DB::table('assignment_invites_v1')
                ->where('assignment_id',$assignmentId)
                ->where('recipient_account_id',$recipient->id)->first();
            if($other){
                abort_unless($other->id===$c['inviteId']
                  &&hash_equals($other->contract_hash,$hash),409);
                return $this->sync->json(['inviteId'=>$other->id,
                  'state'=>$other->state,'unchanged'=>true]);
            }
            DB::table('assignment_invites_v1')->insert([
                'id'=>$c['inviteId'],'assignment_id'=>$assignmentId,
                'owner_account_id'=>$actor->id,
                'recipient_account_id'=>$recipient->id,'role'=>'contributor',
                'recipient_key_digest'=>$c['recipientKeyDigest'],
                'state'=>'pending','contract_hash'=>$hash,
                'contract_json'=>$r->json('contract'),
                'owner_signature'=>$r->json('signature'),
                'expires_at'=>$c['expiresAt'],'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json(['inviteId'=>$c['inviteId'],
              'state'=>'pending','unchanged'=>false],201);
        },3);
    }

    public function inbox(Request $r)
    {
        [$actor]=$this->sync->actor($r);
        $rows=DB::table('assignment_invites_v1 as i')
            ->join('assignment_records_v1 as a','a.id','=','i.assignment_id')
            ->join('identity_accounts as o','o.id','=','i.owner_account_id')
            ->where('i.recipient_account_id',$actor->id)
            ->whereIn('i.state',['pending','accepted'])
            ->where('i.expires_at','>',PhotoSync::nowMs())
            ->where('a.state','active')
            ->orderBy('i.id')->limit(50)
            ->get(['i.id','i.assignment_id','i.state','i.role',
              'i.contract_json','i.owner_signature','i.expires_at',
              'o.account_spki','i.owner_account_id']);
        return $this->sync->json(['items'=>$rows->map(fn($x)=>[
            'inviteId'=>$x->id,'assignmentId'=>$x->assignment_id,
            'ownerAccountId'=>$x->owner_account_id,
            'ownerAccountSpki'=>$x->account_spki,
            'role'=>$x->role,'state'=>$x->state,
            'expiresAt'=>(int)$x->expires_at,
            'contract'=>$x->contract_json,'signature'=>$x->owner_signature,
        ])->all()]);
    }

    public function accept(Request $r,string $assignmentId,string $inviteId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment-accept.v1',[
            'version','action','inviteId','assignmentId','recipientAccountId','operationId',
        ]);
        C::acceptance($c,$actor->id,$assignmentId,$inviteId);
        return DB::transaction(function()use($actor,$c,$assignmentId,$inviteId,$r){
            $a=DB::table('assignment_records_v1')
                ->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a&&$a->state==='active',404);
            $invite=DB::table('assignment_invites_v1')
                ->where('id',$inviteId)->where('assignment_id',$a->id)
                ->where('recipient_account_id',$actor->id)->lockForUpdate()->first();
            abort_unless($invite,404);
            abort_if($invite->expires_at<=PhotoSync::nowMs(),410);
            if($invite->state==='accepted'){
                abort_unless($invite->accepted_operation_id===$c['operationId']
                  &&hash_equals(hash('sha256',$invite->accepted_contract),
                    hash('sha256',$r->json('contract'))),409);
                return $this->sync->json(['inviteId'=>$inviteId,
                  'state'=>'accepted','unchanged'=>true]);
            }
            abort_unless($invite->state==='pending',409);
            DB::table('assignment_invites_v1')->where('id',$inviteId)->update([
                'state'=>'accepted','accepted_at'=>now(),
                'accepted_operation_id'=>$c['operationId'],
                'accepted_contract'=>$r->json('contract'),
                'accepted_signature'=>$r->json('signature'),
                'updated_at'=>now(),
            ]);
            return $this->sync->json(['inviteId'=>$inviteId,
              'state'=>'accepted','unchanged'=>false]);
        },3);
    }

    public function submit(Request $r,string $assignmentId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment-submit.v1',[
            'version','submissionId','operationId','assignmentId',
            'contributorAccountId','photoId','photoGrantId','policyRevision','kind',
        ]);
        C::submission($c,$actor->id,$assignmentId);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($c,$actor,$hash,$r,$assignmentId){
            $a=DB::table('assignment_records_v1')
                ->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a,404);
            abort_unless($a->state==='active' && $a->policy_revision===$c['policyRevision']
                && $a->starts_at<=PhotoSync::nowMs()
                &&($a->ends_at===null || $a->ends_at>PhotoSync::nowMs()),409);
            $joined=DB::table('assignment_invites_v1')->where('assignment_id',$a->id)
                ->where('recipient_account_id',$actor->id)->where('role','contributor')
                ->where('state','accepted')->first();
            abort_unless($joined,403);
            $photo=DB::table('photo_records')->where('id',$c['photoId'])
                ->where('account_id',$actor->id)->first();
            abort_unless($photo&&$photo->state==='active'
                &&$photo->expires_at>PhotoSync::nowMs(),404);
            $grant=DB::table('photo_access_grants')
                ->where('id',$c['photoGrantId'])->where('photo_id',$photo->id)
                ->where('owner_account_id',$actor->id)
                ->where('recipient_account_id',$a->owner_account_id)
                ->where('state','active')->first();
            abort_unless($grant&&$grant->expires_at>PhotoSync::nowMs(),403);
            $existing=DB::table('assignment_submissions_v1')
                ->where('id',$c['submissionId'])->first();
            if($existing){
                abort_unless($existing->contributor_account_id===$actor->id
                  &&hash_equals($existing->contract_hash,$hash),409);
                return $this->sync->json(['submissionId'=>$existing->id,'unchanged'=>true]);
            }
            abort_if(DB::table('assignment_submissions_v1')
                ->where('photo_id',$c['photoId'])->orWhere('operation_id',$c['operationId'])
                ->exists(),409);
            DB::table('assignment_submissions_v1')->insert([
                'id'=>$c['submissionId'],'assignment_id'=>$assignmentId,
                'contributor_account_id'=>$actor->id,'photo_id'=>$photo->id,
                'photo_grant_id'=>$grant->id,'operation_id'=>$c['operationId'],
                'policy_revision'=>1,'contract_hash'=>$hash,
                'contract_json'=>$r->json('contract'),'contributor_signature'=>$r->json('signature'),
                'created_at'=>now(),
            ]);
            return $this->sync->json(['submissionId'=>$c['submissionId'],
              'unchanged'=>false],201);
        },3);
    }

    public function submissions(Request $r,string $assignmentId)
    {
        [$actor]=$this->sync->actor($r);
        $assignment=$this->assignment($assignmentId);
        abort_unless($assignment->owner_account_id===$actor->id,404);
        $rows=DB::table('assignment_submissions_v1 as s')
            ->join('photo_records as p','p.id','=','s.photo_id')
            ->join('photo_access_grants as g','g.id','=','s.photo_grant_id')
            ->where('s.assignment_id',$assignmentId)
            ->where('p.state','active')->where('p.expires_at','>',PhotoSync::nowMs())
            ->where('g.state','active')->where('g.expires_at','>',PhotoSync::nowMs())
            ->orderBy('s.id')->limit(50)
            ->get(['s.id','s.photo_id','s.photo_grant_id','s.contributor_account_id']);
        return $this->sync->json(['items'=>$rows->map(fn($x)=>[
            'submissionId'=>$x->id,'photoId'=>$x->photo_id,
            'photoGrantId'=>$x->photo_grant_id,
            'contributorAccountId'=>$x->contributor_account_id,
        ])->all()]);
    }
}
