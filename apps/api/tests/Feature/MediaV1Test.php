<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use App\Media\MediaLifecycle;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class MediaV1Test extends TestCase
{
    use RefreshDatabase;

    private $signing;
    private string $account;
    private string $device;

    protected function setUp():void
    {
        parent::setUp();
        Storage::fake('ciphertext');
        $this->signing=openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,
            'curve_name'=>'prime256v1',
        ]);
        $pem=openssl_pkey_get_details($this->signing)['key'];
        $spki=P::encode(base64_decode(
            preg_replace('/-----[^-]+-----|\s+/','',$pem)));
        $this->account=(string)Str::uuid();
        $this->device=(string)Str::uuid();
        DB::table('identity_accounts')->insert([
            'id'=>$this->account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>now()->addDay(),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$this->device,'account_id'=>$this->account,
            'signing_spki'=>$spki,'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->withSession([
            'identity_account'=>$this->account,'identity_device'=>$this->device,
            'identity_issued'=>time(),
        ])->withHeader('Origin','https://localhost');
    }

    private function signature(string $text):string
    {
        openssl_sign("pb3.media.v1\n".$text,$der,$this->signing,OPENSSL_ALGO_SHA256);
        $offset=2;$parts=[];
        for($i=0;$i<2;$i++){
            $this->assertSame(2,ord($der[$offset++]));
            $len=ord($der[$offset++]);
            $parts[]=str_pad(ltrim(substr($der,$offset,$len),"\0"),
                32,"\0",STR_PAD_LEFT);
            $offset+=$len;
        }
        return P::encode(implode('',$parts));
    }

    private function fixture(string $type='video',int $bytes=1048737):array
    {
        $mediaId=(string)Str::uuid();
        $expires=now()->addDays(12)->getTimestampMs();
        $chunks=[];$ciphertext=[];
        $count=(int)ceil($bytes/1048576);
        for($index=0;$index<=$count;$index++){
            $isMeta=$index===$count;
            $plain=$isMeta?84:min(1048576,$bytes-$index*1048576);
            $encrypted=random_bytes($plain+16);
            $chunkId=(string)Str::uuid();
            $chunks[]=[
                'chunkId'=>$chunkId,'index'=>$index,
                'kind'=>$isMeta?'metadata':'data',
                'plainBytes'=>$plain,'bytes'=>$plain+16,
                'sha256'=>hash('sha256',$encrypted),
                'iv'=>P::encode(random_bytes(12)),
            ];
            $ciphertext[$chunkId]=$encrypted;
        }
        $contract=[
            'version'=>1,'accountId'=>$this->account,
            'mediaId'=>$mediaId,'operationId'=>(string)Str::uuid(),
            'mediaType'=>$type,'expiresAt'=>$expires,
            'chunkBytes'=>1048576,'plainBytes'=>$bytes,
            'wrappedDEK'=>[
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
            'chunks'=>$chunks,
        ];
        $json=json_encode($contract,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return [
            'contract'=>$contract,'json'=>$json,
            'signature'=>$this->signature($json),'chunks'=>$ciphertext,
        ];
    }

    private function send(array $f,int $index):\Illuminate\Testing\TestResponse
    {
        $chunk=$f['contract']['chunks'][$index];
        $binary=$f['chunks'][$chunk['chunkId']];
        return $this->call('PUT','/media/v1/'.$f['contract']['mediaId'].
            '/chunks/'.$chunk['chunkId'],[],[],[],[
                'HTTP_ORIGIN'=>'https://localhost',
                'CONTENT_LENGTH'=>(string)strlen($binary),
                'CONTENT_TYPE'=>'application/octet-stream',
            ],$binary);
    }

    public function test_three_media_types_are_signed_resumable_and_owner_only():void
    {
        foreach(['photo','video','audio'] as $i=>$type){
            $f=$this->fixture($type,1048737+$i);
            $c=$f['contract'];$base='/media/v1/'.$c['mediaId'];
            $body=['contract'=>$f['json'],'signature'=>$f['signature']];
            $this->postJson('/media/v1/reserve',$body)
                ->assertCreated()->assertJsonPath('state','pending');
            $this->postJson('/media/v1/reserve',$body)
                ->assertOk()->assertJsonPath('state','pending');
            $this->postJson($base.'/finalize',[
                'operationId'=>$c['operationId'],
            ])->assertConflict();
            foreach($c['chunks'] as $k=>$chunk){
                $this->send($f,$k)->assertOk()
                    ->assertJsonPath('verified',true);
                $this->send($f,$k)->assertOk()
                    ->assertJsonPath('chunkId',$chunk['chunkId']);
            }
            $receipt=$this->postJson($base.'/finalize',[
                'operationId'=>$c['operationId'],
            ])->assertOk()->json('receipt');
            $this->assertSame($c['mediaId'],$receipt['mediaId']);
            $this->assertCount(count($c['chunks']),$receipt['chunks']);
            $this->assertSame($receipt,$this->postJson($base.'/finalize',[
                'operationId'=>$c['operationId'],
            ])->assertOk()->json('receipt'));
            $this->postJson('/media/v1/reserve',$body)
                ->assertOk()->assertJsonPath('state','active');
            $this->getJson($base.'/manifests')
                ->assertOk()->assertJsonPath('contract',$f['json'])
                ->assertJsonPath('receipt.receiptHash',$receipt['receiptHash']);
            $first=$c['chunks'][0];
            $this->get($base.'/chunks/'.$first['chunkId'])
                ->assertOk()->assertHeader('X-Cipher-SHA256',$first['sha256']);
            $this->assertDatabaseHas('media_files_v1',[
                'id'=>$c['mediaId'],'state'=>'active',
                'account_id'=>$this->account,'media_type'=>$type,
            ]);
            // The real verified finalize, not a synthetic producer fixture,
            // must atomically publish exactly one event even on lost ACK replay.
            $this->assertDatabaseHas('notification_event_ledger_v1',[
                'account_id'=>$this->account,
                'subject_type'=>'media',
                'subject_id'=>$c['mediaId'],
                'revision'=>1,
                'admission_state'=>'sequenced',
            ]);
            $this->assertSame($i+1,DB::table('notification_event_ledger_v1')
                ->where('account_id',$this->account)->count());
        }
        $this->getJson('/media/v1')->assertOk()
            ->assertJsonCount(3,'items');
        $this->assertDatabaseCount('media_files_v1',3);
        $this->getJson('/notifications/v1/events')->assertOk()
            ->assertJsonCount(3,'items')
            ->assertJsonPath('items.0.kind','new-file')
            ->assertJsonPath('nextCursor','3');

        // Target navigation is never authorized by a cached targetId alone:
        // server re-evaluates CURRENT media ownership/state/expiry on click.
        $event=DB::table('notification_event_ledger_v1')
            ->where('account_id',$this->account)
            ->where('subject_type','media')
            ->orderBy('delivery_sequence')->first();
        $this->assertNotNull($event);
        $path='/notifications/v1/events/'.$event->event_id.'/target';
        $this->getJson($path)->assertOk()
            ->assertJsonPath('schemaVersion',1)
            ->assertJsonPath('kind','new-file')
            ->assertJsonPath('targetId',$event->subject_id);
        $this->getJson('/notifications/v1/events/'.Str::uuid().'/target')
            ->assertNotFound();
        DB::table('media_files_v1')->where('id',$event->subject_id)
            ->update(['state'=>'deleting']);
        $this->getJson($path)->assertNotFound();
        // A retained local event must not resurrect revoked/deleting content.
        DB::table('media_files_v1')->where('id',$event->subject_id)
            ->update(['state'=>'active','expires_at'=>now()->subSecond()->getTimestampMs()]);
        $this->getJson($path)->assertNotFound();
    }

    public function test_media_activation_rolls_back_when_atomic_event_admission_conflicts():void
    {
        $f=$this->fixture('photo',2048);
        $c=$f['contract'];
        $id=$c['mediaId'];
        $this->postJson('/media/v1/reserve',[
            'contract'=>$f['json'],'signature'=>$f['signature'],
        ])->assertCreated();
        foreach(array_keys($c['chunks']) as $index) {
            $this->send($f,$index)->assertOk();
        }

        // Inject a competing revision in the disposable test database.
        // A mismatched second revision=1 cannot be silently ACKed as
        // MediaCommitted; the entire media activation must roll back.
        $event=[
            'schemaVersion'=>1,
            'eventId'=>(string)Str::uuid(),
            'eventType'=>'MediaCommitted',
            'accountId'=>$this->account,
            'subjectType'=>'media',
            'subjectId'=>$id,
            'occurredAtMs'=>now()->getTimestampMs(),
            'revision'=>1,
        ];
        $this->assertSame(\App\Events\EventAdmission::Accepted,
            (new \App\Events\EventConsumer(
                new \App\Events\DatabaseEventInboxLedger()
            ))->ingest($event,$this->account));

        $this->postJson('/media/v1/'.$id.'/finalize',[
            'operationId'=>$c['operationId'],
        ])->assertStatus(503);
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$id,'state'=>'pending','receipt'=>null,
        ]);
        $this->assertSame(0,DB::table('media_chunks_v1')
            ->where('media_id',$id)->where('state','active')->count());
        $this->assertDatabaseCount('notification_event_ledger_v1',1);
    }

    public function test_fresh_chunk_upload_lease_is_retryable_and_stale_lease_resumes():void
    {
        // One data + one metadata chunk: finalize must prove BOTH, no skip.
        $f=$this->fixture('video',2048);
        $c=$f['contract'];$id=$c['mediaId'];
        $this->postJson('/media/v1/reserve',[
            'contract'=>$f['json'],'signature'=>$f['signature'],
        ])->assertCreated();
        $chunkId=$c['chunks'][0]['chunkId'];
        DB::table('media_chunks_v1')->where('id',$chunkId)
            ->update(['state'=>'uploading','updated_at'=>now()]);
        // The encrypted IndexedDB outbox retries HTTP 503. The historical
        // 409 permanently quarantined a recoverable upload lease.
        $this->send($f,0)->assertStatus(503)->assertHeader('Retry-After','5');
        $this->assertDatabaseHas('media_chunks_v1',[
            'id'=>$chunkId,'state'=>'uploading',
        ]);
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$id,'state'=>'pending','receipt'=>null,
        ]);
        DB::table('media_chunks_v1')->where('id',$chunkId)
            ->update(['updated_at'=>now()->subMinutes(3)]);
        // A restart can safely reupload the same immutable ciphertext.
        $this->send($f,0)->assertOk()->assertJsonPath('verified',true);
        $this->send($f,0)->assertOk()->assertJsonPath('verified',true);
        $this->send($f,1)->assertOk();
        $receipt=$this->postJson('/media/v1/'.$id.'/finalize',[
            'operationId'=>$c['operationId'],
        ])->assertOk()->json('receipt');
        $this->assertSame($id,$receipt['mediaId']);
        $this->assertSame($receipt,$this->postJson('/media/v1/'.$id.'/finalize',[
            'operationId'=>$c['operationId'],
        ])->assertOk()->json('receipt'));
    }

    public function test_truncated_encrypted_chunk_does_not_ack_and_recovers_exact_bytes():void
    {
        $f=$this->fixture('audio',1048737);
        $c=$f['contract'];$id=$c['mediaId'];
        $this->postJson('/media/v1/reserve',[
            'contract'=>$f['json'],'signature'=>$f['signature'],
        ])->assertCreated();
        $part=$c['chunks'][0];
        $binary=$f['chunks'][$part['chunkId']];
        $partial=substr($binary,0,strlen($binary)-9);
        // Advertise full expected size but deliver incomplete ciphertext.
        $this->call('PUT','/media/v1/'.$id.'/chunks/'.$part['chunkId'],
            [],[],[],[
                'HTTP_ORIGIN'=>'https://localhost',
                'CONTENT_LENGTH'=>(string)$part['bytes'],
                'CONTENT_TYPE'=>'application/octet-stream',
            ],$partial)->assertStatus(503);
        $this->assertDatabaseHas('media_chunks_v1',[
            'id'=>$part['chunkId'],'state'=>'pending',
        ]);
        $this->postJson('/media/v1/'.$id.'/finalize',[
            'operationId'=>$c['operationId'],
        ])->assertConflict();
        // Client retains the original AES-GCM chunk and retransmits it after
        // S3 recovers; no new key, chunk UUID or server-forged ACK.
        foreach(array_keys($c['chunks']) as $index)
            $this->send($f,$index)->assertOk()
                ->assertJsonPath('verified',true);
        $receipt=$this->postJson('/media/v1/'.$id.'/finalize',[
            'operationId'=>$c['operationId'],
        ])->assertOk()->json('receipt');
        $this->assertSame($part['sha256'],$receipt['chunks'][0]['sha256']);
        // Streamed binary ciphertext must be checked as BYTES, never via
        // HTML/text assertions that mis-handle streams or dump ciphertext.
        $readback=$this->get('/media/v1/'.$id.'/chunks/'.$part['chunkId'])
            ->assertOk()->assertHeader('X-Cipher-SHA256',$part['sha256'])
            ->streamedContent();
        $this->assertSame(strlen($binary),strlen($readback));
        $this->assertSame($part['sha256'],hash('sha256',$readback));
    }

    public function test_out_of_order_media_chunks_and_lost_ack_replay_are_idempotent():void
    {
        $f=$this->fixture('photo',2048);
        $c=$f['contract'];$id=$c['mediaId'];
        $this->postJson('/media/v1/reserve',[
            'contract'=>$f['json'],'signature'=>$f['signature'],
        ])->assertCreated();
        // Independent signed chunk objects may arrive out of index order.
        $this->send($f,1)->assertOk()->assertJsonPath('verified',true);
        $this->postJson('/media/v1/'.$id.'/finalize',[
            'operationId'=>$c['operationId'],
        ])->assertConflict();
        $this->send($f,1)->assertOk()->assertJsonPath('verified',true);
        $this->send($f,0)->assertOk()->assertJsonPath('verified',true);
        // Lost HTTP ACK after the full S3 PUT: retry the same signed PUT.
        $this->send($f,0)->assertOk()->assertJsonPath('verified',true);
        $r=$this->postJson('/media/v1/'.$id.'/finalize',[
            'operationId'=>$c['operationId'],
        ])->assertOk()->json('receipt');
        $this->assertSame($r,$this->postJson('/media/v1/'.$id.'/finalize',[
            'operationId'=>$c['operationId'],
        ])->assertOk()->json('receipt'));
        $this->assertDatabaseHas('media_files_v1',['id'=>$id,'state'=>'active']);
        $this->assertDatabaseCount('media_chunk_locations_v1',2);
    }

    public function test_bad_signatures_mismatched_chunks_or_storage_cannot_finalize():void
    {
        $f=$this->fixture('video',1049000);
        $body=['contract'=>$f['json'],'signature'=>$f['signature']];
        $this->postJson('/media/v1/reserve',[
            'contract'=>$f['json'],'signature'=>P::encode(random_bytes(64)),
        ])->assertUnauthorized();
        $bad=$f['contract'];
        $bad['chunks'][0]['bytes']++;
        $changed=json_encode($bad,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $this->postJson('/media/v1/reserve',[
            'contract'=>$changed,'signature'=>$this->signature($changed),
        ])->assertUnprocessable();
        $this->postJson('/media/v1/reserve',$body)->assertCreated();
        $first=$f['contract']['chunks'][0];
        $this->call('PUT','/media/v1/'.$f['contract']['mediaId'].
            '/chunks/'.$first['chunkId'],[],[],[],[
                'HTTP_ORIGIN'=>'https://localhost',
                'CONTENT_LENGTH'=>(string)$first['bytes'],
                'CONTENT_TYPE'=>'application/octet-stream',
            ],str_repeat('z',$first['bytes']))->assertStatus(503);
        $this->assertDatabaseHas('media_chunks_v1',[
            'id'=>$first['chunkId'],'state'=>'pending',
        ]);
        $this->send($f,0)->assertOk();
        $this->postJson('/media/v1/'.$f['contract']['mediaId'].'/finalize',[
            'operationId'=>$f['contract']['operationId'],
        ])->assertConflict();
        // A mismatched account cannot read signed metadata or encrypted chunks.
        $this->withSession(['identity_account'=>(string)Str::uuid(),
            'identity_device'=>(string)Str::uuid(),'identity_issued'=>time()]);
        $this->getJson('/media/v1/'.$f['contract']['mediaId'].'/manifests')
            ->assertUnauthorized();
    }

    public function test_gated_ttl_tombstones_survive_cleanup_and_resweep_late_s3_writes():void
    {
        $f=$this->fixture('audio',1024);
        $c=$f['contract'];$id=$c['mediaId'];
        $this->postJson('/media/v1/reserve',[
            'contract'=>$f['json'],'signature'=>$f['signature'],
        ])->assertCreated();
        foreach($c['chunks'] as $index=>$_)$this->send($f,$index)->assertOk();
        $this->postJson('/media/v1/'.$id.'/finalize',[
            'operationId'=>$c['operationId'],
        ])->assertOk();
        // A disabled destructive scheduler must not delete existing media.
        config()->set('media_sync.cleanup_enabled',false);
        $this->artisan('pb3:media-maintain')->assertExitCode(1);
        $this->assertDatabaseHas('media_files_v1',['id'=>$id,'state'=>'active']);

        DB::table('media_files_v1')->where('id',$id)->update([
            'expires_at'=>now()->subMinute()->getTimestampMs(),
        ]);
        $lifecycle=app(MediaLifecycle::class);
        $lifecycle->mark($id);
        $lifecycle->mark($id); // one permanent tombstone only
        $this->assertDatabaseCount('media_tombstones_v1',1);
        $this->assertDatabaseHas('media_files_v1',['id'=>$id,'state'=>'deleting']);
        $keys=DB::table('media_chunk_locations_v1')
            ->orderBy('object_key')->pluck('object_key')->all();
        $this->assertCount(2,$keys);
        foreach($keys as $key)$this->assertTrue(Storage::disk('ciphertext')->exists($key));

        $lifecycle->cleanup($id);
        $lifecycle->cleanup($id);
        $this->assertDatabaseCount('media_files_v1',0);
        $this->assertDatabaseCount('media_chunks_v1',0);
        $this->assertDatabaseCount('media_chunk_locations_v1',0);
        $this->assertDatabaseCount('media_tombstones_v1',1);
        $this->assertSame([],Storage::disk('ciphertext')->allFiles());
        $this->postJson('/media/v1/reserve',[
            'contract'=>$f['json'],'signature'=>$f['signature'],
        ])->assertGone();
        $this->getJson('/media/v1/'.$id.'/manifests')->assertGone();

        // A late S3 write after deletion is never allowed to resurrect data.
        Storage::disk('ciphertext')->put($keys[0],random_bytes(512));
        DB::table('media_tombstones_v1')->where('media_id',$id)
            ->update(['next_sweep_at'=>now()->subSecond()]);
        $this->assertSame(1,$lifecycle->sweepTombstones(10));
        $this->assertFalse(Storage::disk('ciphertext')->exists($keys[0]));
        $this->assertDatabaseCount('media_tombstones_v1',1);
    }

    public function test_stalled_media_chunk_is_reconciled_without_deleting_valid_ciphertext():void
    {
        $f=$this->fixture('photo',1024);
        $c=$f['contract'];
        $this->postJson('/media/v1/reserve',[
            'contract'=>$f['json'],'signature'=>$f['signature'],
        ])->assertCreated();
        $first=$c['chunks'][0];$second=$c['chunks'][1];
        $key=DB::table('media_chunk_locations_v1')
            ->where('chunk_id',$first['chunkId'])->value('object_key');
        Storage::disk('ciphertext')->put($key,$f['chunks'][$first['chunkId']]);
        DB::table('media_chunks_v1')->where('id',$first['chunkId'])
            ->update(['state'=>'uploading','updated_at'=>now()->subDays(2)]);
        DB::table('media_chunks_v1')->where('id',$second['chunkId'])
            ->update(['state'=>'uploading','updated_at'=>now()->subDays(2)]);
        $lifecycle=app(MediaLifecycle::class);
        $result=$lifecycle->reconcileStalledChunks(10);
        $this->assertSame(1,$result['verified']);
        $this->assertSame(1,$result['reset']);
        $this->assertSame(0,$result['errors']);
        $this->assertDatabaseHas('media_chunks_v1',[
            'id'=>$first['chunkId'],'state'=>'verified',
        ]);
        $this->assertDatabaseHas('media_chunks_v1',[
            'id'=>$second['chunkId'],'state'=>'pending',
        ]);
        $this->assertTrue(Storage::disk('ciphertext')->exists($key));
    }

    public function test_shared_free_file_quota_and_expired_reservations_fail_closed():void
    {
        config()->set('photo_sync.bootstrap_free_file_cap',1);
        $f=$this->fixture('audio',1024);
        $this->postJson('/media/v1/reserve',[
            'contract'=>$f['json'],'signature'=>$f['signature'],
        ])->assertCreated();
        $other=$this->fixture('video',2048);
        $this->postJson('/media/v1/reserve',[
            'contract'=>$other['json'],'signature'=>$other['signature'],
        ])->assertStatus(413);
        $id=$f['contract']['mediaId'];
        DB::table('media_files_v1')->where('id',$id)
            ->update(['expires_at'=>now()->subSecond()->getTimestampMs()]);
        $this->send($f,0)->assertGone();
        $this->getJson('/media/v1/'.$id.'/manifests')->assertGone();
        $this->postJson('/media/v1/'.$id.'/finalize',[
            'operationId'=>$f['contract']['operationId'],
        ])->assertGone();
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$id,'state'=>'pending',
        ]);
    }
}
