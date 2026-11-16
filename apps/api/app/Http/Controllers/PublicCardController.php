<?php
declare(strict_types=1);
namespace App\Http\Controllers;

use App\Billing\QuotaAdmission;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use App\Storage\StorageManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Anonymous access is ONLY to a separately encrypted, explicitly reviewed JPEG.
 * No original object, account key, decrypted image/metadata or fragment key enters
 * this protocol. Every response rechecks the live source and revocation state.
 */
final class PublicCardController extends Controller
{
    public const DOMAIN="pb3.public-card.v1\n";
    public const MAX_BYTES=24000000;
    public function __construct(private readonly PhotoSync $sync,
        private readonly StorageManager $storage,private readonly QuotaAdmission $quota){}

    private function source(string $kind,string $id,string $account,bool $lock=false):object
    {
        abort_unless(in_array($kind,['photo','media'],true),422);P::uuid($id);
        $query=DB::table($kind==='photo'?'photo_records':'media_files_v1')
            ->where('id',$id)->where('account_id',$account);
        if($lock)$query->lockForUpdate();
        $row=$query->first();abort_unless($row,404);
        abort_unless($row->state==='active'&&(int)$row->expires_at>PhotoSync::nowMs(),404);
        abort_if(DB::table('browser_archive_entries_v1')->where('kind',$kind)
            ->where('asset_id',$id)->whereIn('state',['archived','deleting'])->exists(),404);
        if($kind==='photo'){
            // Assignment capture is not an owner's unrestricted personal photo.
            abort_unless((json_decode($row->contract_json,true)['version']??null)===1,403);
        }else{
            abort_unless($row->media_type==='photo',422);
            abort_if(DB::table('assignment_media_submissions_v1')->where('media_id',$id)->exists(),403);
            // Existing preview-policy v1 records explicitly say publication
            // disabled. The new personal-photo grant must not bypass them.
            abort_if(DB::table('media_file_preview_policies_v1')
                ->where(fn($q)=>$q->where('source_media_id',$id)->orWhere('safe_media_id',$id))->exists(),403);
            abort_if(DB::table('safe_assignment_editorial_links_v1')
                ->where(fn($q)=>$q->where('source_media_id',$id)->orWhere('safe_media_id',$id))
                ->where('state','active')->exists(),403);
        }
        return $row;
    }

