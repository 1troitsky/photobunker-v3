<?php
declare(strict_types=1);

namespace App\Storage;

use App\Photo\PhotoSync;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Durable, idempotent S3 ACK-loss reconciliation. Tickets carry opaque logical
 * IDs only, not encrypted bytes or object keys. If S3 never received a PUT,
 * only the original encrypted client outbox can retry those bytes.
 *
 * The worker may verify and promote a complete ciphertext object; it must
 * never invent an ACK, receipt or new ciphertext from a missing object.
 */
final class StorageRetryLedger
{
    public function remember(string $kind,string $assetId):void
    {
        if(!in_array($kind,['photo','media'],true)
            ||preg_match('/^[0-9a-f-]{36}$/D',$assetId)!==1)
            throw new \InvalidArgumentException('storage.invalid_retry_target');
        DB::table('storage_retry_tickets')->insertOrIgnore([
            'kind'=>$kind,'asset_id'=>$assetId,'attempts'=>0,
            'disposition'=>'pending','next_attempt_at'=>now(),
            'lease_until'=>null,'created_at'=>now(),'updated_at'=>now(),
        ]);
    }

    /** Counts only, never IDs, plaintext or object paths. */
    public function status():array
    {
        return [
            'pending'=>(int)DB::table('storage_retry_tickets')->where('disposition','pending')->count(),
            'await_client'=>(int)DB::table('storage_retry_tickets')->where('disposition','await_client')->count(),
            'retry'=>(int)DB::table('storage_retry_tickets')->where('disposition','retry')->count(),
        ];
    }

    private function ticket(string $kind,string $assetId):?object
    {
        return DB::transaction(function()use($kind,$assetId):?object{
            $row=DB::table('storage_retry_tickets')
                ->where('kind',$kind)->where('asset_id',$assetId)
                ->lockForUpdate()->first();
            if(!$row||Carbon::parse($row->next_attempt_at)->greaterThan(now())
                ||($row->lease_until!==null
                    &&Carbon::parse($row->lease_until)->greaterThan(now())))return null;
            DB::table('storage_retry_tickets')->where('kind',$kind)
                ->where('asset_id',$assetId)->update([
                    'attempts'=>min(1000000,(int)$row->attempts+1),
                    'lease_until'=>now()->addSeconds(max(5,
                        (int)config('storage_resilience.retry_lease_seconds',120))),
                    'updated_at'=>now(),
                ]);
            return $row;
        },3);
    }

    private function drop(string $kind,string $assetId):void
    {
        DB::table('storage_retry_tickets')->where('kind',$kind)
            ->where('asset_id',$assetId)->delete();
    }

    private function defer(string $kind,string $assetId,int $attempts,string $reason):void
    {
        $base=max(1,(int)config('storage_resilience.retry_base_seconds',30));
        $max=max($base,(int)config('storage_resilience.retry_max_seconds',3600));
        $delay=min($max,$base*(2**min(7,max(0,$attempts-1))));
        DB::table('storage_retry_tickets')->where('kind',$kind)
            ->where('asset_id',$assetId)->update([
                'disposition'=>$reason,
                'lease_until'=>null,
                'next_attempt_at'=>now()->addSeconds($delay),
                'updated_at'=>now(),
            ]);
    }

    /** @return object|null opaque target with server-verified bytes/hash */
    private function target(string $kind,string $id):?object
    {
        if($kind==='media'){
            return DB::table('media_chunks_v1 as c')
                ->join('media_files_v1 as m','m.id','=','c.media_id')
                ->where('c.id',$id)
                ->first(['c.id','c.media_id as parent_id','c.state',
                    'c.updated_at','c.bytes','c.sha256',
                    'm.state as parent_state','m.expires_at']);
        }
        return DB::table('photo_objects as o')
            ->join('photo_records as p','p.id','=','o.photo_id')
            ->where('o.id',$id)
            ->first(['o.id','o.photo_id as parent_id','o.state',
                'o.updated_at','o.bytes','o.sha256',
                'p.state as parent_state','p.expires_at']);
    }

