<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Identity\Protocol as P;
use App\Media\MediaLifecycle;
use App\Photo\Lifecycle as PhotoLifecycle;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * P2 Browser owner-authorized archive lifecycle. Archive is a durable
 * server-owned state, NEVER a browser-only hidden flag or S3 object move.
 *
 * Initial safety scope: standalone, non-shared photo/media owned by caller.
 * Assignment evidence and live grants are deliberately NOT archivable.
 * Permanent delete uses existing tombstones & StorageManager GC; never
 * reports physical deletion until the existing lifecycle confirms absence.
 */
final class BrowserArchiveController extends Controller
{
    private const DOMAIN='pb3.browser-archive.v1';
    private const FIELDS=[
        'version','accountId','writerDeviceId','operationId',
        'kind','assetId','action','expectedRevision',
    ];

    public function __construct(
        private readonly PhotoSync $identity,
        private readonly PhotoLifecycle $photos,
        private readonly MediaLifecycle $media,
    ) {}

    public function index(Request $request)
    {
        [$account]=$this->identity->actor($request);
        $after=$request->query('after');
        abort_unless($after===null||is_string($after),422);
        if($after!==null)P::uuid($after);
        $query=DB::table('browser_archive_entries_v1')
            ->where('account_id',$account->id)
            // Include restored historical revisions for authenticated
            // owner CAS. The UI displays them in the normal catalog only.
            ->whereIn('state',['archived','restored','deleting']);
        if($after!==null)$query->where('id','>',$after);
        $rows=$query->orderBy('id')->limit(51)->get();
        $now=PhotoSync::nowMs();
        $page=$rows->take(50)->map(function($r)use($now){
            $state=$r->state;
            $physical='not_started';
            if($state==='deleting'){
                $assetTable=$r->kind==='photo'?'photo_records':'media_files_v1';
                $tombstoneTable=$r->kind==='photo'?'photo_tombstones':'media_tombstones_v1';
                $tombstoneKey=$r->kind==='photo'?'photo_id':'media_id';
                // The P1 lifecycle only removes DB records after every S3
                // location is confirmed absent; tombstones remain for sweeps.
                $gone=!DB::table($assetTable)->where('id',$r->asset_id)->exists();
                $marked=DB::table($tombstoneTable)
                    ->where($tombstoneKey,$r->asset_id)->exists();
                $physical=$gone&&$marked?'verified_absent':'pending_gc';
            }elseif((int)$r->asset_expires_at_ms<=$now
                ||($r->archive_until_ms!==null
                    &&(int)$r->archive_until_ms<=$now)){
                $physical='past_due_pending_gc';
            }
            return [
                'entryId'=>$r->id,'kind'=>$r->kind,'assetId'=>$r->asset_id,
                'revision'=>(int)$r->revision,'state'=>$state,
                'archiveUntilMs'=>$r->archive_until_ms===null
                    ?null:(int)$r->archive_until_ms,
                'expiresAt'=>(int)$r->asset_expires_at_ms,
                'mediaType'=>$r->media_type,
                'plainBytes'=>$r->plain_bytes===null?null:(int)$r->plain_bytes,
                'physicalStatus'=>$physical,
            ];
        })->values()->all();
        return $this->identity->json([
            'items'=>$page,
            'nextCursor'=>$rows->count()>50&&$page!==[]
                ?end($page)['entryId']:null,
            'writeEnabled'=>(bool)config('browser_archive.write_enabled',false),
            'autoCleanupEnabled'=>(bool)config('browser_archive.auto_cleanup_enabled',false),
        ]);
    }

    private static function assetTable(string $kind):string
    {
        return $kind==='photo'?'photo_records':'media_files_v1';
    }

    /**
     * Keep assignment proof and outstanding signed share grants intact.
     * The owner must revoke active grants separately before archiving.
     */
    private static function standalone(string $kind,string $id):void
    {
        if($kind==='photo'){
            abort_if(DB::table('assignment_submissions_v1')
                ->where('photo_id',$id)->exists(),409);
            abort_if(DB::table('photo_access_grants')
                ->where('photo_id',$id)->exists(),409);
        }else{
            abort_if(DB::table('assignment_media_submissions_v1')
                ->where('media_id',$id)->exists(),409);
            abort_if(DB::table('media_recipient_grants_v1')
                ->where('media_id',$id)->exists(),409);
        }
    }

