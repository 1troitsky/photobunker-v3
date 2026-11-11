<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentRetention as R;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P2: OWNER-ONLY preview ceiling for FUTURE assignment Public Cards.
 * Not the recording requirements and never a recipient/public access grant.
 * No external URLs, media bytes, DEKs, field values, or tokens are returned.
 */
final class AssignmentPreviewCeilingController extends Controller
{
    private const DOMAIN="pb3.assignment-preview-ceiling.v1\n";
    private const ZERO='0000000000000000000000000000000000000000000000000000000000000000';
    private const FIELDS=[
        'description','capturedAt','updatedAt','tags',
        'authorTeam','gps','metadata',
    ];
    private const ACTIONS=['view','copy','download','share'];

    public function __construct(private readonly PhotoSync $sync){}

    private function assignment(string $id,string $ownerId,bool $lock=false):object
    {
        P::uuid($id);
        $q=DB::table('assignment_records_v1')
            ->where('id',$id)->where('owner_account_id',$ownerId);
        if($lock)$q->lockForUpdate();
        $a=$q->first();
        abort_unless($a,404);
        // The immutable creation contract is the trust root; requirements
        // like requiredGps never imply visibility or future sharing rights.
        abort_unless(hash_equals(hash('sha256',$a->contract_json),$a->contract_hash),409);
        $spki=DB::table('identity_accounts')
            ->where('id',$ownerId)->where('status','ready')->value('account_spki');
        abort_unless(is_string($spki)
            &&P::verify($spki,"pb3.assignment.v1\n".$a->contract_json,
                $a->owner_signature),409);
        R::current($a); // fail if the effective retention policy was altered
        abort_unless(R::filesOpen($a),410);
        return $a;
    }

