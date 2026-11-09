<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
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
        }
        $this->getJson('/media/v1')->assertOk()
            ->assertJsonCount(3,'items');
        $this->assertDatabaseCount('media_files_v1',3);
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
