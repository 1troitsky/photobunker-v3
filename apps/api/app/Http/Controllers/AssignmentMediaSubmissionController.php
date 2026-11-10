<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Assignments\AssignmentSchedule as S;
use App\Assignments\AssignmentRetention as R;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Explicit opt-in v3 media policy + independently authorized recipient grant.
 * No photos/v1 contract, captures, or legacy grants are widened.
 */
final class AssignmentMediaSubmissionController extends Controller
{
    public function __construct(private readonly PhotoSync $sync){}

    private function assignment(string $id):object
    {
        P::uuid($id);
        $row=DB::table('assignment_records_v1')->where('id',$id)->first();
        abort_unless($row,404);
        return $row;
    }

    public function create(Request $r,string $assignmentId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $raw=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($raw['contract'])
            &&is_string($raw['signature']),422);
        $candidate=json_decode($raw['contract'],true,32);
        $v2=is_array($candidate)&&($candidate['version']??null)===2;
        $keys=[
            'version','submissionId','operationId','assignmentId',
            'contributorAccountId','mediaId','mediaGrantId',
            'mediaContractHash','policyRevision','policyHash','kind',
        ];
        if($v2)array_push($keys,'captureContract','captureSignature');
        $d=C::signed($raw['contract'],$raw['signature'],
            $actor->account_spki,$v2
                ?'pb3.assignment-media-submit.v2'
                :'pb3.assignment-media-submit.v1',$keys);
        C::mediaSubmission($d,$actor->id,$assignmentId);
        $hash=hash('sha256',$raw['contract']);

