<?php
declare(strict_types=1);

namespace App\Media;

use App\Photo\PhotoSync;
use App\Storage\StorageManager;
use App\Storage\TombstoneKeyScope;
use Illuminate\Support\Facades\DB;

/**
 * Feature-gated durable ciphertext TTL. The database tombstone lives
 * permanently, including all opaque keys, so an in-flight stale S3 PUT can
 * never silently resurrect a deleted media file.
 *
 * Never enable on a real deployment without independent operator acceptance.
 */
final class MediaLifecycle
{
    public function __construct(private readonly StorageManager $storage){}

    public function mark(string $mediaId):void
    {
        DB::transaction(function()use($mediaId){
            $m=DB::table('media_files_v1')
                ->where('id',$mediaId)->lockForUpdate()->first();
            if(!$m)return;
            $keys=DB::table('media_chunk_locations_v1 as l')
                ->join('media_chunks_v1 as c','c.id','=','l.chunk_id')
                ->where('c.media_id',$mediaId)
                ->orderBy('l.object_key')->pluck('l.object_key')->all();
            TombstoneKeyScope::check('media',$m->account_id,$mediaId,$keys);
            $stone=DB::table('media_tombstones_v1')->where('media_id',$mediaId)
                ->lockForUpdate()->first();
            if($stone){
                if($stone->account_id!==$m->account_id
                    ||$stone->operation_id!==$m->operation_id)
                    throw new \RuntimeException('storage.invalid_tombstone_scope');
                TombstoneKeyScope::decode('media',$m->account_id,
                    $mediaId,$stone->object_keys);
            }else{
                DB::table('media_tombstones_v1')->insert([
                    'media_id'=>$mediaId,'account_id'=>$m->account_id,
                    'operation_id'=>$m->operation_id,
                    'object_keys'=>json_encode($keys,JSON_THROW_ON_ERROR),
                    'next_sweep_at'=>now()->addHour(),'created_at'=>now(),
                ]);
            }
            if($m->state==='deleting')return;
            DB::table('media_files_v1')->where('id',$mediaId)->update([
                'state'=>'deleting','cleanup_next_at'=>now()->addMinutes(
                    (int)config('media_sync.cleanup_lease_minutes',15)),
                'updated_at'=>now(),
            ]);
        },3);
    }

    public function cleanup(string $mediaId):void
    {
        $m=DB::table('media_files_v1')->where('id',$mediaId)->first();
        if(!$m)return;
        abort_unless($m->state==='deleting'
            ||(int)$m->expires_at<=PhotoSync::nowMs(),409);
        // A preexisting deleting record MUST still have an immutable
        // tombstone before physical deletion of its S3 placements.
        $this->mark($mediaId);
        $stone=DB::table('media_tombstones_v1')
            ->where('media_id',$mediaId)->first();
        if(!$stone||$stone->account_id!==$m->account_id
            ||$stone->operation_id!==$m->operation_id)
            throw new \RuntimeException('storage.missing_tombstone');
        $allowed=TombstoneKeyScope::decode('media',$m->account_id,
            $mediaId,$stone->object_keys);
        $ids=DB::table('media_chunks_v1')->where('media_id',$mediaId)
            ->orderBy('id')->pluck('id')->all();
        $placements=DB::table('media_chunk_locations_v1 as l')
            ->join('media_chunks_v1 as c','c.id','=','l.chunk_id')
            ->where('c.media_id',$mediaId)->pluck('l.object_key')->all();
        TombstoneKeyScope::check('media',$m->account_id,$mediaId,$placements);
        if(array_diff($placements,$allowed))
            throw new \RuntimeException('storage.untracked_gc_placement');
        // Do not remove ANY placement pointer until EVERY S3 delete and
        // independent absence check have completed successfully.
        foreach($ids as $id)$this->storage->deleteMediaChunk($id);
        DB::transaction(function()use($mediaId,$ids){
            $row=DB::table('media_files_v1')
                ->where('id',$mediaId)->lockForUpdate()->first();
            if(!$row)return;
            abort_unless($row->state==='deleting',409);
            DB::table('media_chunk_locations_v1')
                ->whereIn('chunk_id',$ids)->delete();
            DB::table('media_chunks_v1')->where('media_id',$mediaId)->delete();
            DB::table('media_files_v1')->where('id',$mediaId)->delete();
            // Permanent tombstone survives (late-write sweeps retry forever).
        },3);
    }

