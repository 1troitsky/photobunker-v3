<?php
declare(strict_types=1);
namespace App\Photo;
use App\Identity\Protocol as P;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class Reservation
{
    public function __construct(private readonly PhotoSync $sync){}
    public function reserve(Request $request):array {
        $this->sync->origin($request);
        [$account,$device]=$this->sync->actor($request);
        $d=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($d['contract'])&&is_string($d['signature']),422);
        $contract=$this->sync->validate($d['contract'],$d['signature'],$device->signing_spki);
        // Personal photographs use v1; assignment-scoped photos use v2.
        abort_unless(in_array($contract['version'],[1,2],true),422);
        foreach($contract['assets'] as $a)abort_unless($a['manifest']['accountId']===$account->id,403);
        $hash=hash('sha256',$d['contract']);
        return DB::transaction(function()use($account,$device,$contract,$d,$hash){
            DB::table('identity_accounts')->where('id',$account->id)->lockForUpdate()->first();
            $id=$contract['photoId'];
            abort_if(DB::table('photo_tombstones')->where('photo_id',$id)->exists(),410);
            $row=DB::table('photo_records')->where('id',$id)->lockForUpdate()->first();
            $byOperation=DB::table('photo_records')->where('account_id',$account->id)
                ->where('operation_id',$contract['operationId'])->first();
            if($row||$byOperation){
                $existing=$row??$byOperation;
                abort_unless($existing->id===$id&&$existing->account_id===$account->id,409);
                abort_if($existing->expires_at<=PhotoSync::nowMs()||$existing->state==='deleting',410);
                // Only personal contracts v1 are enabled at this phase.
                abort_unless(hash_equals($existing->contract_hash,$hash),409);
                return $existing->state==='active'
                  ?['state'=>'active','receipt'=>json_decode($existing->receipt,true)]
                  :['state'=>'pending','photoId'=>$id,'expiresAt'=>(int)$existing->expires_at];
            }
            if($contract['version']===2){
                $this->requireCaptureAuthority($contract['capture'],$account->id);
            }
            $need=array_sum(array_column($contract['assets'],'bytes'));
            $used=DB::table('photo_objects as o')->join('photo_records as p','o.photo_id','=','p.id')
                ->where('p.account_id',$account->id)->where('p.state','!=','deleting')
                ->where('p.expires_at','>',PhotoSync::nowMs())->sum('o.bytes');
            abort_if((int)$used+$need>config('photo_sync.bootstrap_free_byte_cap'),413);
            // Account row is locked above: quota/file reservations are serialized per account.
            $count=DB::table('photo_records')->where('account_id',$account->id)
                ->where('state','!=','deleting')->where('expires_at','>',PhotoSync::nowMs())->count();
            abort_if($count>=(int)config('photo_sync.bootstrap_free_file_cap',50),413);
            DB::table('photo_records')->insert([
                'id'=>$id,'account_id'=>$account->id,'device_id'=>$device->id,
                'operation_id'=>$contract['operationId'],'state'=>'pending',
                'expires_at'=>$contract['expiresAt'],'contract_hash'=>$hash,
                'contract_json'=>$d['contract'],'signature'=>$d['signature'],
                'metadata_asset_id'=>collect($contract['assets'])->firstWhere('kind','metadata')['assetId'],
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            foreach($contract['assets'] as $a)DB::table('photo_objects')->insert([
                'id'=>$a['assetId'],'photo_id'=>$id,'kind'=>$a['kind'],'revision'=>1,
                'bytes'=>$a['bytes'],'sha256'=>$a['sha256'],
                'manifest_json'=>json_encode($a['manifest'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                'object_key'=>$this->sync->objectKey($account->id,$id,$a['assetId']),
                'state'=>'pending','created_at'=>now(),'updated_at'=>now(),
            ]);
            // Register logical asset placements before the first storage write.
            foreach($contract['assets'] as $asset){
                DB::table('storage_locations')->insert([
                    'id'=>(string)\Illuminate\Support\Str::uuid(),
                    'asset_id'=>$asset['assetId'],'provider'=>'app_s3',
                    'object_key'=>$this->sync->objectKey($account->id,$id,$asset['assetId']),
                    'sha256'=>$asset['sha256'],'bytes'=>$asset['bytes'],
                    'state'=>'reserved','created_at'=>now(),'updated_at'=>now(),
                ]);
            }
            return ['state'=>'pending','photoId'=>$id,'expiresAt'=>$contract['expiresAt']];
        },3);
    }
    /**
     * Check authoritative assignment state and membership on reservation.
     * Device-signed capturedAt is not a trusted wall-clock oracle.
     */
    private function requireCaptureAuthority(array $capture,string $actor):void
    {
        $a=DB::table('assignment_records_v1')
            ->where('id',$capture['assignmentId'])->lockForUpdate()->first();
        abort_unless($a,404);
        abort_unless($a->owner_account_id===$capture['ownerAccountId'],409);
        $when=$capture['capturedAt'];
        abort_unless($when>=(int)$a->starts_at
            &&($a->ends_at===null || $when<(int)$a->ends_at)
            &&$when>=PhotoSync::nowMs()-14*86400000,409);
        // Historical owner-signed policy revisions are not retroactive:
        // a photo taken before a policy edit can reserve its original signed
        // contract after reconnection. Never trust the mutable current goal
        // or silently relabel a previous capture as a new revision.
        $policyEvents=DB::table('assignment_policy_events_v1')
            ->where('assignment_id',$a->id)->orderBy('to_revision')
            ->limit(1001)->get([
                'from_revision','to_revision','contract_hash','contract_json',
                'occurred_at_ms','created_at',
            ]);
        abort_unless($policyEvents->count()<=1000,409);
        $rootHash=hash('sha256',$a->contract_json);
        $policyRevision=1;
        $policyHash=$rootHash;
        $policyOpen=(int)$a->starts_at;
        $previousPolicyAt=0;
        $policyEligible=false;
        foreach($policyEvents as $event){
            $at=(int)$event->occurred_at_ms;
            $second=\Carbon\CarbonImmutable::parse($event->created_at,'UTC')
                ->getTimestampMs();
            abort_unless($at>=$second&&$at<$second+1000
                &&$at>=$previousPolicyAt
                &&(int)$event->from_revision===$policyRevision
                &&(int)$event->to_revision===$policyRevision+1
                &&hash_equals(hash('sha256',$event->contract_json),
                    $event->contract_hash),409);
            $change=json_decode($event->contract_json,true,32,JSON_THROW_ON_ERROR);
            abort_unless($change['version']===1
                &&$change['assignmentId']===$a->id
                &&$change['ownerAccountId']===$a->owner_account_id
                &&$change['rootPolicyHash']===$rootHash
                &&$change['previousPolicyHash']===$policyHash
                &&$change['fromPolicyRevision']===$policyRevision
                &&$change['toPolicyRevision']===$policyRevision+1,409);
            if($capture['policyRevision']===$policyRevision
                &&hash_equals($policyHash,$capture['policyHash'])
                &&$when>=$policyOpen&&$when<$at)$policyEligible=true;
            $policyRevision++;
            $policyHash=$event->contract_hash;
            $policyOpen=$at;
            $previousPolicyAt=$at;
        }
        abort_unless($policyRevision===(int)$a->policy_revision
            &&($policyRevision===1
                ?$a->latest_policy_contract===null
                :hash_equals(hash('sha256',$a->latest_policy_contract??''),$policyHash)),409);
        if($capture['policyRevision']===$policyRevision
            &&hash_equals($policyHash,$capture['policyHash'])
            &&$when>=$policyOpen)$policyEligible=true;
        abort_unless($policyEligible,409);
        // The server retains signed finish/resume events with authoritative
        // receipt timestamps. An offline photograph captured before finish
        // may still sync as contributor-owned ciphertext afterwards, but
        // capture during a closed interval must not be silently relabelled.
        // The device-signed capturedAt remains a *claim*, not a secure clock.
        $events=DB::table('assignment_state_events_v1')
            ->where('assignment_id',$a->id)->orderBy('to_revision')
            ->limit(1001)->get([
                'from_revision','to_revision','state','created_at','occurred_at_ms',
            ]);
        abort_unless($events->count()<=1000,409);
        $revision=1;
        $state='active';
        $openedAt=(int)$a->starts_at;
        // Finish can precede a scheduled start. Keep event monotonicity
        // independent of that start and intersect active intervals with it.
        $lastEventAt=0;
        $validInterval=false;
        foreach($events as $event){
            $secondStart=\Carbon\CarbonImmutable::parse(
                $event->created_at,'UTC')->getTimestampMs();
            if($event->occurred_at_ms===null){
                // Legacy events stored only at whole-second precision.
                // A capture inside this ambiguous second cannot safely be
                // classified as either pre-finish or post-finish. Fail closed
                // without deleting its locally encrypted ciphertext.
                abort_unless($when<$secondStart
                    ||$when>=$secondStart+1000,409);
                $at=$secondStart;
            }else{
                $at=(int)$event->occurred_at_ms;
                // A mismatch indicates a corrupt or inconsistent DB row;
                // do not grant access based on untrusted event timing.
                abort_unless($at>=$secondStart
                    &&$at<$secondStart+1000,409);
            }
            abort_unless((int)$event->from_revision===$revision
                &&(int)$event->to_revision===$revision+1
                &&$at>=$lastEventAt,409);
            if($state==='active'&&$when>=$openedAt&&$when<$at)
                $validInterval=true;
            $next=$event->state;
            abort_unless(($state==='active'&&$next==='finished')
                ||($state==='finished'&&$next==='active'),409);
            if($next==='active')$openedAt=max((int)$a->starts_at,$at);
            $state=$next;
            $revision++;
            $lastEventAt=$at;
        }
        abort_unless($state===$a->state
            &&$revision===(int)$a->revision,409);
        if($state==='active'&&$when>=$openedAt)
            $validInterval=true;
        abort_unless($validInterval,409);
        if($actor!==$a->owner_account_id){
            $member=DB::table('assignment_invites_v1')
                ->where('assignment_id',$a->id)
                ->where('recipient_account_id',$actor)
                ->where('role','contributor')
                ->where('state','accepted')
                ->first(['accepted_at']);
            abort_unless($member&&$member->accepted_at,403);
            // A contributor must have consented before capture. 120 seconds
            // accommodates ordinary device clock skew; capturedAt is still
            // an unaudited device claim, not trusted timestamp attestation.
            $joinedAt=\Carbon\Carbon::parse($member->accepted_at)->getTimestampMs();
            abort_unless($when>=$joinedAt-120000,403);
        }
    }
}
