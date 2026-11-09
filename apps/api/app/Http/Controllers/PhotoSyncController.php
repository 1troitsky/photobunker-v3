<?php
declare(strict_types=1);
namespace App\Http\Controllers;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use App\Photo\Reservation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Storage\StorageManager;

final class PhotoSyncController extends Controller
{
    public function __construct(private readonly PhotoSync $sync,private readonly Reservation $reservation, private readonly StorageManager $storage){}
    public function reserve(Request $r){
        return $this->sync->json($this->reservation->reserve($r));
    }
    public function upload(Request $r,string $photoId,string $assetId){
        $this->sync->origin($r);[$a]=$this->sync->actor($r);
        P::uuid($assetId);
        $photo=$this->sync->requirePhoto($photoId,$a->id);
        abort_unless($photo->state==='pending',409);
        $object=DB::table('photo_objects')->where('id',$assetId)->where('photo_id',$photoId)->first();
        abort_unless($object,404);
        $length=$r->header('Content-Length');
        abort_unless(is_string($length)&&ctype_digit($length)&&(int)$length===(int)$object->bytes,422);
        $write=DB::transaction(function()use($photoId,$assetId,$a){
            $p=DB::table('photo_records')->where('id',$photoId)->lockForUpdate()->first();
            abort_unless($p&&$p->account_id===$a->id,404);
            abort_if($p->state==='deleting'||$p->expires_at<=PhotoSync::nowMs(),410);
            $o=DB::table('photo_objects')->where('id',$assetId)->lockForUpdate()->first();
            abort_unless($o && $o->photo_id===$photoId,404);
            if(in_array($o->state,['verified','active'],true))return false;
            if($o->state==='uploading'&&\Carbon\Carbon::parse($o->updated_at)->gt(now()->subMinutes(2)))abort(409);
            DB::table('photo_objects')->where('id',$assetId)->update(['state'=>'uploading','updated_at'=>now()]);
            return true;
        },3);
        if(!$write){
            abort_unless($this->sync->verify($object->id,(int)$object->bytes,$object->sha256),503);
            return $this->sync->json(['verified'=>true,'assetId'=>$assetId]);
        }
        try{
            $stream=$r->getContent(true);abort_unless(is_resource($stream),422);
            try{$ok=$this->storage->writeAsset($assetId,$stream);}
            finally{fclose($stream);}
            abort_unless($ok && $this->sync->verify($object->id,(int)$object->bytes,$object->sha256),503);
            DB::transaction(function()use($a,$photoId,$assetId){
                $p=DB::table('photo_records')->where('id',$photoId)->lockForUpdate()->first();
                abort_unless($p&&$p->account_id===$a->id,410);
                abort_if($p->state==='deleting'||$p->expires_at<=PhotoSync::nowMs(),410);
                DB::table('photo_objects')->where('id',$assetId)->update(['state'=>'verified','updated_at'=>now()]);
                DB::table('storage_locations')->where('asset_id',$assetId)->update(['state'=>'verified','updated_at'=>now()]);
            },3);
            return $this->sync->json(['verified'=>true,'assetId'=>$assetId]);
        }catch(\Throwable $e){
            DB::table('photo_objects')->where('id',$assetId)->where('state','uploading')
                ->update(['state'=>'pending','updated_at'=>now()]);
            if($e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface)throw $e;
            abort(503,'photo.storage_unavailable');
        }
    }
    public function receipt(Request $r,string $photoId){
        [$a]=$this->sync->actor($r);
        $photo=$this->sync->requirePhoto($photoId,$a->id);
        return $this->sync->json($photo->state==='active'
          ?['state'=>'active','receipt'=>json_decode($photo->receipt,true)]
          :['state'=>'pending','photoId'=>$photo->id,'expiresAt'=>(int)$photo->expires_at]);
    }
    public function manifests(Request $r,string $photoId){
        [$account]=$this->sync->actor($r);
        $photo=$this->sync->requirePhoto($photoId,$account->id,true);
        $assets=DB::table('photo_objects')->where('photo_id',$photoId)->where('state','active')
          ->orderBy('id')->get()->map(fn($o)=>[
            'assetId'=>$o->id,'kind'=>$o->kind,'revision'=>(int)$o->revision,
            'bytes'=>(int)$o->bytes,'sha256'=>$o->sha256,
            'manifest'=>json_decode($o->manifest_json,true),
          ])->all();
        return $this->sync->json(['photoId'=>$photo->id,'expiresAt'=>(int)$photo->expires_at,
          'metadataAssetId'=>$photo->metadata_asset_id,'metadataRevision'=>(int)$photo->metadata_revision,
          'originDeviceId'=>$photo->device_id,
          'assets'=>$assets]);
    }
    public function read(Request $r,string $photoId,string $assetId){
        [$a]=$this->sync->actor($r);
        $photo=$this->sync->requirePhoto($photoId,$a->id,true);
        P::uuid($assetId);
        $o=DB::table('photo_objects')->where('id',$assetId)->where('photo_id',$photo->id)
            ->where('state','active')->first();
        abort_unless($o,404);
        $stream=$this->storage->readAsset($assetId);
        abort_unless(is_resource($stream),503);
        return response()->stream(function()use($stream){
            try{while(!feof($stream)){echo fread($stream,65536);flush();}}
            finally{fclose($stream);}
        },200,['Content-Type'=>'application/octet-stream','Cache-Control'=>'no-store, private',
            'X-Content-Type-Options'=>'nosniff','X-Cipher-SHA256'=>$o->sha256]);
    }
}
