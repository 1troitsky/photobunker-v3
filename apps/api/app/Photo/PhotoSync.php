<?php
declare(strict_types=1);
namespace App\Photo;

use App\Identity\Protocol as P;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Storage\StorageManager;

final class PhotoSync
{
    public function __construct(private readonly StorageManager $storage) {}

    public static function nowMs():int { return now()->getTimestampMs(); }
    public static function exact(array $a,array $keys):void { P::exact($a,$keys); }
    public function actor(Request $r):array {
        $account=$r->session()->get('identity_account');
        $device=$r->session()->get('identity_device');
        $issued=$r->session()->get('identity_issued',0);
        abort_unless(is_string($account)&&is_string($device)&&is_int($issued)&&$issued+86400>time(),401);
        $a=DB::table('identity_accounts')->where('id',$account)->where('status','ready')->first();
        $d=DB::table('identity_devices')->where('id',$device)->where('account_id',$account)->whereNull('revoked_at')->first();
        abort_unless($a&&$d,401);
        return [$a,$d];
    }
    public function origin(Request $r):void {
        if(in_array($r->method(),['GET','HEAD'],true))return;
        abort_unless(is_string($r->header('Origin'))&&hash_equals(rtrim(config('app.url'),'/'),$r->header('Origin')),403);
    }
    public function json(array $data,int $code=200):\Illuminate\Http\JsonResponse {
        return response()->json($data,$code)->header('Cache-Control','no-store')
            ->header('X-Content-Type-Options','nosniff');
    }
    /** Enforce exact signed protocol and bounded manifests; server cannot decrypt JPEG/metadata. */
    public function validate(string $json,string $signature,string $deviceSpki):array {
        abort_unless(strlen($json)>40&&strlen($json)<=200000,422);
        try{$c=json_decode($json,true,64,JSON_THROW_ON_ERROR);}catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        $version=$c['version']??null;
        abort_unless($version===1||$version===2,422);
        self::exact($c,$version===2
            ?['version','photoId','operationId','expiresAt','assets','capture']
            :['version','photoId','operationId','expiresAt','assets']);
        if($version===2)abort_unless(is_array($c['capture'])&&!array_is_list($c['capture']),422);
        abort_unless(is_int($c['expiresAt'])&&
            $c['expiresAt']>self::nowMs()&&$c['expiresAt']<=self::nowMs()+(int)config('photo_sync.bootstrap_free_retention_days',14)*86400000,422);
        P::uuid($c['photoId']);P::uuid($c['operationId']);
        abort_unless(is_array($c['assets'])&&count($c['assets'])>=2&&count($c['assets'])<=3,422);
        $ids=[];$kinds=[];$total=0;
        foreach($c['assets'] as $asset){
            abort_unless(is_array($asset),422);
            self::exact($asset,['assetId','kind','revision','bytes','sha256','manifest']);
            P::uuid($asset['assetId']);
            abort_unless(is_string($asset['kind'])&&in_array($asset['kind'],['master','original','metadata','thumbnail'],true),422);
            abort_unless($asset['revision']===1&&is_int($asset['bytes'])&&
                $asset['bytes']>=16&&$asset['bytes']<=(in_array($asset['kind'],['metadata','thumbnail'],true)
                  ?config('photo_sync.max_metadata_bytes'):config('photo_sync.max_asset_bytes')),422);
            abort_unless(is_string($asset['sha256'])&&preg_match('/^[a-f0-9]{64}$/D',$asset['sha256'])===1,422);
            $m=$asset['manifest'];abort_unless(is_array($m),422);
            self::exact($m,['version','algorithm','chunkBytes','accountId','photoId','assetId','kind',
                'revision','expiresAt','plainBytes','cipherBytes','frames','cipherDigest','wrappedDEK']);
            abort_unless($m['version']===1&&$m['algorithm']==='AES-256-GCM'&&$m['chunkBytes']===262144
              &&$m['photoId']===$c['photoId']&&$m['assetId']===$asset['assetId']
              &&$m['kind']===$asset['kind']&&$m['revision']===1
              &&$m['expiresAt']===$c['expiresAt']&&$m['cipherBytes']===$asset['bytes']
              &&is_int($m['plainBytes'])&&$m['plainBytes']>=0&&$m['plainBytes']<=134217728,422);
            P::uuid($m['accountId']);
            abort_unless(is_array($m['wrappedDEK']),422);
            self::exact($m['wrappedDEK'],['iv','ciphertext']);
            abort_unless(is_string($m['wrappedDEK']['iv'])&&is_string($m['wrappedDEK']['ciphertext']),422);
            P::b64($m['wrappedDEK']['iv'],12);P::b64($m['wrappedDEK']['ciphertext']);
            abort_unless(is_array($m['frames']) && count($m['frames'])===max(1,(int)ceil($m['plainBytes']/262144)),422);
            $plain=0;$cipher=0;
            foreach($m['frames'] as $index=>$frame){
                abort_unless(is_array($frame),422);
                self::exact($frame,['index','offset','bytes','plainBytes','iv','digest']);
                $expected=min(262144,$m['plainBytes']-$plain);
                abort_unless($frame['index']===$index&&$frame['offset']===$cipher
                  &&$frame['plainBytes']===$expected&&$frame['bytes']===$expected+16,422);
                abort_unless(is_string($frame['iv']),422);
                P::b64($frame['iv'],12);
                abort_unless(is_string($frame['digest'])&&preg_match('/^[a-f0-9]{64}$/D',$frame['digest']),422);
                $plain+=$expected;$cipher+=$frame['bytes'];
            }
            abort_unless($plain===$m['plainBytes']&&$cipher===$m['cipherBytes']&&
              is_string($m['cipherDigest'])&&preg_match('/^[a-f0-9]{64}$/D',$m['cipherDigest']),422);
            $ids[]=$asset['assetId'];$kinds[]=$asset['kind'];$total+=$asset['bytes'];
        }
        abort_unless(count(array_unique($ids))===count($ids)&&
          count(array_filter($kinds,fn($k)=>$k==='metadata'))===1&&
          count(array_filter($kinds,fn($k)=>$k==='thumbnail'))<=1&&
          count(array_filter($kinds,fn($k)=>in_array($k,['master','original'],true)))===1,422);
        // Canonical re-encoding disallows JSON whitespace/duplicate fields and signature aliases.
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$json,422);
        abort_unless(P::verify($deviceSpki,"photobunker.photo-sync.v1\n".$json,$signature),401);
        return $c;
    }
    /** Private deterministic keys, not client paths or signed browser URLs. */
    public function objectKey(string $account,string $photo,string $asset):string {
        P::uuid($account);P::uuid($photo);P::uuid($asset);
        return 'cipher/v1/'.$account.'/'.$photo.'/'.$asset;
    }
    public function verify(string $key,int $bytes,string $digest):bool {
        return $this->storage->verifyAsset($key,$bytes,$digest);
    }
    public function receipt(object $row, iterable $objects):array {
        $assets=[];
        foreach($objects as $o)$assets[]=['assetId'=>$o->id,'kind'=>$o->kind,'bytes'=>(int)$o->bytes,'sha256'=>$o->sha256];
        usort($assets,fn($a,$b)=>strcmp($a['assetId'],$b['assetId']));
        $payload=['photoId'=>$row->id,'operationId'=>$row->operation_id,'expiresAt'=>(int)$row->expires_at,
            'assets'=>$assets];
        return [...$payload,'receiptHash'=>hash('sha256',json_encode($payload,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR))];
    }
    public function requirePhoto(string $id,string $actor,bool $activeOnly=false,bool $requireAssignmentAccess=true):object {
        P::uuid($id);
        $row=DB::table('photo_records')->where('id',$id)->where('account_id',$actor)->first();
        if(!$row){abort_if(DB::table('photo_tombstones')->where('photo_id',$id)->where('account_id',$actor)->exists(),410);abort(404);}
        abort_if($row->state==='deleting'||$row->expires_at<=self::nowMs(),410);
        // P1 personal capture only; assignment access binding is a separate contract.
        if($activeOnly)abort_unless($row->state==='active',409);
        return $row;
    }
}