        return DB::transaction(function()use($r,$actor,$d,$hash,$assignmentId){
            $a=DB::table('assignment_records_v1')
                ->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a,404);
            // Lost ACK remains idempotent even after assignment finish,
            // grant expiry or revocation: receipt does not restore access.
            $previous=DB::table('assignment_media_submissions_v1')
                ->where('id',$d['submissionId'])
                ->orWhere('operation_id',$d['operationId'])->first();
            if($previous){
                abort_unless($previous->id===$d['submissionId']
                    &&$previous->assignment_id===$assignmentId
                    &&$previous->contributor_account_id===$actor->id
                    &&hash_equals($previous->contract_hash,$hash),409);
                return $this->sync->json([
                    'submissionId'=>$previous->id,'unchanged'=>true,
                ]);
            }
            $now=PhotoSync::nowMs();
            abort_unless($a->state==='active'
                &&R::filesOpen($a,$now)
                &&S::permits($a,$now)
                &&(int)$a->policy_revision===$d['policyRevision'],409);
            // Photo-only signed assignment roots cannot implicitly receive
            // video/audio, even if an E2EE grant already exists.
            $policy=$a->latest_policy_contract;
            abort_unless(is_string($policy),409);
            $p=json_decode($policy,true,32,JSON_THROW_ON_ERROR);
            abort_unless(in_array(($p['version']??null),[3,4,5,6],true)
                &&is_array($p['allowedMedia']??null)
                &&C::allowedMedia($p['allowedMedia'],true)
                &&in_array($d['kind'],$p['allowedMedia'],true)
                &&($p['toPolicyRevision']??null)===$d['policyRevision']
                &&hash_equals(hash('sha256',$policy),$d['policyHash']),409);
            $membership=DB::table('assignment_invites_v1')
                ->where('assignment_id',$assignmentId)
                ->where('recipient_account_id',$actor->id)
                ->where('role','contributor')->where('state','accepted')->first();
            abort_unless($membership,403);

            $media=DB::table('media_files_v1')
                ->where('id',$d['mediaId'])
                ->where('account_id',$actor->id)->first();
            abort_unless($media&&$media->state==='active'
                &&$media->expires_at>$now,404);
            abort_unless($media->media_type===$d['kind']
                &&hash_equals($media->contract_hash,
                    $d['mediaContractHash']),409);

            $capture=null;
            if($d['version']===2){
                abort_unless(is_string($d['captureContract']??null)
                    &&is_string($d['captureSignature']??null),422);
                $capture=C::signed($d['captureContract'],
                    $d['captureSignature'],$actor->account_spki,
                    'pb3.assignment-media-capture.v1',[
                        'version','assignmentId','ownerAccountId',
                        'contributorAccountId','policyRevision','policyHash',
                        'mediaId','mediaContractHash','mediaType',
                        'startedAt','finishedAt',
                    ]);
                C::mediaCapture($capture,$actor->id,$assignmentId);
                abort_unless($capture['ownerAccountId']===$a->owner_account_id
                    &&$capture['mediaId']===$media->id
                    &&$capture['mediaType']===$media->media_type
                    &&$capture['policyRevision']===$d['policyRevision']
                    &&hash_equals($capture['policyHash'],$d['policyHash'])
                    &&hash_equals($capture['mediaContractHash'],
                        $media->contract_hash)
                    &&S::permits($a,$capture['startedAt'])
                    &&S::permits($a,$capture['finishedAt']),409);
                // Server acceptance of the signed policy predates capture.
                // Allow only bounded client clock skew. Neither this check
                // nor the account signature attests real-world recording time.
                $policyAccepted=DB::table('assignment_policy_events_v1')
                    ->where('assignment_id',$assignmentId)
                    ->where('to_revision',$d['policyRevision'])
                    ->value('occurred_at_ms');
                abort_unless($policyAccepted!==null
                    &&$capture['startedAt']>=(int)$policyAccepted-120000,409);
            }

            // A valid, live grant must be for THIS immutable ciphertext,
            // supplied by THIS contributor, and addressed to THIS owner.
            $grant=DB::table('media_recipient_grants_v1')
                ->where('id',$d['mediaGrantId'])
                ->where('media_id',$media->id)
                ->where('owner_account_id',$actor->id)
                ->where('recipient_account_id',$a->owner_account_id)
                ->where('state','active')->first();
            abort_unless($grant&&$grant->expires_at>$now
                &&($grant->assignment_id===null
                    ||$grant->assignment_id===$assignmentId)
                &&$grant->expires_at<=$media->expires_at
                &&hash_equals($grant->media_contract_hash,
                    $media->contract_hash),403);
            abort_if(DB::table('assignment_media_submissions_v1')
                ->where('media_id',$media->id)->exists(),409);
            DB::table('assignment_media_submissions_v1')->insert([
                'id'=>$d['submissionId'],'assignment_id'=>$assignmentId,
                'contributor_account_id'=>$actor->id,
                'media_id'=>$media->id,'media_grant_id'=>$grant->id,
                'media_type'=>$d['kind'],
                'operation_id'=>$d['operationId'],
                'contract_hash'=>$hash,'contract_json'=>$r->json('contract'),
                'contributor_signature'=>$r->json('signature'),
                'policy_revision'=>$d['policyRevision'],
                'policy_hash'=>$d['policyHash'],
                'media_contract_hash'=>$media->contract_hash,
                'capture_contract_json'=>$d['version']===2
                    ?$d['captureContract']:null,
                'capture_signature'=>$d['version']===2
                    ?$d['captureSignature']:null,
                'created_at'=>now(),
            ]);
            return $this->sync->json([
                'submissionId'=>$d['submissionId'],'unchanged'=>false,
            ],201);
        },3);
    }

    public function index(Request $r,string $assignmentId)
    {
        [$actor]=$this->sync->actor($r);
        $a=$this->assignment($assignmentId);
        abort_unless($a->owner_account_id===$actor->id,404);
        abort_unless(R::filesOpen($a),404);
        $now=PhotoSync::nowMs();
        $after=$r->query('after');
        if($after!==null){
            abort_unless(is_string($after),422);
            P::uuid($after);
        }
        $q=DB::table('assignment_media_submissions_v1 as s')
            ->join('media_files_v1 as m','m.id','=','s.media_id')
            ->join('media_recipient_grants_v1 as g','g.id','=','s.media_grant_id')
            ->where('s.assignment_id',$assignmentId)
            ->whereColumn('m.account_id','s.contributor_account_id')
            ->whereColumn('m.contract_hash','s.media_contract_hash')
            ->whereColumn('g.media_id','s.media_id')
            ->whereColumn('g.owner_account_id','s.contributor_account_id')
            ->where('g.recipient_account_id',$actor->id)
            ->where('m.state','active')->where('m.expires_at','>',$now)
            ->where('g.state','active')->where('g.expires_at','>',$now);
        if($after!==null)$q->where('s.id','>',$after);
        $rows=$q->orderBy('s.id')->limit(51)->get([
            's.id','s.media_id','s.media_grant_id',
            's.media_type','s.contributor_account_id',
            's.capture_contract_json',
        ]);
        $more=$rows->count()>50;
        $items=$rows->take(50)->map(static fn($row)=>[
            'submissionId'=>$row->id,'mediaId'=>$row->media_id,
            'mediaGrantId'=>$row->media_grant_id,
            'mediaType'=>$row->media_type,
            'contributorAccountId'=>$row->contributor_account_id,
            'capturedInAssignment'=>$row->capture_contract_json!==null,
        ])->values()->all();
        return $this->sync->json([
            'items'=>$items,'nextCursor'=>$more&&$items!==[]
                ?end($items)['submissionId']:null,
        ]);
    }
}
