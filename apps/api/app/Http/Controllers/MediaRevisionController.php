<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Immutable MediaRevision link. Every version is a SEPARATE completely
 * encrypted MediaFile with its own independent DEK/TTL/S3 objects/grants.
 * Linking changes no media bytes and never issues a recipient grant.
 */
final class MediaRevisionController extends Controller
{
    public function __construct(private readonly PhotoSync $sync){}

    private function signed(Request $request,object $account):array
    {
        $data=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($data['contract'])
            &&is_string($data['signature'])
            &&strlen($data['contract'])>=100
            &&strlen($data['contract'])<=12000,422);
        try{$c=json_decode($data['contract'],true,24,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,[
            'version','linkId','operationId','accountId',
            'rootMediaId','previousMediaId','newMediaId',
            'rootContractHash','previousContractHash','newContractHash',
            'fromRevision','toRevision',
        ]);
        abort_unless($c['version']===1
            &&$c['accountId']===$account->id
            &&is_int($c['fromRevision'])&&$c['fromRevision']>=1
            &&$c['fromRevision']<=999
            &&$c['toRevision']===$c['fromRevision']+1,422);
        foreach(['linkId','operationId','accountId','rootMediaId',
            'previousMediaId','newMediaId'] as $field){
            abort_unless(is_string($c[$field]),422);
            P::uuid($c[$field]);
        }
        abort_unless($c['rootMediaId']!==$c['newMediaId']
            &&$c['previousMediaId']!==$c['newMediaId'],422);
        foreach(['rootContractHash','previousContractHash','newContractHash']
            as $field){
            abort_unless(is_string($c[$field])
                &&preg_match('/^[0-9a-f]{64}$/D',$c[$field])===1,422);
        }
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)
            ===$data['contract'],422);
        abort_unless(P::verify($account->account_spki,
            "pb3.media-revision.v1\n".$data['contract'],$data['signature']),401);
        return $c;
    }

    private function history(string $rootId):\Illuminate\Support\Collection
    {
        $items=DB::table('media_revision_links_v1')
            ->where('root_media_id',$rootId)
            ->orderBy('to_revision')->limit(1001)->get();
        abort_unless($items->count()<=999,409);
        return $items;
    }

    private function assertChain(\Illuminate\Support\Collection $events,
        object $root,object $account):array
    {
        $revision=1;$head=$root->id;
        $previousHash=$root->contract_hash;
        foreach($events as $row){
            abort_unless($row->account_id===$account->id
                &&$row->root_media_id===$root->id
                &&(int)$row->from_revision===$revision
                &&(int)$row->to_revision===$revision+1
                &&$row->previous_media_id===$head
                &&hash_equals($previousHash,$row->previous_contract_hash)
                &&hash_equals($root->contract_hash,$row->root_contract_hash)
                &&hash_equals(hash('sha256',$row->contract_json),
                    $row->contract_hash)
                &&P::verify($account->account_spki,
                    "pb3.media-revision.v1\n".$row->contract_json,
                    $row->owner_signature),409);
            $contract=json_decode($row->contract_json,true,24,JSON_THROW_ON_ERROR);
            abort_unless(($contract['version']??null)===1
                &&($contract['linkId']??null)===$row->id
                &&($contract['rootMediaId']??null)===$root->id
                &&($contract['previousMediaId']??null)===$head
                &&($contract['newMediaId']??null)===$row->new_media_id
                &&($contract['newContractHash']??null)===$row->new_contract_hash
                &&($contract['previousContractHash']??null)===$previousHash
                &&($contract['fromRevision']??null)===$revision
                &&($contract['toRevision']??null)===$revision+1,409);
            $head=$row->new_media_id;
            $previousHash=$row->new_contract_hash;
            $revision++;
        }
        return ['revision'=>$revision,'headMediaId'=>$head,
            'headContractHash'=>$previousHash];
    }

    public function create(Request $request)
    {
        $this->sync->origin($request);
        [$account]=$this->sync->actor($request);
        $c=$this->signed($request,$account);
        $hash=hash('sha256',$request->json('contract'));
        return DB::transaction(function()use($c,$account,$hash,$request){
            DB::table('identity_accounts')->where('id',$account->id)
                ->lockForUpdate()->first();
            $previous=DB::table('media_revision_links_v1')
                ->where('id',$c['linkId'])
                ->orWhere('operation_id',$c['operationId'])->first();
            if($previous){
                abort_unless($previous->id===$c['linkId']
                    &&$previous->account_id===$account->id
                    &&hash_equals($previous->contract_hash,$hash),409);
                return $this->sync->json([
                    'linkId'=>$previous->id,
                    'rootMediaId'=>$previous->root_media_id,
                    'headMediaId'=>$previous->new_media_id,
                    'revision'=>(int)$previous->to_revision,
                    'unchanged'=>true,
                ]);
            }
            // All three records belong to one identity; a cross-account,
            // tombstoned, pending or expired MediaFile must fail closed.
            $records=DB::table('media_files_v1')
                ->whereIn('id',[$c['rootMediaId'],$c['previousMediaId'],
                    $c['newMediaId']])
                ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            foreach(['rootMediaId','previousMediaId','newMediaId'] as $field){
                $m=$records->get($c[$field]);
                abort_unless($m&&$m->account_id===$account->id,404);
                abort_if($m->state!=='active'
                    ||$m->expires_at<=PhotoSync::nowMs(),410);
            }
            $root=$records->get($c['rootMediaId']);
            $head=$records->get($c['previousMediaId']);
            $next=$records->get($c['newMediaId']);
            abort_unless($root->media_type===$head->media_type
                &&$head->media_type===$next->media_type,422);
            abort_unless(hash_equals($root->contract_hash,
                $c['rootContractHash'])
                &&hash_equals($head->contract_hash,
                    $c['previousContractHash'])
                &&hash_equals($next->contract_hash,
                    $c['newContractHash']),409);
            // Prevent re-linking a file already used as a revision or root
            // of another lineage. No cycles or forked tips are permitted.
            abort_if(DB::table('media_revision_links_v1')
                ->where('new_media_id',$c['newMediaId'])
                ->orWhere('root_media_id',$c['newMediaId'])
                ->orWhere('previous_media_id',$c['newMediaId'])
                ->exists(),409);
            $history=$this->history($root->id);
            $state=$this->assertChain($history,$root,$account);
            abort_unless($state['revision']===$c['fromRevision']
                &&$state['headMediaId']===$head->id
                &&hash_equals($state['headContractHash'],
                    $head->contract_hash),409);

            DB::table('media_revision_links_v1')->insert([
                'id'=>$c['linkId'],'account_id'=>$account->id,
                'operation_id'=>$c['operationId'],
                'root_media_id'=>$root->id,
                'previous_media_id'=>$head->id,
                'new_media_id'=>$next->id,
                'root_contract_hash'=>$root->contract_hash,
                'previous_contract_hash'=>$head->contract_hash,
                'new_contract_hash'=>$next->contract_hash,
                'from_revision'=>$c['fromRevision'],
                'to_revision'=>$c['toRevision'],
                'contract_hash'=>$hash,
                'contract_json'=>$request->json('contract'),
                'owner_signature'=>$request->json('signature'),
                'created_at'=>now(),
            ]);
            return $this->sync->json([
                'linkId'=>$c['linkId'],
                'rootMediaId'=>$root->id,
                'headMediaId'=>$next->id,
                'revision'=>$c['toRevision'],
                'unchanged'=>false,
            ],201);
        },3);
    }

    public function index(Request $request,string $rootMediaId)
    {
        [$account]=$this->sync->actor($request);
        P::uuid($rootMediaId);
        $root=DB::table('media_files_v1')
            ->where('id',$rootMediaId)
            ->where('account_id',$account->id)->first();
        if(!$root){
            abort_if(DB::table('media_tombstones_v1')
                ->where('media_id',$rootMediaId)
                ->where('account_id',$account->id)->exists(),410);
            abort(404);
        }
        abort_if($root->state==='deleting'
            ||$root->expires_at<=PhotoSync::nowMs(),410);
        $history=$this->history($root->id);
        $state=$this->assertChain($history,$root,$account);
        return $this->sync->json([
            'rootMediaId'=>$rootMediaId,
            'rootContractHash'=>$root->contract_hash,
            'revision'=>$state['revision'],
            'headMediaId'=>$state['headMediaId'],
            'events'=>$history->map(static fn($x)=>[
                'contract'=>$x->contract_json,
                'signature'=>$x->owner_signature,
                'contractHash'=>$x->contract_hash,
            ])->values()->all(),
        ]);
    }
}
