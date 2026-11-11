<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentGrantScope as AScope;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use App\Storage\StorageManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * MediaFile-specific E2EE grants: v1 media has ONE wrapped independent
 * DEK for all chunks. Only the designated, fingerprint-verified recipient
 * can decrypt that DEK. The server sees neither media plaintext nor keys.
 *
 * Explicitly separate from photos/v1 grants. No grant is implied by an
 * assignment invite, contact, link or shared IP address.
 */
final class MediaGrantController extends Controller
{
    public function __construct(
        private readonly PhotoSync $sync,
        private readonly StorageManager $storage,
    ) {}

    private function contract(string $text):array
    {
        abort_unless(strlen($text)>=200&&strlen($text)<=12000,422);
        try{$c=json_decode($text,true,32,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        $v2=($c['version']??null)===2;
        P::exact($c,['version','grantId','mediaId','ownerAccountId',
            'recipientAccountId',...($v2?['assignmentId']:[]),
            'recipientKeyDigest','mediaContractHash',
            'scope','expiresAt','envelope']);
        abort_unless(in_array($c['version'],[1,2],true)&&$c['scope']==='read'
            &&is_int($c['expiresAt'])
            &&$c['expiresAt']>PhotoSync::nowMs()
            &&$c['expiresAt']<=PhotoSync::nowMs()+86400000,422);
        foreach(['grantId','mediaId','ownerAccountId','recipientAccountId',
            ...($v2?['assignmentId']:[])] as $field){
            abort_unless(is_string($c[$field]),422);
            P::uuid($c[$field]);
        }
        abort_unless($c['ownerAccountId']!==$c['recipientAccountId'],422);
        foreach(['recipientKeyDigest','mediaContractHash'] as $field){
            abort_unless(is_string($c[$field])
                &&preg_match('/^[a-f0-9]{64}$/D',$c[$field])===1,422);
        }
        $e=$c['envelope'];
        abort_unless(is_array($e)&&!array_is_list($e),422);
        P::exact($e,['ephemeralSpki','salt','iv','ciphertext']);
        P::spki($e['ephemeralSpki']);
        P::b64($e['salt'],16);
        P::b64($e['iv'],12);
        P::b64($e['ciphertext'],48);
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)
            ===$text,422);
        return $c;
    }

