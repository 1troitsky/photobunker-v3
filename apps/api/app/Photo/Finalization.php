<?php
declare(strict_types=1);
namespace App\Photo;
use App\Identity\Protocol as P;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class Finalization
{
    public function __construct(private readonly PhotoSync $sync){}
    public function finalize(Request $r,string $photoId):array {
        $this->sync->origin($r);[$account]=$this->sync->actor($r);
        $d=P::exact($r->json()->all(),['operationId']);P::uuid($d['operationId']);
        $p=$this->sync->requirePhoto($photoId,$account->id);
        abort_unless($p->operation_id===$d['operationId'],409);
        if($p->state==='active')return ['receipt'=>json_decode($p->receipt,true)];
        $objects=DB::table('photo_objects')->where('photo_id',$photoId)->get();
        abort_unless(count($objects)>=2 && count($objects)<=3 && $objects->every(fn($o)=>$o->state==='verified'),409);
        // S3 independent readback is mandatory; HEAD/size alone is insufficient.
        foreach($objects as $o)
            abort_unless($this->sync->verify($o->id,(int)$o->bytes,$o->sha256),503);
        return DB::transaction(function()use($account,$photoId,$objects){
            $p=DB::table('photo_records')->where('id',$photoId)->lockForUpdate()->first();
            abort_unless($p&&$p->account_id===$account->id,404);
            abort_if($p->state==='deleting'||$p->expires_at<=PhotoSync::nowMs(),410);
            if($p->state==='active')return ['receipt'=>json_decode($p->receipt,true)];
            $current=DB::table('photo_objects')->where('photo_id',$photoId)->lockForUpdate()->get();
            abort_unless(count($current)===count($objects)&&$current->every(fn($o)=>$o->state==='verified'),409);
            $receipt=$this->sync->receipt($p,$current);
            DB::table('photo_records')->where('id',$photoId)->update([
                'state'=>'active','receipt'=>json_encode($receipt,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                'updated_at'=>now(),
            ]);
            DB::table('photo_objects')->where('photo_id',$photoId)->update(['state'=>'active','updated_at'=>now()]);
            DB::table('storage_locations')->whereIn('asset_id',$current->pluck('id')->all())->update(['state'=>'active','updated_at'=>now()]);
            return ['receipt'=>$receipt];
        },3);
    }
}