    private function contract(string $json,string $signature,object $owner):array
    {
        abort_unless(strlen($json)<4096,422);
        try{$c=json_decode($json,true,16,JSON_THROW_ON_ERROR);}catch(\Throwable){abort(422);}
        abort_unless(is_array($c),422);
        P::exact($c,['version','cardId','accountId','sourceKind','sourceId',
            'sourceContractHash','tokenHash','expiresAt','bytes','sha256','iv',
            'width','height','allowDownload','ownerEnvelope']);
        abort_unless(is_string($c['cardId'])&&is_string($c['sourceId']),422);
        P::uuid($c['cardId']);P::uuid($c['sourceId']);
        abort_unless($c['version']===1&&$c['accountId']===$owner->id,403);
        foreach(['sourceContractHash','tokenHash','sha256'] as $key)
            abort_unless(is_string($c[$key])&&preg_match('/^[a-f0-9]{64}$/D',$c[$key]),422);
        abort_unless(is_string($c['sourceKind'])&&is_string($c['iv']),422);P::b64($c['iv'],12);
        abort_unless(is_array($c['ownerEnvelope']),422);
        P::exact($c['ownerEnvelope'],['iv','ciphertext']);
        abort_unless(is_string($c['ownerEnvelope']['iv'])&&is_string($c['ownerEnvelope']['ciphertext']),422);
        P::b64($c['ownerEnvelope']['iv'],12);
        $wrapped=P::b64($c['ownerEnvelope']['ciphertext']);
        abort_unless(strlen($wrapped)>=64&&strlen($wrapped)<=512,422);
        abort_unless(is_int($c['expiresAt'])&&$c['expiresAt']>PhotoSync::nowMs()
            &&$c['expiresAt']<=PhotoSync::nowMs()+86400000
            &&is_int($c['bytes'])&&$c['bytes']>=32&&$c['bytes']<=self::MAX_BYTES
            &&is_int($c['width'])&&$c['width']>0&&$c['width']<=4096
            &&is_int($c['height'])&&$c['height']>0&&$c['height']<=4096
            &&$c['width']*$c['height']<=12000000&&is_bool($c['allowDownload']),422);
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$json,422);
        abort_unless(P::verify($owner->account_spki,self::DOMAIN.$json,$signature),403);
        return $c;
    }

    public function reserve(Request $r)
    {
        $this->sync->origin($r);[$owner]=$this->sync->actor($r);
        $body=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($body['contract'])&&is_string($body['signature']),422);
        $c=$this->contract($body['contract'],$body['signature'],$owner);
        return DB::transaction(function()use($body,$c,$owner){
            DB::table('identity_accounts')->where('id',$owner->id)->lockForUpdate()->first();
            $source=$this->source($c['sourceKind'],$c['sourceId'],$owner->id,true);
            abort_unless(hash_equals($source->contract_hash,$c['sourceContractHash'])
                &&$c['expiresAt']<=(int)$source->expires_at,403);
            $old=DB::table('public_cards_v1')->where('id',$c['cardId'])->lockForUpdate()->first();
            if($old){
                abort_unless($old->account_id===$owner->id
                    &&hash_equals($old->contract_hash,hash('sha256',$body['contract'])),409);
                abort_unless(in_array($old->state,['pending','active'],true),410);
                return $this->sync->json(['cardId'=>$old->id,'state'=>$old->state]);
            }
            abort_if(DB::table('public_cards_v1')->where('token_hash',$c['tokenHash'])->exists(),409);
            $this->quota->admit($owner->id,$c['bytes']);
            DB::table('public_cards_v1')->insert([
                'id'=>$c['cardId'],'account_id'=>$owner->id,'source_id'=>$c['sourceId'],
                'source_kind'=>$c['sourceKind'],'source_contract_hash'=>$c['sourceContractHash'],
                'token_hash'=>$c['tokenHash'],'contract_json'=>$body['contract'],
                'signature'=>$body['signature'],'contract_hash'=>hash('sha256',$body['contract']),
                'expires_at'=>$c['expiresAt'],'bytes'=>$c['bytes'],'sha256'=>$c['sha256'],
                'object_key'=>'cipher/public/v1/'.$owner->id.'/'.$c['cardId'],
                'state'=>'pending','created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json(['cardId'=>$c['cardId'],'state'=>'pending'],201);
        },3);
    }

    public function sourceInfo(Request $r,string $kind,string $id)
    {
        [$owner]=$this->sync->actor($r);$source=$this->source($kind,$id,$owner->id);
        return $this->sync->json(['sourceContractHash'=>$source->contract_hash,
            'expiresAt'=>(int)$source->expires_at]);
    }

    private function owned(Request $r,string $id):object
    {
        P::uuid($id);[$owner]=$this->sync->actor($r);
        $card=DB::table('public_cards_v1')->where('id',$id)->where('account_id',$owner->id)->first();
        abort_unless($card,404);return $card;
    }

    public function upload(Request $r,string $id)
    {
        $this->sync->origin($r);$card=$this->owned($r,$id);
        abort_unless(in_array($card->state,['pending','active'],true),410);
        $this->source($card->source_kind,$card->source_id,$card->account_id);
        abort_unless((int)$card->expires_at>PhotoSync::nowMs(),410);
        abort_unless($r->header('Content-Type')==='application/octet-stream'
            &&(string)$r->header('Content-Length')===(string)$card->bytes,422);
        $stream=$r->getContent(true);
        abort_unless(is_resource($stream),422);
        $bytes=stream_get_contents($stream,self::MAX_BYTES+1);fclose($stream);
        abort_unless(strlen($bytes)===(int)$card->bytes&&hash_equals($card->sha256,hash('sha256',$bytes)),422);
        $this->storage->writePublicCard($card->id,$bytes);
        DB::transaction(function()use($card){
            $row=DB::table('public_cards_v1')->where('id',$card->id)->lockForUpdate()->first();
            abort_unless($row&&in_array($row->state,['pending','active'],true)
                &&(int)$row->expires_at>PhotoSync::nowMs(),410);
            $this->source($row->source_kind,$row->source_id,$row->account_id,true);
            DB::table('public_cards_v1')->where('id',$row->id)->update(['state'=>'active','updated_at'=>now()]);
        },3);
        return $this->sync->json(['cardId'=>$card->id,'state'=>'active']);
    }

    public function revoke(Request $r,string $id)
    {
        $this->sync->origin($r);$card=$this->owned($r,$id);
        $body=P::exact($r->json()->all(),['signature']);[$owner]=$this->sync->actor($r);
        abort_unless(is_string($body['signature'])&&P::verify($owner->account_spki,
            "pb3.public-card-revoke.v1\n".$id,$body['signature']),403);
        DB::table('public_cards_v1')->where('id',$id)->update(['state'=>'revoked','updated_at'=>now()]);
        return $this->sync->json(['cardId'=>$id,'state'=>'revoked']);
    }

    public function index(Request $r,string $kind,string $id)
    {
        [$owner]=$this->sync->actor($r);P::uuid($id);
        abort_unless(in_array($kind,['photo','media'],true),422);
        return $this->sync->json(['items'=>DB::table('public_cards_v1')
            ->where('account_id',$owner->id)->where('source_kind',$kind)->where('source_id',$id)
            ->orderByDesc('created_at')->limit(50)->get(['id','state','expires_at'])->map(fn($row)=>[
                'id'=>$row->id,'state'=>$row->state,'expiresAt'=>(int)$row->expires_at,
            ])->all()]);
    }

    public function showOwned(Request $r,string $id)
    {
        $row=$this->owned($r,$id);
        abort_unless($row->state==='active'&&(int)$row->expires_at>PhotoSync::nowMs(),404);
        $this->source($row->source_kind,$row->source_id,$row->account_id);
        return $this->sync->json(['contract'=>$row->contract_json,'signature'=>$row->signature]);
    }

    public function read(Request $r,string $token)
    {
        // Unknown/revoked/expired sources all have the same non-disclosing denial.
        abort_unless(preg_match('/^[A-Za-z0-9_-]{43}$/D',$token),404);
        $card=DB::table('public_cards_v1')->where('token_hash',hash('sha256',$token))
            ->where('state','active')->where('expires_at','>',PhotoSync::nowMs())->first();
        abort_unless($card,404);
        $owner=DB::table('identity_accounts')->where('id',$card->account_id)->where('status','ready')->first();
        abort_unless($owner&&P::verify($owner->account_spki,self::DOMAIN.$card->contract_json,$card->signature),404);
        $source=$this->publicSource($card);
        abort_unless(hash_equals($source->contract_hash,$card->source_contract_hash),404);
        // Read only this separately registered opaque object through StorageManager.
        $bytes=$this->storage->readPublicCard($card->id);
        $latest=DB::table('public_cards_v1')->where('id',$card->id)->where('state','active')
            ->where('expires_at','>',PhotoSync::nowMs())->first();
        abort_unless($latest,404);
        $this->publicSource($card);
        return $this->sync->json(['contract'=>$card->contract_json,'signature'=>$card->signature,
            'accountSpki'=>$owner->account_spki,'ciphertext'=>P::encode($bytes)]);
    }

    private function publicSource(object $card):object
    {
        try{return $this->source($card->source_kind,$card->source_id,$card->account_id);}
        catch(\Symfony\Component\HttpKernel\Exception\HttpException){abort(404);}
    }
}
