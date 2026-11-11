<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Private owner-signed FUTURE Public Card display ceiling only.
 * This controller has no anonymous route, token, DEK, image or metadata
 * endpoint. Persisting a preview policy DOES NOT publish or grant access.
 */
final class MediaFilePreviewPolicyController extends Controller
{
    private const DOMAIN="pb3.media-file-preview-policy.v1\n";
    private const EMPTY_HASH='0000000000000000000000000000000000000000000000000000000000000000';
    private const FIELDS=[
        'description','capturedAt','updatedAt','tags',
        'authorTeam','gps','metadata',
    ];
    private const ACTIONS=['view','copy','download','share'];

    public function __construct(private readonly PhotoSync $sync){}

    private function validateContract(string $json,object $owner,
        bool $requireFuture=true):array
    {
        abort_unless(strlen($json)>=350&&strlen($json)<=5000,422);
        try{$c=json_decode($json,true,16,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,[
            'version','operationId','accountId',
            'sourceMediaId','safeMediaId','sourceContractHash',
            'safeContractHash','fromRevision','toRevision',
            'previousPolicyHash','publication','fields','actions',
            'expiresAt',
        ]);
        abort_unless($c['version']===1
            &&$c['accountId']===$owner->id
            &&is_int($c['fromRevision'])&&$c['fromRevision']>=0
            &&$c['fromRevision']<100
            &&$c['toRevision']===$c['fromRevision']+1
            &&$c['publication']==='disabled'
            &&is_int($c['expiresAt'])
            &&$c['expiresAt']>0
            &&(!$requireFuture||$c['expiresAt']>PhotoSync::nowMs()),422);
        foreach(['operationId','accountId','sourceMediaId','safeMediaId'] as $key){
            abort_unless(is_string($c[$key]),422);
            P::uuid($c[$key]);
        }
        abort_unless($c['sourceMediaId']!==$c['safeMediaId'],422);
        foreach(['sourceContractHash','safeContractHash',
            'previousPolicyHash'] as $key){
            abort_unless(is_string($c[$key])
                &&preg_match('/^[0-9a-f]{64}$/D',$c[$key])===1,422);
        }
        foreach(['fields'=>self::FIELDS,'actions'=>self::ACTIONS] as $key=>$names){
            abort_unless(is_array($c[$key])&&!array_is_list($c[$key]),422);
            P::exact($c[$key],$names);
            foreach($names as $name){
                abort_unless(is_bool($c[$key][$name]),422);
            }
        }
        // Owner can set future visibility ceiling, but cannot activate
        // ANY public operation until a separate signed public grant design.
        foreach(self::ACTIONS as $action){
            abort_unless($c['actions'][$action]===false,422);
        }
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)
            ===$json,422);
        return $c;
    }

    private function files(string $accountId,string $sourceId,string $safeId,
        bool $lock=false):array
    {
        $q=DB::table('media_files_v1')->where('account_id',$accountId)
            ->whereIn('id',[$sourceId,$safeId])->orderBy('id');
        if($lock)$q->lockForUpdate();
        $found=$q->get()->keyBy('id');
        $source=$found->get($sourceId);$safe=$found->get($safeId);
        abort_unless($source&&$safe,404);
        $now=PhotoSync::nowMs();
        foreach([$source,$safe] as $row){
            abort_unless($row->media_type==='photo',422);
            abort_if($row->state!=='active'||$row->expires_at<=$now,410);
            abort_if(DB::table('browser_archive_entries_v1')
                ->where('kind','media')->where('asset_id',$row->id)
                ->whereIn('state',['archived','deleting'])->exists(),410);
        }
        return [$source,$safe];
    }

    private function verifiedHistory(string $safeMediaId,
        object $owner,object $source,object $safe):array
    {
        $events=DB::table('media_file_preview_policy_events_v1')
            ->where('safe_media_id',$safeMediaId)
            ->orderBy('to_revision')->limit(101)->get();
        abort_if($events->count()>100,409);
        $revision=0;$previous=self::EMPTY_HASH;
        foreach($events as $event){
            abort_unless($event->account_id===$owner->id
                &&$event->source_media_id===$source->id
                &&(int)$event->from_revision===$revision
                &&(int)$event->to_revision===$revision+1
                &&hash_equals($previous,$event->previous_policy_hash)
                &&hash_equals(hash('sha256',$event->contract_json),
                    $event->contract_hash)
                &&P::verify($owner->account_spki,
                    self::DOMAIN.$event->contract_json,
                    $event->account_signature),409);
            $c=$this->validateContract($event->contract_json,$owner,false);
            abort_unless($c['operationId']===$event->operation_id
                &&$c['sourceMediaId']===$source->id
                &&$c['safeMediaId']===$safe->id
                &&hash_equals($source->contract_hash,$c['sourceContractHash'])
                &&hash_equals($safe->contract_hash,$c['safeContractHash'])
                &&$c['fromRevision']===$revision
                &&$c['toRevision']===$revision+1
                &&$c['previousPolicyHash']===$previous,409);
            $previous=$event->contract_hash;
            $revision++;
        }
        return ['revision'=>$revision,'hash'=>$previous,
            'events'=>$events];
    }

    public function show(Request $request,string $safeMediaId)
    {
        P::uuid($safeMediaId);
        [$owner]=$this->sync->actor($request);
        $current=DB::table('media_file_preview_policies_v1')
            ->where('safe_media_id',$safeMediaId)
            ->where('account_id',$owner->id)->first();
        if(!$current){
            // Unknown IDs must not reveal private existence across accounts.
            abort(404);
        }
        [$source,$safe]=$this->files($owner->id,
            $current->source_media_id,$safeMediaId);
        abort_unless(hash_equals($source->contract_hash,
            $current->source_contract_hash)
            &&hash_equals($safe->contract_hash,
                $current->safe_contract_hash),409);
        $history=$this->verifiedHistory($safeMediaId,$owner,$source,$safe);
        $last=$history['events']->last();
        abort_unless($last
            &&(int)$current->revision===$history['revision']
            &&hash_equals($history['hash'],$current->contract_hash)
            &&hash_equals($last->contract_json,$current->contract_json)
            &&hash_equals($last->account_signature,$current->account_signature)
            &&(int)$last->to_revision===(int)$current->revision,409);
        // An already expired preview policy cannot be treated as a valid
        // permission ceiling, even though nothing was ever published.
        abort_if($current->expires_at_ms<=PhotoSync::nowMs(),410);
        return $this->sync->json([
            'safeMediaId'=>$safeMediaId,
            'sourceMediaId'=>$source->id,
            'revision'=>$history['revision'],
            'policyHash'=>$history['hash'],
            'contract'=>$current->contract_json,
            'signature'=>$current->account_signature,
            'published'=>false,
        ]);
    }

    public function store(Request $request)
    {
        $this->sync->origin($request);
        [$owner]=$this->sync->actor($request);
        $input=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($input['contract'])
            &&is_string($input['signature']),422);
        $c=$this->validateContract($input['contract'],$owner);
        abort_unless(P::verify($owner->account_spki,
            self::DOMAIN.$input['contract'],$input['signature']),401);
        $hash=hash('sha256',$input['contract']);

        return DB::transaction(function()use($c,$owner,$input,$hash){
            DB::table('identity_accounts')->where('id',$owner->id)
                ->lockForUpdate()->first();
            $existing=DB::table('media_file_preview_policy_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($existing){
                abort_unless($existing->account_id===$owner->id
                    &&$existing->safe_media_id===$c['safeMediaId']
                    &&hash_equals($existing->contract_hash,$hash),409);
                // Lost ACK may retry verbatim without duplicating an event.
                return $this->sync->json([
                    'safeMediaId'=>$c['safeMediaId'],
                    'revision'=>(int)$existing->to_revision,
                    'policyHash'=>$hash,'published'=>false,
                    'unchanged'=>true,
                ]);
            }
            [$source,$safe]=$this->files($owner->id,
                $c['sourceMediaId'],$c['safeMediaId'],true);
            abort_unless(hash_equals($source->contract_hash,
                $c['sourceContractHash'])
                &&hash_equals($safe->contract_hash,
                    $c['safeContractHash']),409);
            abort_unless($c['expiresAt']<=(int)$source->expires_at
                &&$c['expiresAt']<=(int)$safe->expires_at,422);
            $current=DB::table('media_file_preview_policies_v1')
                ->where('safe_media_id',$safe->id)->lockForUpdate()->first();
            abort_unless(!$current
                ||($current->account_id===$owner->id
                    &&$current->source_media_id===$source->id
                    &&hash_equals($current->source_contract_hash,
                        $source->contract_hash)
                    &&hash_equals($current->safe_contract_hash,
                        $safe->contract_hash)),409);
            $history=$this->verifiedHistory($safe->id,$owner,$source,$safe);
            abort_unless($history['revision']===$c['fromRevision']
                &&hash_equals($history['hash'],$c['previousPolicyHash'])
                &&($current===null||(
                    (int)$current->revision===$history['revision']
                    &&hash_equals($current->contract_hash,
                        $history['hash']))),409);
            $row=[
                'account_id'=>$owner->id,
                'source_media_id'=>$source->id,
                'source_contract_hash'=>$source->contract_hash,
                'safe_contract_hash'=>$safe->contract_hash,
                'revision'=>$c['toRevision'],
                'contract_hash'=>$hash,
                'contract_json'=>$input['contract'],
                'account_signature'=>$input['signature'],
                'expires_at_ms'=>$c['expiresAt'],
                'updated_at'=>now(),
            ];
            if($current){
                DB::table('media_file_preview_policies_v1')
                    ->where('safe_media_id',$safe->id)->update($row);
            }else{
                DB::table('media_file_preview_policies_v1')->insert([
                    'safe_media_id'=>$safe->id,
                    ...$row,'created_at'=>now(),
                ]);
            }
            DB::table('media_file_preview_policy_events_v1')->insert([
                'operation_id'=>$c['operationId'],
                'account_id'=>$owner->id,
                'source_media_id'=>$source->id,
                'safe_media_id'=>$safe->id,
                'from_revision'=>$c['fromRevision'],
                'to_revision'=>$c['toRevision'],
                'previous_policy_hash'=>$c['previousPolicyHash'],
                'contract_hash'=>$hash,
                'contract_json'=>$input['contract'],
                'account_signature'=>$input['signature'],
                'created_at'=>now(),
            ]);
            return $this->sync->json([
                'safeMediaId'=>$safe->id,
                'revision'=>$c['toRevision'],
                'policyHash'=>$hash,
                'published'=>false,'unchanged'=>false,
            ],201);
        },3);
    }
}