    private function validate(string $raw,string $accountId,
        string $assignmentId,bool $future=true):array
    {
        abort_unless(strlen($raw)>=300&&strlen($raw)<=5000,422);
        try{$c=json_decode($raw,true,16,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,[
            'version','operationId','assignmentId','ownerAccountId',
            'rootPolicyHash','fromRevision','toRevision','previousPolicyHash',
            'publication','fields','actions','expiresAt',
        ]);
        abort_unless($c['version']===1
            &&is_int($c['fromRevision'])
            &&$c['fromRevision']>=0&&$c['fromRevision']<100
            &&$c['toRevision']===$c['fromRevision']+1
            &&$c['publication']==='disabled'
            &&is_int($c['expiresAt'])&&$c['expiresAt']>0
            &&(!$future||$c['expiresAt']>PhotoSync::nowMs()),422);
        foreach(['operationId','assignmentId','ownerAccountId'] as $k){
            abort_unless(is_string($c[$k]),422);
            P::uuid($c[$k]);
        }
        abort_unless($c['assignmentId']===$assignmentId,422);
        abort_unless($c['ownerAccountId']===$accountId,403);
        foreach(['rootPolicyHash','previousPolicyHash'] as $k){
            abort_unless(is_string($c[$k])
                &&preg_match('/^[a-f0-9]{64}$/D',$c[$k])===1,422);
        }
        foreach(['fields'=>self::FIELDS,'actions'=>self::ACTIONS] as $k=>$names){
            abort_unless(is_array($c[$k])&&!array_is_list($c[$k]),422);
            P::exact($c[$k],$names);
            foreach($names as $n)abort_unless(is_bool($c[$k][$n]),422);
        }
        foreach(self::ACTIONS as $n)
            abort_unless($c['actions'][$n]===false,422);
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)
            ===$raw,422);
        return $c;
    }

    private function deadline(object $assignment):?int
    {
        $limits=array_filter([
            $assignment->files_access_until??null,
            $assignment->assignment_access_until??null,
        ],static fn($x)=>$x!==null);
        return $limits===[]?null:min(array_map('intval',$limits));
    }

    private function history(object $a,string $accountId,string $spki):array
    {
        $rows=DB::table('assignment_preview_ceiling_events_v1')
            ->where('assignment_id',$a->id)
            ->orderBy('to_revision')->limit(101)->get();
        abort_if($rows->count()>100,409);
        $rev=0;$prev=self::ZERO;
        foreach($rows as $e){
            abort_unless($e->assignment_id===$a->id
                &&$e->owner_account_id===$accountId
                &&(int)$e->from_revision===$rev
                &&(int)$e->to_revision===$rev+1
                &&hash_equals($prev,$e->previous_policy_hash)
                &&hash_equals(hash('sha256',$e->contract_json),
                    $e->contract_hash)
                &&P::verify($spki,self::DOMAIN.$e->contract_json,
                    $e->owner_signature),409);
            $c=$this->validate($e->contract_json,$accountId,$a->id,false);
            abort_unless($c['operationId']===$e->operation_id
                &&hash_equals($a->contract_hash,$c['rootPolicyHash'])
                &&$c['fromRevision']===$rev
                &&$c['toRevision']===$rev+1
                &&hash_equals($prev,$c['previousPolicyHash']),409);
            $rev++;$prev=$e->contract_hash;
        }
        return ['revision'=>$rev,'hash'=>$prev,'last'=>$rows->last()];
    }

    public function show(Request $request,string $assignmentId)
    {
        [$owner]=$this->sync->actor($request);
        $a=$this->assignment($assignmentId,$owner->id);
        $row=DB::table('assignment_preview_ceilings_v1')
            ->where('assignment_id',$assignmentId)->first();
        if(!$row)abort(404);
        $h=$this->history($a,$owner->id,$owner->account_spki);
        $signed=json_decode($row->contract_json,true,16,JSON_THROW_ON_ERROR);
        abort_unless($h['last']
            &&$row->owner_account_id===$owner->id
            &&hash_equals($row->root_policy_hash,$a->contract_hash)
            &&(int)$row->revision===$h['revision']
            &&hash_equals($row->contract_hash,$h['hash'])
            &&hash_equals($row->contract_json,$h['last']->contract_json)
            &&hash_equals($row->owner_signature,$h['last']->owner_signature)
            &&(int)$row->expires_at_ms===$signed['expiresAt']
            &&($this->deadline($a)===null
                ||(int)$row->expires_at_ms<=$this->deadline($a)),409);
        abort_if((int)$row->expires_at_ms<=PhotoSync::nowMs(),410);
        return $this->sync->json([
            'assignmentId'=>$assignmentId,'revision'=>$h['revision'],
            'policyHash'=>$h['hash'],'contract'=>$row->contract_json,
            'signature'=>$row->owner_signature,'published'=>false,
        ]);
    }

    public function store(Request $request,string $assignmentId)
    {
        $this->sync->origin($request);
        [$owner]=$this->sync->actor($request);
        $input=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($input['contract'])
            &&is_string($input['signature']),422);
        $c=$this->validate($input['contract'],$owner->id,$assignmentId);
        abort_unless(P::verify($owner->account_spki,
            self::DOMAIN.$input['contract'],$input['signature']),401);
        $hash=hash('sha256',$input['contract']);

        return DB::transaction(function()use($assignmentId,$owner,$c,$input,$hash){
            DB::table('identity_accounts')->where('id',$owner->id)
                ->lockForUpdate()->first();
            $a=$this->assignment($assignmentId,$owner->id,true);
            abort_unless(hash_equals($a->contract_hash,$c['rootPolicyHash']),409);
            $cutoff=$this->deadline($a);
            abort_unless($cutoff===null||$c['expiresAt']<=$cutoff,422);
            $existing=DB::table('assignment_preview_ceiling_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($existing){
                abort_unless($existing->owner_account_id===$owner->id
                    &&$existing->assignment_id===$assignmentId
                    &&hash_equals($existing->contract_hash,$hash),409);
                return $this->sync->json([
                    'assignmentId'=>$assignmentId,
                    'revision'=>(int)$existing->to_revision,
                    'policyHash'=>$hash,'published'=>false,'unchanged'=>true,
                ]);
            }
            $row=DB::table('assignment_preview_ceilings_v1')
                ->where('assignment_id',$assignmentId)
                ->lockForUpdate()->first();
            $history=$this->history($a,$owner->id,$owner->account_spki);
            abort_unless($c['fromRevision']===$history['revision']
                &&hash_equals($c['previousPolicyHash'],$history['hash'])
                &&(!$row||(
                    $row->owner_account_id===$owner->id
                    &&hash_equals($row->root_policy_hash,$a->contract_hash)
                    &&(int)$row->revision===$history['revision']
                    &&hash_equals($row->contract_hash,$history['hash'])
                    &&hash_equals($row->contract_json,
                        $history['last']->contract_json)
                    &&hash_equals($row->owner_signature,
                        $history['last']->owner_signature))),409);
            $values=[
                'owner_account_id'=>$owner->id,
                'root_policy_hash'=>$a->contract_hash,
                'revision'=>$c['toRevision'],'contract_hash'=>$hash,
                'contract_json'=>$input['contract'],
                'owner_signature'=>$input['signature'],
                'expires_at_ms'=>$c['expiresAt'],
                'updated_at'=>now(),
            ];
            if($row)DB::table('assignment_preview_ceilings_v1')
                ->where('assignment_id',$assignmentId)->update($values);
            else DB::table('assignment_preview_ceilings_v1')->insert([
                'assignment_id'=>$assignmentId,...$values,'created_at'=>now(),
            ]);
            DB::table('assignment_preview_ceiling_events_v1')->insert([
                'operation_id'=>$c['operationId'],
                'assignment_id'=>$assignmentId,
                'owner_account_id'=>$owner->id,
                'from_revision'=>$c['fromRevision'],
                'to_revision'=>$c['toRevision'],
                'previous_policy_hash'=>$c['previousPolicyHash'],
                'contract_hash'=>$hash,'contract_json'=>$input['contract'],
                'owner_signature'=>$input['signature'],'created_at'=>now(),
            ]);
            return $this->sync->json([
                'assignmentId'=>$assignmentId,'revision'=>$c['toRevision'],
                'policyHash'=>$hash,'published'=>false,'unchanged'=>false,
            ],201);
        },3);
    }
}