    /** Stalled upload recovery cannot silently delete unexpired ciphertext. */
    public function reconcileStalledChunks(int $batch):array
    {
        $threshold=now()->subHours(
            max(1,(int)config('media_sync.stalled_grace_hours',24)));
        $rows=DB::table('media_chunks_v1 as c')
            ->join('media_files_v1 as m','m.id','=','c.media_id')
            ->where('m.state','pending')
            ->where('m.expires_at','>',PhotoSync::nowMs())
            ->whereIn('c.state',['pending','uploading'])
            ->where('c.updated_at','<',$threshold)
            ->orderBy('c.updated_at')->orderBy('c.id')
            ->limit(max(1,$batch))
            ->get(['c.id','c.media_id','c.bytes','c.sha256']);
        $result=['verified'=>0,'reset'=>0,'deferred'=>0,'errors'=>0];
        foreach($rows as $c){
            try{
                $valid=$this->storage->verifyMediaChunk(
                    $c->id,(int)$c->bytes,$c->sha256);
                $change=DB::transaction(function()use($c,$valid,$threshold):?string{
                    $m=DB::table('media_files_v1')->where('id',$c->media_id)
                        ->lockForUpdate()->first();
                    if(!$m||$m->state!=='pending'
                        ||$m->expires_at<=PhotoSync::nowMs())return null;
                    $row=DB::table('media_chunks_v1')
                        ->where('id',$c->id)->lockForUpdate()->first();
                    if(!$row||$row->media_id!==$m->id
                        ||!in_array($row->state,['pending','uploading'],true)
                        ||\Carbon\CarbonImmutable::parse($row->updated_at)
                            ->greaterThanOrEqualTo($threshold))return null;
                    if($valid){
                        DB::table('media_chunks_v1')->where('id',$row->id)
                            ->update(['state'=>'verified','updated_at'=>now()]);
                        DB::table('media_chunk_locations_v1')
                            ->where('chunk_id',$row->id)
                            ->update(['state'=>'verified','updated_at'=>now()]);
                        return 'verified';
                    }
                    if($row->state==='uploading'){
                        DB::table('media_chunks_v1')->where('id',$row->id)
                            ->update(['state'=>'pending','updated_at'=>now()]);
                        DB::table('media_chunk_locations_v1')
                            ->where('chunk_id',$row->id)
                            ->update(['state'=>'reserved','updated_at'=>now()]);
                        return 'reset';
                    }
                    DB::table('media_chunks_v1')->where('id',$row->id)
                        ->update(['updated_at'=>now()]);
                    return 'deferred';
                },3);
                if($change!==null)$result[$change]++;
            }catch(\Throwable){$result['errors']++;}
        }
        return $result;
    }

    public function sweepTombstones(int $batch):int
    {
        $rows=DB::table('media_tombstones_v1')
            ->where('next_sweep_at','<=',now())
            ->orderBy('next_sweep_at')->orderBy('media_id')
            ->limit(max(1,$batch))->get();
        $cleaned=0;
        foreach($rows as $row){
            try{
                $keys=TombstoneKeyScope::decode('media',
                    $row->account_id,$row->media_id,$row->object_keys);
                // Reject a mixed-ownership list before touching any S3 key.
                foreach($keys as $key)$this->storage->sweepMediaLateWrite($key);
                DB::table('media_tombstones_v1')->where('media_id',$row->media_id)
                    ->update(['next_sweep_at'=>now()->addSeconds(
                        max(60,(int)config('media_sync.tombstone_sweep_seconds',3600))),
                    ]);
                $cleaned++;
            }catch(\Throwable){
                // An S3 outage is not proof that any object was removed.
                // Keep original key list and retry the SAME tombstone later.
            }
        }
        return $cleaned;
    }
}
