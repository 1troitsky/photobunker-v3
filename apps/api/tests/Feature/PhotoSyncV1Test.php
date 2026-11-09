<?php
declare(strict_types=1);
namespace Tests\Feature;
use App\Identity\Protocol as P;
use App\Photo\Lifecycle;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PhotoSyncV1Test extends TestCase {
    use RefreshDatabase;
    private $signing;
    private string $account;
    private string $device;
    protected function setUp():void {
        parent::setUp();
        Storage::fake('ciphertext');
        $this->signing=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
        $pem=openssl_pkey_get_details($this->signing)['key'];
        $spki=P::encode(base64_decode(preg_replace('/-----[^-]+-----|\s+/','',$pem)));
        $this->account=(string)Str::uuid();$this->device=(string)Str::uuid();
        DB::table('identity_accounts')->insert([
            'id'=>$this->account,'operation_id'=>(string)Str::uuid(),'prepare_hash'=>str_repeat('a',64),
            'status'=>'ready','reserved_until'=>now()->addDay(),'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$this->device,'account_id'=>$this->account,'signing_spki'=>$spki,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->withSession(['identity_account'=>$this->account,'identity_device'=>$this->device,
            'identity_issued'=>time()])->withHeader('Origin','https://localhost');
    }
    private function signature(string $text):string {
        openssl_sign($text,$der,$this->signing,OPENSSL_ALGO_SHA256);
        $i=2;$parts=[];
        foreach([0,1] as $_){
            if(ord($der[$i++])!==2)throw new \RuntimeException('bad test DER');
            $length=ord($der[$i++]);
            $part=substr($der,$i,$length);$i+=$length;
            $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return P::encode(implode('',$parts));
    }
    private function fixture(?int $expires=null):array {
        $photo=(string)Str::uuid();$operation=(string)Str::uuid();$assets=[];$content=[];
        $deadline=$expires??now()->addDay()->getTimestampMs();
        foreach(['master','metadata'] as $kind){
            $id=(string)Str::uuid();$bytes=random_bytes($kind==='master'?256:96);
            $content[$id]=$bytes;
            $manifest=[
                'version'=>1,'algorithm'=>'AES-256-GCM','chunkBytes'=>262144,
                'accountId'=>$this->account,'photoId'=>$photo,'assetId'=>$id,'kind'=>$kind,
                'revision'=>1,'expiresAt'=>$deadline,
                'plainBytes'=>strlen($bytes)-16,'cipherBytes'=>strlen($bytes),
                'frames'=>[['index'=>0,'offset'=>0,'bytes'=>strlen($bytes),'plainBytes'=>strlen($bytes)-16,
                    'iv'=>P::encode(random_bytes(12)),'digest'=>hash('sha256',$bytes)]],
                'cipherDigest'=>hash('sha256','test-vector'),'wrappedDEK'=>[
                    'iv'=>P::encode(random_bytes(12)),'ciphertext'=>P::encode(random_bytes(64))],
            ];
            $assets[]=['assetId'=>$id,'kind'=>$kind,'revision'=>1,
                'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes),'manifest'=>$manifest];
        }
        usort($assets,fn($a,$b)=>strcmp($a['assetId'],$b['assetId']));
        $c=['version'=>1,'photoId'=>$photo,'operationId'=>$operation,
            'expiresAt'=>$deadline,'assets'=>$assets];
        $json=json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['photo'=>$photo,'operation'=>$operation,'assets'=>$assets,'body'=>[
            'contract'=>$json,'signature'=>$this->signature("photobunker.photo-sync.v1\n".$json)],
            'content'=>$content];
    }
    private function reserve(array $f){return $this->postJson('/photos/v1/reserve',$f['body']);}
    private function upload(array $f):void {
        foreach($f['assets'] as $asset){
            $bytes=$f['content'][$asset['assetId']];
            $this->call('PUT','/photos/v1/'.$f['photo'].'/objects/'.$asset['assetId'],
                [],[],[],['HTTP_ORIGIN'=>'https://localhost','CONTENT_LENGTH'=>(string)strlen($bytes),
                'CONTENT_TYPE'=>'application/octet-stream'],$bytes)->assertOk();
        }
    }
    public function test_signed_reserve_upload_readback_finalize_replay_and_private_read():void {
        $f=$this->fixture();
        $this->reserve($f)->assertOk()->assertJsonPath('state','pending');
        $this->reserve($f)->assertOk()->assertJsonPath('state','pending');
        $this->upload($f);
        $url='/photos/v1/'.$f['photo'];
        $receipt=$this->postJson($url.'/finalize',['operationId'=>$f['operation']])
            ->assertOk()->json('receipt');
        $this->assertSame($f['photo'],$receipt['photoId']);
        $this->assertCount(2,$receipt['assets']);
        $this->assertSame($receipt,$this->postJson($url.'/finalize',
          ['operationId'=>$f['operation']])->assertOk()->json('receipt'));
        $this->reserve($f)->assertOk()->assertJsonPath('state','active');
        $first=$f['assets'][0];
        $this->get($url.'/objects/'.$first['assetId'])->assertOk()
            ->assertHeader('X-Cipher-SHA256',$first['sha256']);
        $this->withSession(['identity_account'=>null,'identity_device'=>null])
          ->get($url.'/receipt')->assertUnauthorized();
    }
    public function test_wrong_signature_conflict_and_bad_ciphertext_never_finalize():void {
        $f=$this->fixture();
        $bad=$f['body'];$bad['signature']=P::encode(random_bytes(64));
        $this->postJson('/photos/v1/reserve',$bad)->assertUnauthorized();
        $this->reserve($f)->assertOk();
        $mutated=$f['body'];$mutated['contract']=str_replace('"version":1','"version":2',$mutated['contract']);
        $this->postJson('/photos/v1/reserve',$mutated)->assertStatus(422);
        $asset=$f['assets'][0];
        $this->call('PUT','/photos/v1/'.$f['photo'].'/objects/'.$asset['assetId'],
          [],[],[],['HTTP_ORIGIN'=>'https://localhost','CONTENT_LENGTH'=>(string)$asset['bytes'],
          'CONTENT_TYPE'=>'application/octet-stream'],str_repeat('x',$asset['bytes']))->assertStatus(503);
        $this->postJson('/photos/v1/'.$f['photo'].'/finalize',
          ['operationId'=>$f['operation']])->assertStatus(409);
    }
    public function test_expiry_or_revoke_is_410_before_cleanup_and_never_recreates_photo():void {
        $f=$this->fixture();
        $this->reserve($f)->assertOk();$this->upload($f);
        $this->postJson('/photos/v1/'.$f['photo'].'/finalize',['operationId'=>$f['operation']])->assertOk();
        DB::table('photo_records')->where('id',$f['photo'])->update(['expires_at'=>now()->subMinute()->getTimestampMs()]);
        $this->getJson('/photos/v1/'.$f['photo'].'/receipt')->assertGone();
        $this->reserve($f)->assertGone(); // existing logical photo is already expired
        app(Lifecycle::class)->mark($f['photo']);
        app(Lifecycle::class)->cleanup($f['photo']);
        $this->assertDatabaseMissing('photo_records',['id'=>$f['photo']]);
        $this->assertDatabaseHas('photo_tombstones',['photo_id'=>$f['photo']]);
        $this->assertSame([],Storage::disk('ciphertext')->allFiles());
        $this->getJson('/photos/v1/'.$f['photo'].'/receipt')->assertGone();
    }
    public function test_expiry_during_partial_upload_rejects_remaining_put_and_finalize():void {
        $f=$this->fixture();
        $this->reserve($f)->assertOk();
        $first=$f['assets'][0];$second=$f['assets'][1];
        $send=function(array $asset)use($f) {
            $bytes=$f['content'][$asset['assetId']];
            return $this->call('PUT','/photos/v1/'.$f['photo'].'/objects/'.$asset['assetId'],
                [],[],[],['HTTP_ORIGIN'=>'https://localhost',
                    'CONTENT_LENGTH'=>(string)strlen($bytes),
                    'CONTENT_TYPE'=>'application/octet-stream'],$bytes);
        };
        $send($first)->assertOk();
        DB::table('photo_records')->where('id',$f['photo'])
            ->update(['expires_at'=>now()->subSecond()->getTimestampMs()]);
        $send($second)->assertGone();
        $this->postJson('/photos/v1/'.$f['photo'].'/finalize',
            ['operationId'=>$f['operation']])->assertGone();
        $this->getJson('/photos/v1/'.$f['photo'].'/receipt')->assertGone();
        $this->assertDatabaseHas('photo_records',['id'=>$f['photo'],'state'=>'pending']);
        $this->assertFalse(Storage::disk('ciphertext')->exists(
            DB::table('photo_objects')->where('id',$second['assetId'])->value('object_key')));
        app(Lifecycle::class)->mark($f['photo']);
        app(Lifecycle::class)->cleanup($f['photo']);
        $this->assertSame([],Storage::disk('ciphertext')->allFiles());
        $send($second)->assertGone();
        $this->reserve($f)->assertGone();
        $this->assertDatabaseMissing('photo_records',['id'=>$f['photo']]);
    }
    public function test_deletion_during_pending_upload_blocks_all_further_writes_and_receipts():void {
        $f=$this->fixture();
        $this->reserve($f)->assertOk();
        $first=$f['assets'][0];
        $bytes=$f['content'][$first['assetId']];
        app(Lifecycle::class)->mark($f['photo']);
        $this->call('PUT','/photos/v1/'.$f['photo'].'/objects/'.$first['assetId'],
            [],[],[],['HTTP_ORIGIN'=>'https://localhost',
                'CONTENT_LENGTH'=>(string)strlen($bytes),
                'CONTENT_TYPE'=>'application/octet-stream'],$bytes)->assertGone();
        $this->postJson('/photos/v1/'.$f['photo'].'/finalize',
            ['operationId'=>$f['operation']])->assertGone();
        $this->reserve($f)->assertGone();
        $this->assertSame([],Storage::disk('ciphertext')->allFiles());
    }

    public function test_failed_ciphertext_upload_can_retry_same_reservation_and_finalize_once():void {
        $f=$this->fixture();
        $this->reserve($f)->assertOk();
        $first=$f['assets'][0];
        $path='/photos/v1/'.$f['photo'].'/objects/'.$first['assetId'];
        $headers=['HTTP_ORIGIN'=>'https://localhost',
            'CONTENT_LENGTH'=>(string)$first['bytes'],
            'CONTENT_TYPE'=>'application/octet-stream'];
        // A fully written but invalid object is not a receipt. A subsequent
        // correct retry must replace it without a new operation or photo.
        $this->call('PUT',$path,[],[],[],$headers,str_repeat('x',$first['bytes']))
            ->assertStatus(503);
        $this->assertDatabaseHas('photo_objects',[
            'id'=>$first['assetId'],'state'=>'pending']);
        $this->postJson('/photos/v1/'.$f['photo'].'/finalize',
            ['operationId'=>$f['operation']])->assertConflict();
        $this->call('PUT',$path,[],[],[],$headers,$f['content'][$first['assetId']])
            ->assertOk();
        $this->call('PUT',$path,[],[],[],$headers,$f['content'][$first['assetId']])
            ->assertOk(); // Lost PUT ACK: idempotent verified retry.
        foreach($f['assets'] as $asset) {
            if($asset['assetId']===$first['assetId'])continue;
            $bytes=$f['content'][$asset['assetId']];
            $this->call('PUT','/photos/v1/'.$f['photo'].'/objects/'.$asset['assetId'],
                [],[],[],['HTTP_ORIGIN'=>'https://localhost',
                    'CONTENT_LENGTH'=>(string)strlen($bytes),
                    'CONTENT_TYPE'=>'application/octet-stream'],$bytes)->assertOk();
        }
        $url='/photos/v1/'.$f['photo'].'/finalize';
        $receipt=$this->postJson($url,['operationId'=>$f['operation']])->assertOk()->json('receipt');
        $this->assertSame($receipt,$this->postJson($url,
            ['operationId'=>$f['operation']])->assertOk()->json('receipt'));
        $this->assertDatabaseCount('photo_records',1);
        $this->assertDatabaseHas('photo_records',['id'=>$f['photo'],'state'=>'active']);
    }
    public function test_active_photo_is_not_readable_by_another_enrolled_account():void {
        $f=$this->fixture();
        $this->reserve($f)->assertOk();
        $this->upload($f);
        $this->postJson('/photos/v1/'.$f['photo'].'/finalize',
            ['operationId'=>$f['operation']])->assertOk();

        $otherAccount=(string)Str::uuid();$otherDevice=(string)Str::uuid();
        DB::table('identity_accounts')->insert([
            'id'=>$otherAccount,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('c',64),'status'=>'ready',
            'reserved_until'=>now()->addDay(),'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$otherDevice,'account_id'=>$otherAccount,
            'signing_spki'=>DB::table('identity_devices')->where('id',$this->device)->value('signing_spki'),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->withSession(['identity_account'=>$otherAccount,'identity_device'=>$otherDevice,
            'identity_issued'=>time()]);
        $this->getJson('/photos/v1/'.$f['photo'].'/receipt')->assertNotFound();
        $assetId=$f['assets'][0]['assetId'];
        $this->get('/photos/v1/'.$f['photo'].'/objects/'.$assetId)->assertNotFound();
    }
}
