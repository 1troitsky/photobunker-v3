<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentRetention as Retention;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Signed, owner-only EDITORIAL association of an independently encrypted
 * safe JPEG with an assignment owned by the SAME identity. It is NOT evidence
 * of another contributor completing an assignment; it grants no access.
 */
final class SafeAssignmentEditorialLinkController extends Controller
{
    private const DOMAIN="pb3.safe-assignment-editorial-link.v1\n";
    private const REVOKE_DOMAIN="pb3.safe-assignment-editorial-detach.v1\n";
    private const FIELDS=[
        'description','capturedAt','updatedAt','tags',
        'authorTeam','gps','metadata',
    ];
    private const ZERO='0000000000000000000000000000000000000000000000000000000000000000';

    public function __construct(private readonly PhotoSync $sync){}

    private function exactSigned(string $raw,string $signature,string $spki,
        string $domain,array $keys):array
    {
        abort_unless(strlen($raw)>90&&strlen($raw)<=6000,422);
        try{$c=json_decode($raw,true,16,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,$keys);
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)
            ===$raw,422);
        abort_unless(P::verify($spki,$domain.$raw,$signature),401);
        return $c;
    }

    private function requireFields(array $contract):void
    {
        $fields=$contract['fields']??null;
        abort_unless(is_array($fields)&&!array_is_list($fields),409);
        P::exact($fields,self::FIELDS);
        foreach(self::FIELDS as $key)abort_unless(is_bool($fields[$key]),409);
        $actions=$contract['actions']??null;
        abort_unless(is_array($actions)&&!array_is_list($actions),409);
        P::exact($actions,['view','copy','download','share']);
        foreach(['view','copy','download','share'] as $action)
            abort_unless($actions[$action]===false,409);
        abort_unless(($contract['publication']??null)==='disabled',409);
    }

    private function ownerAssignment(string $assignmentId,object $actor,
        bool $lock=false):object
    {
        $q=DB::table('assignment_records_v1')
            ->where('id',$assignmentId)
            ->where('owner_account_id',$actor->id);
        if($lock)$q->lockForUpdate();
        $a=$q->first();
        abort_unless($a,404);
        abort_unless(hash_equals(hash('sha256',$a->contract_json),
            $a->contract_hash)
            &&P::verify($actor->account_spki,
                "pb3.assignment.v1\n".$a->contract_json,
                $a->owner_signature),409);
        Retention::current($a);
        abort_unless(Retention::filesOpen($a)
            &&!in_array($a->state,['archived','deleted','deleting'],true),410);
        return $a;
    }

    private function mediaFiles(array $c,object $actor,bool $lock=false):array
    {
        $q=DB::table('media_files_v1')
            ->where('account_id',$actor->id)
            ->whereIn('id',[$c['sourceMediaId'],$c['safeMediaId']])
            ->orderBy('id');
        if($lock)$q->lockForUpdate();
        $found=$q->get()->keyBy('id');
        $source=$found->get($c['sourceMediaId']);
        $safe=$found->get($c['safeMediaId']);
        abort_unless($source&&$safe&&$source->id!==$safe->id,404);
        foreach([$source,$safe] as $row){
            abort_unless($row->media_type==='photo'
                &&$row->state==='active'
                &&$row->expires_at>PhotoSync::nowMs(),410);
            abort_unless(!DB::table('browser_archive_entries_v1')
                ->where('kind','media')->where('asset_id',$row->id)
                ->whereIn('state',['archived','deleting'])->exists(),410);
        }
        abort_unless(hash_equals($source->contract_hash,
            $c['sourceContractHash'])
            &&hash_equals($safe->contract_hash,$c['safeContractHash']),409);
        return [$source,$safe];
    }

    /**
     * Validate *all* immutable signed revisions, not merely an untrusted
     * mutable "current" pointer, before using ANY proposed metadata flags.
     */
    private function policy(string $kind,string $id,object $actor,
        array $c,object $assignment,object $source,object $safe):array
    {
        $file=$kind==='file';
        $headTable=$file?'media_file_preview_policies_v1'
            :'assignment_preview_ceilings_v1';
        $eventTable=$file?'media_file_preview_policy_events_v1'
            :'assignment_preview_ceiling_events_v1';
        $col=$file?'safe_media_id':'assignment_id';
        $domain=$file?"pb3.media-file-preview-policy.v1\n"
            :"pb3.assignment-preview-ceiling.v1\n";
        $head=DB::table($headTable)->where($col,$id)->first();
        abort_unless($head&&($file?$head->account_id:$head->owner_account_id)
            ===$actor->id,409);
        $events=DB::table($eventTable)->where($col,$id)
            ->orderBy('to_revision')->limit(101)->get();
        abort_unless($events->count()>0&&$events->count()<=100,409);
        $previous=self::ZERO;$rev=0;$current=null;
        foreach($events as $event){
            abort_unless(hash_equals($previous,$event->previous_policy_hash)
                &&(int)$event->from_revision===$rev
                &&(int)$event->to_revision===$rev+1
                &&hash_equals(hash('sha256',$event->contract_json),
                    $event->contract_hash)
                &&P::verify($actor->account_spki,$domain.$event->contract_json,
                    $event->account_signature),409);
            try{$data=json_decode($event->contract_json,true,16,JSON_THROW_ON_ERROR);}
            catch(\Throwable){abort(409);}
            abort_unless(is_array($data)&&!array_is_list($data)
                &&json_encode($data,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)
                    ===$event->contract_json,409);
            P::exact($data,$file?[
                'version','operationId','accountId','sourceMediaId',
                'safeMediaId','sourceContractHash','safeContractHash',
                'fromRevision','toRevision','previousPolicyHash',
                'publication','fields','actions','expiresAt',
            ]:[
                'version','operationId','assignmentId','ownerAccountId',
                'rootPolicyHash','fromRevision','toRevision','previousPolicyHash',
                'publication','fields','actions','expiresAt',
            ]);
            $this->requireFields($data);
            abort_unless($data['version']===1
                &&$data['operationId']===$event->operation_id
                &&$data['fromRevision']===$rev
                &&$data['toRevision']===$rev+1
                &&$data['previousPolicyHash']===$previous
                &&is_int($data['expiresAt'])
                &&$data['expiresAt']>0,409);
            if($file){
                abort_unless($data['accountId']===$actor->id
                    &&$data['sourceMediaId']===$source->id
                    &&$data['safeMediaId']===$safe->id
                    &&$data['sourceContractHash']===$source->contract_hash
                    &&$data['safeContractHash']===$safe->contract_hash,409);
            }else{
                abort_unless($data['ownerAccountId']===$actor->id
                    &&$data['assignmentId']===$assignment->id
                    &&$data['rootPolicyHash']===$assignment->contract_hash,409);
            }
            $previous=$event->contract_hash;$current=$data;$rev++;
        }
        abort_unless($current
            &&(int)$head->revision===$rev
            &&hash_equals($head->contract_hash,$previous)
            &&hash_equals($head->contract_json,$events->last()->contract_json)
            &&hash_equals($head->account_signature??$head->owner_signature,
                $events->last()->account_signature??$events->last()->owner_signature)
            &&(int)$head->expires_at_ms===$current['expiresAt'],409);
        abort_unless($current['expiresAt']>PhotoSync::nowMs(),410);
        $limits=[$source->expires_at,$safe->expires_at];
        if(!$file){
            foreach([$assignment->files_access_until,
                $assignment->assignment_access_until] as $deadline){
                if($deadline!==null)$limits[]=(int)$deadline;
            }
        }
        abort_unless($current['expiresAt']<=min($limits),409);
        return $current['fields'];
    }

    private function effective(object $link,object $actor):array
    {
        abort_unless($link->owner_account_id===$actor->id,404);
        abort_unless($link->state==='active',410);
        $c=$this->exactSigned($link->contract_json,$link->account_signature,
            $actor->account_spki,self::DOMAIN,[
                'version','linkId','operationId','ownerAccountId',
                'assignmentId','sourceMediaId','safeMediaId',
                'sourceContractHash','safeContractHash',
                'assignmentRootHash','expiresAt',
            ]);
        abort_unless($c['version']===1
            &&$c['linkId']===$link->link_id
            &&$c['ownerAccountId']===$actor->id
            &&$c['assignmentId']===$link->assignment_id
            &&$c['sourceMediaId']===$link->source_media_id
            &&$c['safeMediaId']===$link->safe_media_id
            &&$c['sourceContractHash']===$link->source_contract_hash
            &&$c['safeContractHash']===$link->safe_contract_hash
            &&$c['assignmentRootHash']===$link->assignment_root_hash
            &&hash_equals(hash('sha256',$link->contract_json),$link->contract_hash)
            &&is_int($c['expiresAt'])
            &&$c['expiresAt']>PhotoSync::nowMs(),410);
        $a=$this->ownerAssignment($link->assignment_id,$actor);
        [$source,$safe]=$this->mediaFiles($c,$actor);
        abort_unless(hash_equals($a->contract_hash,
            $c['assignmentRootHash'])
            &&$c['expiresAt']<=min($source->expires_at,
                $safe->expires_at),410);
        $fieldsFile=$this->policy('file',$safe->id,$actor,$c,$a,$source,$safe);
        $fieldsAssignment=$this->policy('assignment',$a->id,$actor,
            $c,$a,$source,$safe);
        $candidate=[];
        foreach(self::FIELDS as $field)
            $candidate[$field]=$fieldsFile[$field]&&$fieldsAssignment[$field];
        return [
            'linkId'=>$link->link_id,'assignmentId'=>$a->id,
            'safeMediaId'=>$safe->id,'sourceMediaId'=>$source->id,
            'candidateFields'=>$candidate,
            'effectivePublicFields'=>array_fill_keys(self::FIELDS,false),
            'contract'=>$link->contract_json,
            'signature'=>$link->account_signature,
            'contractHash'=>$link->contract_hash,
            'published'=>false,'linked'=>true,
        ];
    }

    public function show(Request $r,string $safeMediaId)
    {
        P::uuid($safeMediaId);
        [$owner]=$this->sync->actor($r);
        $link=DB::table('safe_assignment_editorial_links_v1')
            ->where('safe_media_id',$safeMediaId)
            ->where('owner_account_id',$owner->id)->first();
        abort_unless($link,404);
        return $this->sync->json($this->effective($link,$owner));
    }

    public function create(Request $r)
    {
        $this->sync->origin($r);
        [$owner]=$this->sync->actor($r);
        $body=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($body['contract'])
            &&is_string($body['signature']),422);
        $c=$this->exactSigned($body['contract'],$body['signature'],
            $owner->account_spki,self::DOMAIN,[
                'version','linkId','operationId','ownerAccountId',
                'assignmentId','sourceMediaId','safeMediaId',
                'sourceContractHash','safeContractHash',
                'assignmentRootHash','expiresAt',
            ]);
        abort_unless($c['version']===1
            &&$c['ownerAccountId']===$owner->id
            &&is_int($c['expiresAt'])
            &&$c['expiresAt']>PhotoSync::nowMs(),422);
        foreach(['linkId','operationId','ownerAccountId','assignmentId',
            'sourceMediaId','safeMediaId'] as $field)
            P::uuid($c[$field]);
        abort_unless($c['sourceMediaId']!==$c['safeMediaId'],422);
        foreach(['sourceContractHash','safeContractHash',
            'assignmentRootHash'] as $h)
            abort_unless(is_string($c[$h])
                &&preg_match('/^[0-9a-f]{64}$/D',$c[$h])===1,422);
        $hash=hash('sha256',$body['contract']);

        return DB::transaction(function()use($owner,$c,$body,$hash){
            DB::table('identity_accounts')->where('id',$owner->id)
                ->lockForUpdate()->first();
            // This v1 expressly excludes contributor-owned media. It cannot
            // relabel a submission by a distinct account as "owner editorial".
            $a=$this->ownerAssignment($c['assignmentId'],$owner,true);
            abort_unless($a->state==='active',410);
            [$source,$safe]=$this->mediaFiles($c,$owner,true);
            abort_unless($c['assignmentRootHash']===$a->contract_hash
                &&$c['expiresAt']<=min($source->expires_at,
                    $safe->expires_at),422);
            foreach([$a->files_access_until,$a->assignment_access_until]
                as $deadline)
                abort_unless($deadline===null
                    ||$c['expiresAt']<=(int)$deadline,422);
            // A signed association requires both *current* independently
            // signed PRIVATE preview ceilings, not just arbitrary IDs.
            $this->policy('file',$safe->id,$owner,$c,$a,$source,$safe);
            $this->policy('assignment',$a->id,$owner,$c,$a,$source,$safe);
            $existing=DB::table('safe_assignment_editorial_links_v1')
                ->where('safe_media_id',$safe->id)->lockForUpdate()->first();
            if($existing){
                abort_unless($existing->state==='active'
                    &&$existing->owner_account_id===$owner->id
                    &&hash_equals($existing->contract_hash,$hash)
                    &&hash_equals($existing->account_signature,
                        $body['signature']),409);
                return $this->sync->json([
                    ...$this->effective($existing,$owner),'unchanged'=>true,
                ]);
            }
            DB::table('safe_assignment_editorial_links_v1')->insert([
                'safe_media_id'=>$safe->id,'link_id'=>$c['linkId'],
                'owner_account_id'=>$owner->id,'assignment_id'=>$a->id,
                'source_media_id'=>$source->id,
                'source_contract_hash'=>$source->contract_hash,
                'safe_contract_hash'=>$safe->contract_hash,
                'assignment_root_hash'=>$a->contract_hash,
                'contract_hash'=>$hash,'contract_json'=>$body['contract'],
                'account_signature'=>$body['signature'],'state'=>'active',
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json([
                ...$this->effective(DB::table('safe_assignment_editorial_links_v1')
                    ->where('safe_media_id',$safe->id)->first(),$owner),
                'unchanged'=>false,
            ],201);
        },3);
    }

    public function detach(Request $r,string $safeMediaId)
    {
        P::uuid($safeMediaId);
        $this->sync->origin($r);
        [$owner]=$this->sync->actor($r);
        $body=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($body['contract'])
            &&is_string($body['signature']),422);
        $c=$this->exactSigned($body['contract'],$body['signature'],
            $owner->account_spki,self::REVOKE_DOMAIN,[
                'version','operationId','linkId','ownerAccountId',
                'safeMediaId','linkContractHash','action',
            ]);
        abort_unless($c['version']===1&&$c['action']==='detach'
            &&$c['ownerAccountId']===$owner->id
            &&$c['safeMediaId']===$safeMediaId,422);
        foreach(['operationId','linkId','ownerAccountId','safeMediaId'] as $key)
            P::uuid($c[$key]);
        abort_unless(is_string($c['linkContractHash'])
            &&preg_match('/^[0-9a-f]{64}$/D',$c['linkContractHash'])===1,422);
        $hash=hash('sha256',$body['contract']);
        return DB::transaction(function()use($owner,$safeMediaId,$c,$hash,$body){
            DB::table('identity_accounts')->where('id',$owner->id)
                ->lockForUpdate()->first();
            $link=DB::table('safe_assignment_editorial_links_v1')
                ->where('safe_media_id',$safeMediaId)
                ->where('owner_account_id',$owner->id)
                ->lockForUpdate()->first();
            abort_unless($link,404);
            abort_unless($c['linkId']===$link->link_id
                &&hash_equals($c['linkContractHash'],$link->contract_hash),409);
            if($link->state==='detached'){
                abort_unless($link->detach_operation_id===$c['operationId']
                    &&hash_equals($link->detach_contract_hash,$hash)
                    &&hash_equals($link->detach_signature,$body['signature']),409);
                return $this->sync->json([
                    'safeMediaId'=>$safeMediaId,'linked'=>false,
                    'published'=>false,'unchanged'=>true,
                ]);
            }
            abort_unless($link->state==='active',410);
            DB::table('safe_assignment_editorial_links_v1')
                ->where('safe_media_id',$safeMediaId)->update([
                    'state'=>'detached','detach_operation_id'=>$c['operationId'],
                    'detach_contract_hash'=>$hash,
                    'detach_contract_json'=>$body['contract'],
                    'detach_signature'=>$body['signature'],'updated_at'=>now(),
                ]);
            return $this->sync->json([
                'safeMediaId'=>$safeMediaId,'linked'=>false,
                'published'=>false,'unchanged'=>false,
            ]);
        },3);
    }
}
