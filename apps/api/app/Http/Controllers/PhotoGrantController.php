<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use App\Storage\StorageManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Versioned recipient grants; server authorizes every request but cannot
 * decipher the asset's DEK or media. Never accept browser S3 object keys.
 */
final class PhotoGrantController extends Controller
{
    public function __construct(
        private readonly PhotoSync $sync,
        private readonly StorageManager $storage,
    ) {}

    private function contract(string $text): array
    {
        abort_unless(strlen($text)>=150&&strlen($text)<=30000,422);
        try{$c=json_decode($text,true,32,JSON_THROW_ON_ERROR);}catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,['version','grantId','photoId','ownerAccountId','recipientAccountId',
            'recipientKeyDigest','scope','expiresAt','assets']);
        abort_unless($c['version']===1 && $c['scope']==='read'
            && is_int($c['expiresAt']) && $c['expiresAt']>PhotoSync::nowMs()
            && is_string($c['recipientKeyDigest'])
            && preg_match('/^[a-f0-9]{64}$/D',$c['recipientKeyDigest']),422);
        foreach(['grantId','photoId','ownerAccountId','recipientAccountId'] as $field){
            abort_unless(is_string($c[$field]),422);
            P::uuid($c[$field]);
        }
        abort_unless($c['ownerAccountId']!==$c['recipientAccountId'],422);
        abort_unless(is_array($c['assets'])&&array_is_list($c['assets'])
            &&count($c['assets'])>=2&&count($c['assets'])<=3,422);
        $seen=[];
        foreach($c['assets'] as $asset){
            abort_unless(is_array($asset),422);
            P::exact($asset,['assetId','ephemeralSpki','salt','iv','ciphertext']);
            P::uuid($asset['assetId']);
            P::spki($asset['ephemeralSpki']);
            P::b64($asset['salt'],16);
            P::b64($asset['iv'],12);
            P::b64($asset['ciphertext'],48); // 32-byte DEK + 16-byte GCM tag.
            abort_unless(!isset($seen[$asset['assetId']]),422);
            $seen[$asset['assetId']]=true;
        }
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$text,422);
        return $c;
    }

    public function create(Request $request) {
        $this->sync->origin($request);
        [$owner]=$this->sync->actor($request);
        $body=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($body['contract'])&&is_string($body['signature']),422);
        $grant=$this->contract($body['contract']);
        abort_unless($grant['ownerAccountId']===$owner->id,403);
        abort_unless(P::verify($owner->account_spki,
            "pb3.photo-grant.v1\n".$body['contract'],$body['signature']),401);
        $hash=hash('sha256',$body['contract']);
        return DB::transaction(function()use($grant,$hash,$owner,$body){
            // Lock owner and photo. Grants cannot be created during TTL deletion.
            DB::table('identity_accounts')->where('id',$owner->id)->lockForUpdate()->first();
            $photo=DB::table('photo_records')->where('id',$grant['photoId'])
                ->where('account_id',$owner->id)->lockForUpdate()->first();
            abort_unless($photo,404);
            abort_if($photo->state!=='active'
                ||(int)$photo->expires_at<=PhotoSync::nowMs(),410);
            abort_unless($grant['expiresAt']<=(int)$photo->expires_at,422);
            $recipient=DB::table('identity_accounts')
                ->where('id',$grant['recipientAccountId'])->where('status','ready')->first();
            abort_unless($recipient,404);
            $directory=DB::table('account_exchange_keys')
                ->where('account_id',$recipient->id)->first();
            abort_unless($directory,409);
            abort_unless(hash_equals($directory->descriptor_hash,$grant['recipientKeyDigest']),409);
            $objectIds=DB::table('photo_objects')->where('photo_id',$photo->id)
                ->where('state','active')->orderBy('id')->pluck('id')->all();
            $submitted=array_column($grant['assets'],'assetId');
            sort($submitted,SORT_STRING);
            abort_unless(count($objectIds)===count($submitted)
                &&$objectIds===$submitted,422);

            $previous=DB::table('photo_access_grants')->where('id',$grant['grantId'])->first();
            if($previous){
                abort_unless($previous->owner_account_id===$owner->id
                    &&hash_equals($previous->contract_hash,$hash),409);
                abort_if($previous->state!=='active'||$previous->expires_at<=PhotoSync::nowMs(),410);
                return $this->sync->json(['grantId'=>$previous->id,'state'=>'active','unchanged'=>true]);
            }
            DB::table('photo_access_grants')->insert([
                'id'=>$grant['grantId'],'photo_id'=>$photo->id,'owner_account_id'=>$owner->id,
                'recipient_account_id'=>$recipient->id,'recipient_key_digest'=>$directory->descriptor_hash,
                'expires_at'=>$grant['expiresAt'],'state'=>'active','contract_hash'=>$hash,
                'contract_json'=>$body['contract'],'account_signature'=>$body['signature'],
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json(['grantId'=>$grant['grantId'],'state'=>'active','unchanged'=>false],201);
        },3);
    }

    /** Recipient data is always confined to active grants and underlying TTL. */
    private function recipientGrant(Request $request,string $grantId): object
    {
        P::uuid($grantId);
        [$account]=$this->sync->actor($request);
        $g=DB::table('photo_access_grants as g')
            ->join('photo_records as p','p.id','=','g.photo_id')
            ->where('g.id',$grantId)->where('g.recipient_account_id',$account->id)
            ->select('g.*','p.state as photo_state','p.expires_at as photo_expires')
            ->first();
        abort_unless($g,404);
        abort_if($g->state!=='active' || $g->expires_at<=PhotoSync::nowMs()
            || $g->photo_state!=='active'||$g->photo_expires<=PhotoSync::nowMs(),410);
        return $g;
    }

    public function received(Request $request) {
        [$account]=$this->sync->actor($request);
        $after=$request->query('after');
        if($after!==null){abort_unless(is_string($after),422);P::uuid($after);}
        $q=DB::table('photo_access_grants as g')
          ->join('photo_records as p','p.id','=','g.photo_id')
          ->where('g.recipient_account_id',$account->id)
          ->where('g.state','active')->where('g.expires_at','>',PhotoSync::nowMs())
          ->where('p.state','active')->where('p.expires_at','>',PhotoSync::nowMs());
        if($after!==null)$q->where('g.id','>',$after);
        $rows=$q->orderBy('g.id')->limit(51)
          ->get(['g.id','g.photo_id','g.owner_account_id','g.expires_at']);
        $hasMore=$rows->count()>50;
        $items=$rows->take(50)->map(fn($r)=>[
          'grantId'=>$r->id,'photoId'=>$r->photo_id,'ownerAccountId'=>$r->owner_account_id,
          'expiresAt'=>(int)$r->expires_at,
        ])->values()->all();
        return $this->sync->json(['items'=>$items,
          'nextCursor'=>$hasMore&&$items?end($items)['grantId']:null]);
    }

    public function show(Request $request,string $grantId) {
        $g=$this->recipientGrant($request,$grantId);
        $objects=DB::table('photo_objects')->where('photo_id',$g->photo_id)
            ->where('state','active')->orderBy('id')->get();
        $assets=$objects->map(fn($o)=>[
            'assetId'=>$o->id,'kind'=>$o->kind,'revision'=>(int)$o->revision,
            'bytes'=>(int)$o->bytes,'sha256'=>$o->sha256,
            'manifest'=>json_decode($o->manifest_json,true,32,JSON_THROW_ON_ERROR),
        ])->all();
        $owner=DB::table('identity_accounts')->where('id',$g->owner_account_id)->first();
        abort_unless($owner && $owner->status==='ready',410);
        return $this->sync->json([
            'grantId'=>$g->id,'photoId'=>$g->photo_id,
            'ownerAccountId'=>$g->owner_account_id,
            'ownerAccountSpki'=>$owner->account_spki,
            'expiresAt'=>(int)$g->expires_at,
            'contract'=>$g->contract_json,'signature'=>$g->account_signature,
            'assets'=>$assets,
        ]);
    }

    public function read(Request $request,string $grantId,string $assetId) {
        P::uuid($assetId);
        $grant=$this->recipientGrant($request,$grantId);
        $contract=json_decode($grant->contract_json,true,32,JSON_THROW_ON_ERROR);
        $allowed=in_array($assetId,array_column($contract['assets'],'assetId'),true);
        abort_unless($allowed,404);
        $obj=DB::table('photo_objects')->where('id',$assetId)
            ->where('photo_id',$grant->photo_id)->where('state','active')->first();
        abort_unless($obj,404);
        $stream=$this->storage->readAsset($assetId);
        abort_unless(is_resource($stream),503);
        return response()->stream(function()use($stream) {
            try {
                while(!feof($stream)){echo fread($stream,65536);flush();}
            } finally {fclose($stream);}
        },200,[
            'Content-Type'=>'application/octet-stream',
            'Cache-Control'=>'no-store, private','X-Content-Type-Options'=>'nosniff',
            'X-Cipher-SHA256'=>$obj->sha256,
        ]);
    }

    public function revoke(Request $request,string $grantId) {
        $this->sync->origin($request);
        P::uuid($grantId);
        [$account]=$this->sync->actor($request);
        $d=P::exact($request->json()->all(),['command','signature']);
        abort_unless(is_string($d['command'])&&is_string($d['signature']),422);
        try{$v=json_decode($d['command'],true,8,JSON_THROW_ON_ERROR);}catch(\Throwable){abort(422);}
        abort_unless(is_array($v),422);
        P::exact($v,['version','grantId','operationId']);
        abort_unless($v['version']===1&&$v['grantId']===$grantId,422);
        P::uuid($v['operationId']);
        abort_unless(json_encode($v,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$d['command'],422);
        abort_unless(P::verify($account->account_spki,
            "pb3.photo-revoke.v1\n".$d['command'],$d['signature']),401);

        return DB::transaction(function()use($account,$grantId){
            $g=DB::table('photo_access_grants')->where('id',$grantId)->lockForUpdate()->first();
            abort_unless($g && $g->owner_account_id===$account->id,404);
            if($g->state!=='revoked'){
                DB::table('photo_access_grants')->where('id',$g->id)->update([
                    'state'=>'revoked','revoked_at'=>now(),'updated_at'=>now(),
                ]);
            }
            return $this->sync->json(['grantId'=>$grantId,'state'=>'revoked']);
        },3);
    }
}