    /**
     * Read-only, signed resolution of an unknown/Lost ACK. It never cancels
     * a command while that command might still commit at its original CAS
     * revision. A newer immutable archive revision makes an old CAS obsolete.
     */
    public function inspect(Request $request)
    {
        $this->identity->origin($request);
        [$account,$device]=$this->identity->actor($request);
        $body=P::exact($request->json()->all(),['command','signature']);
        abort_unless(is_string($body['command'])
            &&is_string($body['signature']),422);
        $c=C::signed($body['command'],$body['signature'],
            $account->account_spki,self::DOMAIN,self::FIELDS,10000);
        abort_unless($c['version']===1
            &&$c['accountId']===$account->id
            &&$c['writerDeviceId']===$device->id
            &&in_array($c['kind'],['photo','media'],true)
            &&in_array($c['action'],['archive','restore','delete'],true)
            &&is_int($c['expectedRevision'])
            &&$c['expectedRevision']>=0
            &&$c['expectedRevision']<100000000,422);
        foreach(['accountId','writerDeviceId','operationId','assetId'] as $name)
            C::uuid($c,$name);
        $hash=hash('sha256',$body['command']);
        return DB::transaction(function()use($account,$body,$c,$hash){
            $actor=DB::table('identity_accounts')->where('id',$account->id)
                ->lockForUpdate()->first();
            abort_unless($actor&&$actor->status==='ready',401);
            $event=DB::table('browser_archive_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($event){
                abort_unless($event->account_id===$account->id
                    &&hash_equals($event->contract_hash,$hash)
                    &&hash_equals($event->account_signature,$body['signature']),409);
                return $this->identity->json([
                    'status'=>'committed',
                    'currentRevision'=>(int)$event->to_revision,
                    'result'=>json_decode($event->result_json,true,16,JSON_THROW_ON_ERROR),
                ]);
            }
            $entry=DB::table('browser_archive_entries_v1')
                ->where('account_id',$account->id)
                ->where('kind',$c['kind'])
                ->where('asset_id',$c['assetId'])->first();
            $revision=$entry?(int)$entry->revision:0;
            return $this->identity->json([
                // An old CAS can never succeed once the immutable version
                // has passed it, even if a late HTTP POST arrives afterward.
                'status'=>$revision>$c['expectedRevision']
                    ?'obsolete':'unresolved',
                'currentRevision'=>$revision,
                'result'=>null,
            ]);
        },3);
    }