    public function create(Request $request)
    {
        $this->sync->origin($request);
        [$owner]=$this->sync->actor($request);
        $body=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($body['contract'])&&is_string($body['signature']),422);
        $grant=$this->contract($body['contract']);
        abort_unless($grant['ownerAccountId']===$owner->id,403);
        $domain=$grant['version']===2
            ?"pb3.media-grant.v2\n":"pb3.media-grant.v1\n";
        abort_unless(P::verify($owner->account_spki,
            $domain.$body['contract'],$body['signature']),401);
        $hash=hash('sha256',$body['contract']);
        return DB::transaction(function()use($grant,$hash,$owner,$body){
            DB::table('identity_accounts')->where('id',$owner->id)
                ->lockForUpdate()->first();
            $media=DB::table('media_files_v1')
                ->where('id',$grant['mediaId'])
                ->where('account_id',$owner->id)
                ->lockForUpdate()->first();
            abort_unless($media,404);
            abort_if($media->state!=='active'
                ||$media->expires_at<=PhotoSync::nowMs(),410);
            abort_if(DB::table('browser_archive_entries_v1')
                ->where('kind','media')->where('asset_id',$media->id)
                ->where('state','archived')->exists(),410);
            abort_unless($grant['expiresAt']<=(int)$media->expires_at,422);
            abort_unless(hash_equals($media->contract_hash,
                $grant['mediaContractHash']),409);

            $recipient=DB::table('identity_accounts')
                ->where('id',$grant['recipientAccountId'])
                ->where('status','ready')->first();
            abort_unless($recipient,404);
            $directory=DB::table('account_exchange_keys')
                ->where('account_id',$recipient->id)->first();
            abort_unless($directory,409);
            abort_unless(hash_equals($directory->descriptor_hash,
                $grant['recipientKeyDigest']),409);

            $existing=DB::table('media_recipient_grants_v1')
                ->where('id',$grant['grantId'])->first();
            if($existing){
                abort_unless($existing->owner_account_id===$owner->id
                    &&hash_equals($existing->contract_hash,$hash),409);
                abort_if($existing->state!=='active'
                    ||$existing->expires_at<=PhotoSync::nowMs(),410);
                return $this->sync->json([
                    'grantId'=>$existing->id,'state'=>'active','unchanged'=>true,
                ]);
            }
            if($grant['version']===2){
                AScope::creation($grant['assignmentId'],$owner->id,
                    $recipient->id,$grant['expiresAt']);
            }
            DB::table('media_recipient_grants_v1')->insert([
                'id'=>$grant['grantId'],'media_id'=>$media->id,
                'owner_account_id'=>$owner->id,
                'recipient_account_id'=>$recipient->id,
                'recipient_key_digest'=>$directory->descriptor_hash,
                'assignment_id'=>$grant['version']===2?$grant['assignmentId']:null,
                'media_contract_hash'=>$media->contract_hash,
                'expires_at'=>$grant['expiresAt'],
                'state'=>'active','contract_hash'=>$hash,
                'contract_json'=>$body['contract'],
                'account_signature'=>$body['signature'],
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'grantId'=>$grant['grantId'],'state'=>'active','unchanged'=>false,
            ],201);
        },3);
    }

    private function recipientGrant(Request $request,string $grantId):object
    {
        P::uuid($grantId);
        [$account]=$this->sync->actor($request);
        $grant=DB::table('media_recipient_grants_v1 as g')
            ->join('media_files_v1 as m','m.id','=','g.media_id')
            ->where('g.id',$grantId)
            ->where('g.recipient_account_id',$account->id)
            ->select('g.*','m.state as media_state',
                'm.expires_at as media_expires','m.contract_hash as actual_media_hash')
            ->first();
        abort_unless($grant,404);
        abort_if($grant->state!=='active'
            ||$grant->expires_at<=PhotoSync::nowMs()
            ||$grant->media_state!=='active'
            ||$grant->media_expires<=PhotoSync::nowMs()
            ||!hash_equals($grant->media_contract_hash,
                $grant->actual_media_hash),410);
        AScope::requireReadable($grant->assignment_id);
        return $grant;
    }

    public function received(Request $request)
    {
        [$account]=$this->sync->actor($request);
        $after=$request->query('after');
        if($after!==null){
            abort_unless(is_string($after),422);
            P::uuid($after);
        }
        $q=DB::table('media_recipient_grants_v1 as g')
            ->join('media_files_v1 as m','m.id','=','g.media_id')
            ->where('g.recipient_account_id',$account->id)
            ->where('g.state','active')
            ->where('g.expires_at','>',PhotoSync::nowMs())
            ->where('m.state','active')
            ->where('m.expires_at','>',PhotoSync::nowMs())
            ->whereColumn('m.contract_hash','g.media_contract_hash')
            ->leftJoin('assignment_records_v1 as a','a.id','=','g.assignment_id')
            ->where(function($q){
                $q->whereNull('g.assignment_id')
                    ->orWhere(function($scoped){
                        $now=PhotoSync::nowMs();
                        $scoped->whereNotNull('a.id')
                            ->where(function($cutoff)use($now){
                            $cutoff->whereNull('a.files_access_until')
                                ->orWhere('a.files_access_until','>',$now);
                        })->where(function($cutoff)use($now){
                            $cutoff->whereNull('a.assignment_access_until')
                                ->orWhere('a.assignment_access_until','>',$now);
                        });
                    });
            });
        if($after!==null)$q->where('g.id','>',$after);
        $rows=$q->orderBy('g.id')->limit(51)
            ->get(['g.id','g.media_id','g.owner_account_id',
                'g.expires_at','m.media_type']);
        $more=$rows->count()>50;
        $items=$rows->take(50)->map(static fn($g)=>[
            'grantId'=>$g->id,'mediaId'=>$g->media_id,
            'ownerAccountId'=>$g->owner_account_id,
            'mediaType'=>$g->media_type,'expiresAt'=>(int)$g->expires_at,
        ])->values()->all();
        return $this->sync->json([
            'items'=>$items,
            'nextCursor'=>$more&&$items!==[]
                ?end($items)['grantId']:null,
        ]);
    }

    public function show(Request $request,string $grantId)
    {
        $grant=$this->recipientGrant($request,$grantId);
        $m=DB::table('media_files_v1')->where('id',$grant->media_id)->first();
        $owner=DB::table('identity_accounts')
            ->where('id',$grant->owner_account_id)
            ->where('status','ready')->first();
        abort_unless($m&&$owner,410);
        return $this->sync->json([
            'grantId'=>$grant->id,'mediaId'=>$m->id,
            'ownerAccountId'=>$grant->owner_account_id,
            'ownerAccountSpki'=>$owner->account_spki,
            'expiresAt'=>(int)$grant->expires_at,
            'contract'=>$grant->contract_json,
            'signature'=>$grant->account_signature,
            'mediaContract'=>$m->contract_json,
            'receipt'=>json_decode($m->receipt,true),
        ]);
    }

    public function read(Request $request,string $grantId,string $chunkId)
    {
        P::uuid($chunkId);
        $grant=$this->recipientGrant($request,$grantId);
        $chunk=DB::table('media_chunks_v1')
            ->where('id',$chunkId)
            ->where('media_id',$grant->media_id)
            ->where('state','active')->first();
        abort_unless($chunk,404);
        try{$stream=$this->storage->readMediaChunk($chunkId);}
        catch(\Throwable){abort(503,'media.storage_unavailable');}
        abort_unless(is_resource($stream),503);
        return response()->stream(static function()use($stream){
            try{
                while(!feof($stream)){echo fread($stream,65536);flush();}
            }finally{fclose($stream);}
        },200,[
            'Content-Type'=>'application/octet-stream',
            'Cache-Control'=>'no-store, private',
            'X-Content-Type-Options'=>'nosniff',
            'X-Cipher-SHA256'=>$chunk->sha256,
        ]);
    }

    public function revoke(Request $request,string $grantId)
    {
        $this->sync->origin($request);
        P::uuid($grantId);
        [$owner]=$this->sync->actor($request);
        $body=P::exact($request->json()->all(),['command','signature']);
        abort_unless(is_string($body['command'])&&is_string($body['signature']),422);
        try{$c=json_decode($body['command'],true,8,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,['version','grantId','operationId']);
        abort_unless($c['version']===1&&$c['grantId']===$grantId,422);
        P::uuid($c['operationId']);
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)
            ===$body['command'],422);
        abort_unless(P::verify($owner->account_spki,
            "pb3.media-revoke.v1\n".$body['command'],$body['signature']),401);
        return DB::transaction(function()use($grantId,$owner){
            $g=DB::table('media_recipient_grants_v1')
                ->where('id',$grantId)->lockForUpdate()->first();
            abort_unless($g&&$g->owner_account_id===$owner->id,404);
            if($g->state!=='revoked'){
                DB::table('media_recipient_grants_v1')->where('id',$g->id)
                    ->update(['state'=>'revoked','revoked_at'=>now(),
                        'updated_at'=>now()]);
            }
            return $this->sync->json([
                'grantId'=>$grantId,'state'=>'revoked',
            ]);
        },3);
    }
}
