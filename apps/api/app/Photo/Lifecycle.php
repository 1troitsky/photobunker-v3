<?php
declare(strict_types=1);

namespace App\Photo;

use App\Storage\StorageManager;
use Illuminate\Support\Facades\DB;

/**
 * Preserves PB2's two-phase deletion and tombstones. Only personal P1 photos;
 * no assignment/editor tables are accessed before their migration exists.
 */
final class Lifecycle
{
    public function __construct(private readonly StorageManager $storage) {}

    public function mark(string $photoId, string $reason = 'expired'): void
    {
        DB::transaction(function() use ($photoId,$reason): void {
            $row=DB::table('photo_records')->where('id',$photoId)->lockForUpdate()->first();
            if (!$row) return;
            $keys=DB::table('storage_locations as l')
                ->join('photo_objects as o','o.id','=','l.asset_id')
                ->where('o.photo_id',$photoId)->pluck('l.object_key')->all();
            DB::table('photo_tombstones')->insertOrIgnore([
                'photo_id'=>$photoId, 'account_id'=>$row->account_id,
                'operation_id'=>$row->operation_id,'reason'=>$reason,
                'object_keys'=>json_encode($keys,JSON_THROW_ON_ERROR),
                'cleanup_until'=>now()->addDay(), 'created_at'=>now(),
            ]);
            DB::table('photo_records')->where('id',$photoId)->update([
                'state'=>'deleting','cleanup_next_at'=>now()->addMinutes(
                    (int)config('photo_sync.cleanup_lease_minutes',15)),
                'updated_at'=>now(),
            ]);
        },3);
    }

    public function cleanup(string $photoId): void
    {
        $photo=DB::table('photo_records')->where('id',$photoId)->first();
        if (!$photo) return;
        abort_unless($photo->state==='deleting'||$photo->expires_at<=PhotoSync::nowMs(),409);
        if ($photo->state!=='deleting') $this->mark($photoId);
        $assetIds=DB::table('photo_objects')->where('photo_id',$photoId)->pluck('id')->all();
        // Physical removal is OUTSIDE the database transaction, with verification.
        foreach ($assetIds as $assetId) $this->storage->deleteAsset($assetId);
        DB::transaction(function() use ($photoId,$assetIds): void {
            $photo=DB::table('photo_records')->where('id',$photoId)->lockForUpdate()->first();
            if (!$photo) return;
            abort_unless($photo->state==='deleting',409);
            DB::table('storage_locations')->whereIn('asset_id',$assetIds)->delete();
            DB::table('photo_objects')->where('photo_id',$photoId)->delete();
            DB::table('photo_records')->where('id',$photoId)->delete();
        },3);
    }

    public function recoverOrphans(int $batch): int
    {
        $threshold=now()->subHours((int)config('photo_sync.orphan_grace_hours',24));
        $objects=DB::table('photo_objects as o')
          ->join('photo_records as p','p.id','=','o.photo_id')
          ->where('p.state','pending')
          ->whereIn('o.state',['pending','uploading','verified'])
          ->where('o.updated_at','<',$threshold)
          ->orderBy('o.updated_at')->limit($batch)->select('o.id')->get();
        $cleaned=0;
        foreach($objects as $o){
            try {
                $this->storage->deleteAsset($o->id);
                DB::table('photo_objects')->where('id',$o->id)
                  ->whereIn('state',['pending','uploading','verified'])
                  ->update(['state'=>'pending','updated_at'=>now()]);
                DB::table('storage_locations')->where('asset_id',$o->id)
                  ->update(['state'=>'reserved','updated_at'=>now()]);
                $cleaned++;
            } catch(\Throwable) {
                // Keep durable pointers; maintenance retries without secret logging.
            }
        }
        return $cleaned;
    }

    public function sweepTombstones(int $batch): void
    {
        $rows=DB::table('photo_tombstones')->whereNotNull('object_keys')
          ->where('cleanup_until','<=',now())
          ->orderBy('cleanup_until')->limit($batch)->get();
        foreach($rows as $row){
            try {
                foreach(json_decode($row->object_keys,true,16,JSON_THROW_ON_ERROR) as $key){
                    $this->storage->sweepLateWrite($key);
                }
                DB::table('photo_tombstones')->where('photo_id',$row->photo_id)
                  ->update(['object_keys'=>null,'cleanup_until'=>null]);
            } catch(\Throwable) {
                // Leave tombstone and retry on future runs; account ID replay stays blocked.
            }
        }
    }
}
