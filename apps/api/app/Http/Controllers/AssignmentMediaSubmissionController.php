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
        $v3=is_array($candidate)&&($candidate['version']??null)===3;
        $keys=[
            'version','submissionId','operationId','assignmentId',
            'contributorAccountId','mediaId','mediaGrantId',
            'mediaContractHash','policyRevision','policyHash','kind',
        ];
        if($v2)array_push($keys,'captureContract','captureSignature');
        $d=C::signed($raw['contract'],$raw['signature'],
            $actor->account_spki,$v3
                ?'pb3.assignment-media-submit.v3'
                :($v2?'pb3.assignment-media-submit.v2'
                    :'pb3.assignment-media-submit.v1'),$keys);
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
            // V3 is deliberately ONLY the contributor's P2 PhotoMediaFile
            // *submission consent*, NOT a recording/provenance attestation.
            // Legacy photo_records + existing v1/v2 AV semantics stay intact.
            // Photo-only root assignments remain legitimately photo-capable.
            $p2Photo=$d['version']===3;
            $policy=$a->latest_policy_contract??$a->contract_json;
            abort_unless(is_string($policy),409);
            $p=json_decode($policy,true,32,JSON_THROW_ON_ERROR);
            $v=$p['version']??null;
            if($p2Photo){
                abort_unless(in_array($v,[1,2,3,4,5,6],true)
                    &&hash_equals(hash('sha256',$policy),$d['policyHash']),409);
                if((int)$a->policy_revision===1){
                    abort_unless($a->latest_policy_contract===null
                        &&($p['assignmentId']??null)===$a->id
                        &&($p['ownerAccountId']??null)===$a->owner_account_id
                        &&P::verify(DB::table('identity_accounts')
                            ->where('id',$a->owner_account_id)
                            ->value('account_spki'),
                            "pb3.assignment.v1\n".$policy,
                            $a->owner_signature),409);
                }else{
                    $ownerSpki=DB::table('identity_accounts')
                        ->where('id',$a->owner_account_id)->value('account_spki');
                    abort_unless($a->latest_policy_contract!==null
                        &&is_string($ownerSpki)
                        &&($p['toPolicyRevision']??null)===$d['policyRevision']
                        &&P::verify($ownerSpki,
                            "pb3.assignment-policy.v".$v."\n".$policy,
                            $a->latest_policy_signature),409);
                }
                abort_unless($v<3 ||(
                    is_array($p['allowedMedia']??null)
                    &&C::allowedMedia($p['allowedMedia'],true)
                    &&in_array('photo',$p['allowedMedia'],true)),409);
            }else{
                // Older signed AV versions still require explicit v3+ opt-in.
                abort_unless(in_array($v,[3,4,5,6],true)
                    &&is_array($p['allowedMedia']??null)
                    &&C::allowedMedia($p['allowedMedia'],true)
                    &&in_array($d['kind'],$p['allowedMedia'],true)
                    &&($p['toPolicyRevision']??null)===$d['policyRevision']
                    &&hash_equals(hash('sha256',$policy),
                        $d['policyHash']),409);
            }
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
                &&($p2Photo
                    ?($grant->assignment_id===$assignmentId)
                    :($grant->assignment_id===null
                        ||$grant->assignment_id===$assignmentId))
                &&$grant->expires_at<=$media->expires_at
                &&hash_equals($grant->media_contract_hash,
                    $media->contract_hash),403);
            if($p2Photo){
                // v1 personal grants are NOT sufficient for a Photo
                // assignment receipt. The contributor must separately sign
                // an assignment-scoped v2 E2EE grant to this owner.
                $g=json_decode($grant->contract_json,true,32);
                $gOwner=DB::table('identity_accounts')
                    ->where('id',$actor->id)->value('account_spki');
                abort_unless(is_array($g)&&($g['version']??null)===2
                    &&($g['scope']??null)==='read'
                    &&($g['assignmentId']??null)===$assignmentId
                    &&($g['mediaId']??null)===$media->id
                    &&($g['mediaContractHash']??null)===$media->contract_hash
                    &&($g['ownerAccountId']??null)===$actor->id
                    &&($g['recipientAccountId']??null)===$a->owner_account_id
                    &&($g['grantId']??null)===$grant->id
                    &&($g['expiresAt']??null)===(int)$grant->expires_at
                    &&hash_equals(hash('sha256',$grant->contract_json),
                        $grant->contract_hash)
                    &&is_string($gOwner)
                    &&P::verify($gOwner,"pb3.media-grant.v2\n".
                        $grant->contract_json,$grant->account_signature),403);
            }
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
            ->where(function($scope){
                // Modern P2 photo provenance is only valid while the
                // contributor is still a currently accepted participant.
                // Existing v1/v2 audio/video receipts keep their behavior.
                $scope->where('s.media_type','!=','photo')
                    ->orWhere(function($photo){
                        $photo->whereColumn('g.assignment_id','s.assignment_id')
                            ->whereExists(function($membership){
                                $membership->selectRaw('1')
                                    ->from('assignment_invites_v1 as i')
                                    ->whereColumn('i.assignment_id',
                                        's.assignment_id')
                                    ->whereColumn('i.recipient_account_id',
                                        's.contributor_account_id')
                                    ->where('i.role','contributor')
                                    ->where('i.state','accepted');
                            });
                    });
            })
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