    /** A verified replica may have survived a lost PUT/finalize ACK. */
    private function promote(string $kind,object $target):bool
    {
        return DB::transaction(function()use($kind,$target):bool{
            $media=$kind==='media';
            $parentTable=$media?'media_files_v1':'photo_records';
            $chunkTable=$media?'media_chunks_v1':'photo_objects';
            $keyTable=$media?'media_chunk_locations_v1':'storage_locations';
            $fk=$media?'media_id':'photo_id';
            $locationFk=$media?'chunk_id':'asset_id';
            // Parent->child locking mirrors controllers and TTL cleanup.
            $parent=DB::table($parentTable)->where('id',$target->parent_id)
                ->lockForUpdate()->first();
            if(!$parent||$parent->state!=='pending'
                ||(int)$parent->expires_at<=PhotoSync::nowMs())return false;
            if($media && DB::table('media_tombstones_v1')
                ->where('media_id',$parent->id)->exists())return false;
            if(!$media && DB::table('photo_tombstones')
                ->where('photo_id',$parent->id)->exists())return false;
            $chunk=DB::table($chunkTable)->where('id',$target->id)
                ->lockForUpdate()->first();
            if(!$chunk||$chunk->{$fk}!==$parent->id
                ||!in_array($chunk->state,['pending','uploading','verified'],true)
                ||(int)$chunk->bytes!==(int)$target->bytes
                ||!hash_equals($chunk->sha256,$target->sha256))return false;
            DB::table($chunkTable)->where('id',$target->id)
                ->update(['state'=>'verified','updated_at'=>now()]);
            DB::table($keyTable)->where($locationFk,$target->id)
                ->update(['state'=>'verified','updated_at'=>now()]);
            return true;
        },3);
    }

    /** No remote object found: release only stale upload lease for client retry. */
    private function releaseStaleUpload(string $kind,object $target):void
    {
        DB::transaction(function()use($kind,$target):void{
            $media=$kind==='media';
            $parent=DB::table($media?'media_files_v1':'photo_records')
                ->where('id',$target->parent_id)->lockForUpdate()->first();
            if(!$parent||$parent->state!=='pending'
                ||(int)$parent->expires_at<=PhotoSync::nowMs())return;
            $table=$media?'media_chunks_v1':'photo_objects';
            $row=DB::table($table)->where('id',$target->id)->lockForUpdate()->first();
            if(!$row||$row->state!=='uploading'
                ||Carbon::parse($row->updated_at)->greaterThan(now()->subMinutes(2)))
                return;
            DB::table($table)->where('id',$row->id)
                ->update(['state'=>'pending','updated_at'=>now()]);
            DB::table($media?'media_chunk_locations_v1':'storage_locations')
                ->where($media?'chunk_id':'asset_id',$row->id)
                ->update(['state'=>'reserved','updated_at'=>now()]);
        },3);
    }

    /**
     * Bounded lease-driven pass; safe to run concurrently or after PHP restart.
     * This is a server metadata/status reconciliation, NOT a second upload queue.
     */
    public function reconcile(StorageManager $storage,int $limit=100):array
    {
        $limit=max(1,min(500,$limit));
        $candidates=DB::table('storage_retry_tickets')
            ->where('next_attempt_at','<=',now())
            ->where(function($q):void{
                $q->whereNull('lease_until')->orWhere('lease_until','<=',now());
            })->orderBy('next_attempt_at')->orderBy('kind')
            ->orderBy('asset_id')->limit($limit)
            ->get(['kind','asset_id']);
        $result=['verified'=>0,'await_client'=>0,'retry'=>0,'retired'=>0];
        foreach($candidates as $candidate){
            $kind=$candidate->kind;$id=$candidate->asset_id;
            $ticket=$this->ticket($kind,$id);
            if(!$ticket)continue;
            $attempts=min(1000000,(int)$ticket->attempts+1);
            try{
                $target=$this->target($kind,$id);
                if(!$target||$target->parent_state!=='pending'
                    ||(int)$target->expires_at<=PhotoSync::nowMs()
                    ||in_array($target->state,['active','verified'],true)){
                    $this->drop($kind,$id);$result['retired']++;continue;
                }
                $valid=$kind==='media'
                    ?$storage->verifyMediaChunk($id,(int)$target->bytes,$target->sha256)
                    :$storage->verifyAsset($id,(int)$target->bytes,$target->sha256);
                if($valid){
                    if($this->promote($kind,$target))$result['verified']++;
                    else $result['retired']++;
                    $this->drop($kind,$id);
                }else{
                    $this->releaseStaleUpload($kind,$target);
                    $this->defer($kind,$id,$attempts,'await_client');
                    $result['await_client']++;
                }
            }catch(\Throwable){
                // Storage outage is not evidence of missing ciphertext.
                $this->defer($kind,$id,$attempts,'retry');
                $result['retry']++;
            }
        }
        return $result;
    }
}
