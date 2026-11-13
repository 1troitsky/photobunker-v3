<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use App\Events\DatabaseEventInboxLedger;
use App\Events\EventAdmission;
use App\Events\EventConsumer;
use Illuminate\Support\Str;
use App\Billing\QuotaAdmission;
use App\Billing\RetentionAdmission;
use App\Media\MediaContract as C;
use App\Photo\PhotoSync;
use App\Storage\StorageManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class MediaV1Controller extends Controller
{
    public function __construct(
        private readonly PhotoSync $identity,
        private readonly StorageManager $storage,
        private readonly QuotaAdmission $quota,
        private readonly RetentionAdmission $retention,
    ) {}

    private function record(string $id,string $account,bool $active=false):object
    {
        P::uuid($id);
        $row=DB::table('media_files_v1')
            ->where('id',$id)->where('account_id',$account)->first();
        if(!$row){
            abort_if(DB::table('media_tombstones_v1')
                ->where('media_id',$id)->where('account_id',$account)->exists(),410);
            abort(404);
        }
        abort_if($row->state==='deleting'||$row->expires_at<=PhotoSync::nowMs(),410);
        if($active)abort_unless($row->state==='active',409);
        return $row;
    }

    public function reserve(Request $request):\Illuminate\Http\JsonResponse
    {
        $this->identity->origin($request);
        [$account,$device]=$this->identity->actor($request);
        $payload=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($payload['contract'])&&is_string($payload['signature']),422);
        $c=C::verify($payload['contract'],$payload['signature'],
            $device->signing_spki,$account->id,
            RetentionAdmission::MAX_SIGNED_DAYS_V1);
        $hash=hash('sha256',$payload['contract']);

        return DB::transaction(function()use($account,$device,$c,$payload,$hash){
            DB::table('identity_accounts')->where('id',$account->id)
                ->lockForUpdate()->first();
            $row=DB::table('media_files_v1')
                ->where('id',$c['mediaId'])->lockForUpdate()->first();
            $other=DB::table('media_files_v1')
                ->where('account_id',$account->id)
                ->where('operation_id',$c['operationId'])->first();
            abort_if(DB::table('media_tombstones_v1')
                ->where('media_id',$c['mediaId'])->exists(),410);
            if($row||$other){
                $existing=$row??$other;
                abort_unless($existing->account_id===$account->id
                    &&$existing->id===$c['mediaId']
                    &&hash_equals($existing->contract_hash,$hash),409);
                abort_if($existing->state==='deleting'
                    ||$existing->expires_at<=PhotoSync::nowMs(),410);
                return $this->identity->json($existing->state==='active'
                    ?['state'=>'active','receipt'=>json_decode($existing->receipt,true)]
                    :['state'=>'pending','mediaId'=>$existing->id,
                        'expiresAt'=>(int)$existing->expires_at]);
            }
            // Prevent cross-protocol ID confusion even though signed domains
            // are disjoint and clients use cryptographically random UUIDs.
            abort_if(DB::table('photo_records')
                ->where('id',$c['mediaId'])->exists(),409);
            // The authenticated account's current immutable signed plan,
            // never an untrusted client plan, bounds only NEW deadlines.
            // The replay path above preserves an already accepted expiry.
            $this->retention->assertNew($account->id,$c['expiresAt']);
            // Shared account-serialized quota: no duplicate charge for lost
            // ACK replays, and no ad-hoc Free count for verified paid plans.
            // The existing 1e9-byte ciphertext guard remains in force until
            // explicit GB/GiB approval for versioned paid byte limits.
            $this->quota->admit($account->id,(int)$c['totalCipherBytes']);

            DB::table('media_files_v1')->insert([
                'id'=>$c['mediaId'],'account_id'=>$account->id,
                'device_id'=>$device->id,'operation_id'=>$c['operationId'],
                'media_type'=>$c['mediaType'],'state'=>'pending',
                'expires_at'=>$c['expiresAt'],'plain_bytes'=>$c['plainBytes'],
                'cipher_bytes'=>$c['totalCipherBytes'],
                'contract_hash'=>$hash,'contract_json'=>$payload['contract'],
                'signature'=>$payload['signature'],
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            foreach($c['chunks'] as $chunk){
                DB::table('media_chunks_v1')->insert([
                    'id'=>$chunk['chunkId'],'media_id'=>$c['mediaId'],
                    'chunk_index'=>$chunk['index'],'kind'=>$chunk['kind'],
                    'plain_bytes'=>$chunk['plainBytes'],'bytes'=>$chunk['bytes'],
                    'sha256'=>$chunk['sha256'],'iv'=>$chunk['iv'],
                    'state'=>'pending','created_at'=>now(),'updated_at'=>now(),
                ]);
                DB::table('media_chunk_locations_v1')->insert([
                    'id'=>(string)Str::uuid(),'chunk_id'=>$chunk['chunkId'],
                    'provider'=>'app_s3',
                    'object_key'=>$this->objectKey($account->id,
                        $c['mediaId'],$chunk['chunkId']),
                    'sha256'=>$chunk['sha256'],'bytes'=>$chunk['bytes'],
                    'state'=>'reserved','created_at'=>now(),'updated_at'=>now(),
                ]);
            }
            return $this->identity->json([
                'state'=>'pending','mediaId'=>$c['mediaId'],
                'expiresAt'=>$c['expiresAt'],
            ],201);
        },3);
    }

    private function objectKey(string $account,string $media,string $chunk):string
    {
        P::uuid($account);P::uuid($media);P::uuid($chunk);
        return 'cipher/media/v1/'.$account.'/'.$media.'/'.$chunk;
    }

    public function upload(Request $request,string $mediaId,string $chunkId)
    {
        $this->identity->origin($request);
        [$account]=$this->identity->actor($request);
        P::uuid($chunkId);
        $media=$this->record($mediaId,$account->id);
        abort_unless($media->state==='pending',409);
        $chunk=DB::table('media_chunks_v1')
            ->where('id',$chunkId)->where('media_id',$mediaId)->first();
        abort_unless($chunk,404);
        $length=$request->header('Content-Length');
        abort_unless(is_string($length)&&ctype_digit($length)
            &&(int)$length===(int)$chunk->bytes,422);

        $write=DB::transaction(function()use($mediaId,$chunkId,$account){
            $m=DB::table('media_files_v1')
                ->where('id',$mediaId)->lockForUpdate()->first();
            abort_unless($m&&$m->account_id===$account->id,404);
            abort_if($m->state==='deleting'
                ||$m->expires_at<=PhotoSync::nowMs(),410);
            abort_unless($m->state==='pending',409);
            $c=DB::table('media_chunks_v1')
                ->where('id',$chunkId)->lockForUpdate()->first();
            abort_unless($c&&$c->media_id===$mediaId,404);
            if(in_array($c->state,['verified','active'],true))return false;
            if($c->state==='uploading'
                &&\Carbon\CarbonImmutable::parse($c->updated_at)
                    ->greaterThan(now()->subMinutes(2))){
                // Concurrent PUT or a lost ACK with a still-live upload
                // lease is TRANSIENT. HTTP 409 permanently quarantines the
                // encrypted IndexedDB outbox; HTTP 503 keeps ciphertext
                // queued for the next safe retry, without a forged ACK.
                abort(503,'media.chunk_upload_in_progress',[
                    'Retry-After'=>'5','Cache-Control'=>'no-store',
                ]);
            }
            DB::table('media_chunks_v1')->where('id',$chunkId)
                ->update(['state'=>'uploading','updated_at'=>now()]);
            return true;
        },3);
        if(!$write){
            abort_unless($this->storage->verifyMediaChunk(
                $chunkId,(int)$chunk->bytes,$chunk->sha256),503);
            return $this->identity->json(['verified'=>true,'chunkId'=>$chunkId]);
        }
        try{
            $stream=$request->getContent(true);
            abort_unless(is_resource($stream),422);
            try{$ok=$this->storage->writeMediaChunk($chunkId,$stream);}
            finally{fclose($stream);}
            abort_unless($ok&&$this->storage->verifyMediaChunk(
                $chunkId,(int)$chunk->bytes,$chunk->sha256),503);
            DB::transaction(function()use($mediaId,$chunkId,$account){
                $m=DB::table('media_files_v1')
                    ->where('id',$mediaId)->lockForUpdate()->first();
                abort_unless($m&&$m->account_id===$account->id,410);
                abort_if($m->state==='deleting'
                    ||$m->expires_at<=PhotoSync::nowMs(),410);
                DB::table('media_chunks_v1')->where('id',$chunkId)
                    ->update(['state'=>'verified','updated_at'=>now()]);
                DB::table('media_chunk_locations_v1')->where('chunk_id',$chunkId)
                    ->update(['state'=>'verified','updated_at'=>now()]);
            },3);
            return $this->identity->json(['verified'=>true,'chunkId'=>$chunkId]);
        }catch(\Throwable $e){
            DB::table('media_chunks_v1')
                ->where('id',$chunkId)->where('state','uploading')
                ->update(['state'=>'pending','updated_at'=>now()]);
            if($e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface)
                throw $e;
            abort(503,'media.storage_unavailable');
        }
    }

    public function finalize(Request $request,string $mediaId)
    {
        $this->identity->origin($request);
        [$account]=$this->identity->actor($request);
        $data=P::exact($request->json()->all(),['operationId']);
        P::uuid($data['operationId']);
        $m=$this->record($mediaId,$account->id);
        abort_unless($m->operation_id===$data['operationId'],409);
        if($m->state==='active')return $this->identity->json([
            'receipt'=>json_decode($m->receipt,true),
        ]);
        abort_unless($m->state==='pending',409);
        $chunks=DB::table('media_chunks_v1')->where('media_id',$mediaId)
            ->orderBy('chunk_index')->get();
        abort_unless($chunks->count()>=2
            &&$chunks->count()<=C::MAX_CHUNKS+1
            &&$chunks->every(fn($c)=>$c->state==='verified'),409);
        foreach($chunks as $c)
            abort_unless($this->storage->verifyMediaChunk(
                $c->id,(int)$c->bytes,$c->sha256),503);
        return DB::transaction(function()use($mediaId,$account,$chunks){
            // Maintain account -> media lock order (as in reserve) so event
            // ledger admission shares the SAME transaction without deadlock.
            DB::table('identity_accounts')->where('id',$account->id)
                ->lockForUpdate()->first();
            $m=DB::table('media_files_v1')
                ->where('id',$mediaId)->lockForUpdate()->first();
            abort_unless($m&&$m->account_id===$account->id,404);
            abort_if($m->state==='deleting'
                ||$m->expires_at<=PhotoSync::nowMs(),410);
            if($m->state==='active')return $this->identity->json([
                'receipt'=>json_decode($m->receipt,true),
            ]);
            $current=DB::table('media_chunks_v1')
                ->where('media_id',$mediaId)->lockForUpdate()
                ->orderBy('chunk_index')->get();
            abort_unless($current->count()===$chunks->count()
                &&$current->every(fn($c)=>$c->state==='verified'),409);
            $receipt=[
                'mediaId'=>$mediaId,
                'operationId'=>$m->operation_id,
                'mediaType'=>$m->media_type,
                'expiresAt'=>(int)$m->expires_at,
                'chunks'=>$current->map(static fn($c)=>[
                    'chunkId'=>$c->id,'index'=>(int)$c->chunk_index,
                    'sha256'=>$c->sha256,'bytes'=>(int)$c->bytes,
                ])->all(),
            ];
            $receipt['receiptHash']=hash('sha256',
                json_encode($receipt,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
            DB::table('media_files_v1')->where('id',$mediaId)->update([
                'state'=>'active','receipt'=>json_encode($receipt,JSON_THROW_ON_ERROR),
                'updated_at'=>now(),
            ]);
            DB::table('media_chunks_v1')->where('media_id',$mediaId)
                ->update(['state'=>'active','updated_at'=>now()]);
            DB::table('media_chunk_locations_v1')
                ->whereIn('chunk_id',$current->pluck('id')->all())
                ->update(['state'=>'active','updated_at'=>now()]);
            // Durable event is committed atomically with media activation.
            // Never publish after commit: a worker crash would lose the notice.
            // No payload or ciphertext leaves the trusted event allowlist.
            $event=[
                'schemaVersion'=>1,
                'eventId'=>(string) Str::uuid(),
                'eventType'=>'MediaCommitted',
                'accountId'=>(string)$account->id,
                'subjectType'=>'media',
                'subjectId'=>$mediaId,
                'occurredAtMs'=>PhotoSync::nowMs(),
                'revision'=>1,
            ];
            $admission=(new EventConsumer(new DatabaseEventInboxLedger()))
                ->ingest($event,(string)$account->id);
            abort_unless($admission===EventAdmission::Accepted,503,
                'media.notification_event_unavailable');
            return $this->identity->json(['receipt'=>$receipt]);
        },3);
    }

    public function index(Request $request)
    {
        [$account]=$this->identity->actor($request);
        $after=$request->query('after');
        if($after!==null){
            abort_unless(is_string($after),422);
            P::uuid($after);
        }
        $rows=DB::table('media_files_v1')
            ->where('account_id',$account->id)
            ->where('state','active')
            ->where('expires_at','>',PhotoSync::nowMs())
            ->whereNotExists(static function($q){
                $q->selectRaw('1')->from('browser_archive_entries_v1 as archive')
                    ->whereColumn('archive.asset_id','media_files_v1.id')
                    ->where('archive.kind','media')
                    ->whereIn('archive.state',['archived','deleting']);
            });
        if($after!==null)$rows->where('id','>',$after);
        $page=$rows->orderBy('id')->limit(51)
            ->get(['id','media_type','expires_at','plain_bytes']);
        $hasMore=$page->count()>50;
        $items=$page->take(50)->map(static fn($m)=>[
            'mediaId'=>$m->id,'mediaType'=>$m->media_type,
            'expiresAt'=>(int)$m->expires_at,'plainBytes'=>(int)$m->plain_bytes,
        ])->values()->all();
        return $this->identity->json([
            'items'=>$items,'nextCursor'=>$hasMore&&$items!==[]
                ?end($items)['mediaId']:null,
        ]);
    }

    public function manifests(Request $request,string $mediaId)
    {
        [$account]=$this->identity->actor($request);
        $m=$this->record($mediaId,$account->id,true);
        return $this->identity->json([
            'mediaId'=>$mediaId,
            'contract'=>$m->contract_json,'signature'=>$m->signature,
            'receipt'=>json_decode($m->receipt,true),
        ]);
    }

    public function read(Request $request,string $mediaId,string $chunkId)
    {
        [$account]=$this->identity->actor($request);
        $this->record($mediaId,$account->id,true);
        P::uuid($chunkId);
        $chunk=DB::table('media_chunks_v1')
            ->where('id',$chunkId)->where('media_id',$mediaId)
            ->where('state','active')->first();
        abort_unless($chunk,404);
        try{$stream=$this->storage->readMediaChunk($chunkId);}
        catch(\Throwable){abort(503,'media.storage_unavailable');}
        abort_unless(is_resource($stream),503);
        return response()->stream(static function()use($stream){
            try{while(!feof($stream)){echo fread($stream,65536);flush();}}
            finally{fclose($stream);}
        },200,[
            'Content-Type'=>'application/octet-stream',
            'Cache-Control'=>'no-store, private',
            'X-Content-Type-Options'=>'nosniff',
            'X-Cipher-SHA256'=>$chunk->sha256,
        ]);
    }
}