    public function mutate(Request $request)
    {
        abort_unless(config('browser_archive.write_enabled',false),503);
        $this->identity->origin($request);
        [$account,$device]=$this->identity->actor($request);
        $body=P::exact($request->json()->all(),['command','signature']);
        abort_unless(is_string($body['command'])
            &&is_string($body['signature']),422);
        $c=C::signed($body['command'],$body['signature'],
            $account->account_spki,self::DOMAIN,self::FIELDS,10000);
        abort_unless($c['version']===1
            &&$c['accountId']===$account->id
            &&$c['writerDeviceId']===$device->id
            &&in_array($c['kind'],['photo','media'],true)
            &&in_array($c['action'],['archive','restore','delete'],true)
            &&is_int($c['expectedRevision'])
            &&$c['expectedRevision']>=0
            &&$c['expectedRevision']<100000000,422);
        foreach(['accountId','writerDeviceId','operationId','assetId'] as $name)
            C::uuid($c,$name);
        $hash=hash('sha256',$body['command']);

        return DB::transaction(function()use($account,$device,$body,$c,$hash){
            $actor=DB::table('identity_accounts')->where('id',$account->id)
                ->lockForUpdate()->first();
            abort_unless($actor&&$actor->status==='ready',401);
            $old=DB::table('browser_archive_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($old){
                abort_unless($old->account_id===$account->id
                    &&hash_equals($old->contract_hash,$hash)
                    &&hash_equals($old->account_signature,$body['signature']),409);
                $replayed=json_decode($old->result_json,true,16,JSON_THROW_ON_ERROR);
                $replayed['unchanged']=true;
                return $this->identity->json($replayed);
            }

            $now=PhotoSync::nowMs();
            $preferences=BrowserArchivePreferencesController::settings($account->id);
            $asset=DB::table(self::assetTable($c['kind']))
                ->where('id',$c['assetId'])
                ->where('account_id',$account->id)
                ->lockForUpdate()->first();
            abort_unless($asset,404);
            $entry=DB::table('browser_archive_entries_v1')
                ->where('kind',$c['kind'])->where('asset_id',$c['assetId'])
                ->lockForUpdate()->first();
            $revision=$entry?(int)$entry->revision:0;
            abort_unless($revision===$c['expectedRevision'],409);
            abort_if($revision>=100000000,409);
            $next=$revision+1;
            $state='archived';
            $until=$entry? $entry->archive_until_ms:null;
            if($c['action']==='archive'){
                abort_unless($preferences['useArchive'],409);
                abort_unless($asset->state==='active'
                    &&(int)$asset->expires_at>$now,410);
                abort_if($entry&&$entry->state!=='restored',409);
                self::standalone($c['kind'],$asset->id);
                $until=$preferences['autoDeleteAfter7Days']
                    ?min((int)$asset->expires_at,
                        $now+((int)config('browser_archive.archive_days',7))*86400000)
                    :null;
                abort_if($until!==null&&$until<=$now,410);
            }elseif($c['action']==='restore'){
                abort_unless($entry&&$entry->state==='archived',409);
                abort_unless($asset->state==='active'
                    &&(int)$asset->expires_at>$now
                    &&($entry->archive_until_ms===null
                        ||(int)$entry->archive_until_ms>$now),410);
                $state='restored';$until=null;
            }else{
                if($entry){
                    abort_unless($entry->state==='archived',409);
                }else{
                    // Disabling the archive requires a separately signed,
                    // explicitly confirmed irreversible delete; never
                    // silently hide an active asset or bypass operator gates.
                    abort_unless(!$preferences['useArchive'],409);
                    abort_unless($asset->state==='active'
                        &&(int)$asset->expires_at>$now,410);
                }
                // Delete forbidden for assignment evidence even if the
                // archive entry predates a later grant/submission.
                self::standalone($c['kind'],$asset->id);
                if($c['kind']==='photo')$this->photos->mark($asset->id,'archived_delete');
                else $this->media->mark($asset->id);
                $state='deleting';$until=$now;
            }

            $data=[
                'revision'=>$next,'state'=>$state,
                'asset_expires_at_ms'=>(int)$asset->expires_at,
                'archive_until_ms'=>$until,
                'media_type'=>$c['kind']==='media'?$asset->media_type:null,
                'plain_bytes'=>$c['kind']==='media'?(int)$asset->plain_bytes:null,
                'last_operation_id'=>$c['operationId'],'updated_at'=>now(),
            ];
            if($entry){
                DB::table('browser_archive_entries_v1')->where('id',$entry->id)
                    ->update($data);
                $entryId=$entry->id;
            }else{
                $entryId=(string)Str::uuid();
                DB::table('browser_archive_entries_v1')->insert([
                    'id'=>$entryId,'account_id'=>$account->id,
                    'kind'=>$c['kind'],'asset_id'=>$asset->id,
                    ...$data,'created_at'=>now(),
                ]);
            }
            $result=[
                'entryId'=>$entryId,'kind'=>$c['kind'],
                'assetId'=>$asset->id,'state'=>$state,'revision'=>$next,
                'archiveUntilMs'=>$until,'expiresAt'=>(int)$asset->expires_at,
                'physicalStatus'=>$state==='deleting'?'pending_gc':'not_started',
                'unchanged'=>false,
            ];
            DB::table('browser_archive_events_v1')->insert([
                'operation_id'=>$c['operationId'],'account_id'=>$account->id,
                'writer_device_id'=>$device->id,
                'kind'=>$c['kind'],'asset_id'=>$asset->id,'action'=>$c['action'],
                'from_revision'=>$revision,'to_revision'=>$next,
                'contract_hash'=>$hash,
                'command_json'=>$body['command'],
                'account_signature'=>$body['signature'],
                'result_json'=>json_encode($result,JSON_THROW_ON_ERROR),
                'created_at'=>now(),
            ]);
            return $this->identity->json($result,201);
        },3);
    }
}
