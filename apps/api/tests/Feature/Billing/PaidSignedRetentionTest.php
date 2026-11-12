<?php
declare(strict_types=1);

namespace Tests\Feature\Billing;

use App\Billing\EntitlementLedger;
use App\Billing\RetentionAdmission;
use App\Identity\Protocol as P;
use App\Media\MediaContract;
use App\Photo\PhotoSync;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * #281: genuine P-256 signed HTTP Photo and Media reserve, with verified
 * account-scoped immutable entitlement. NO real settlement/S3 ciphertext.
 */
final class PaidSignedRetentionTest extends TestCase
{
    use RefreshDatabase;

    private $signing;
    private string $account;
    private string $device;
    private string $spki;

    protected function setUp():void
    {
        parent::setUp();
        $this->travelTo(now()->startOfSecond());
        $this->signing=openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,
            'curve_name'=>'prime256v1',
        ]);
        $details=openssl_pkey_get_details($this->signing);
        $this->spki=P::encode(base64_decode(
            preg_replace('/-----[^-]+-----|\s+/','',$details['key'])));
        $this->account=(string)Str::uuid();
        $this->device=(string)Str::uuid();
        DB::table('identity_accounts')->insert([
            'id'=>$this->account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>now()->addDays(120),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$this->device,'account_id'=>$this->account,
            'signing_spki'=>$this->spki,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->withSession([
            'identity_account'=>$this->account,'identity_device'=>$this->device,
            'identity_issued'=>time(),
        ])->withHeader('Origin','https://localhost');
    }

    private function sign(string $domain,string $json):string
    {
        openssl_sign($domain."\n".$json,$der,$this->signing,OPENSSL_ALGO_SHA256);
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

    private function paid(string $plan):void
    {
        $ledger=app(EntitlementLedger::class);
        $ledger->current($this->account);
        $ledger->advanceTrusted(
            $this->account,$plan,1,
            hash('sha256','p1-281-fixture-verified:'.$this->account.':'.$plan),
            'settlement_verified',
            CarbonImmutable::now('UTC')->subMinutes(2)->startOfSecond(),
            CarbonImmutable::now('UTC')->addDay()->startOfSecond(),
        );
    }

    /** Signed Photo v1 with exact matching immutable per-asset expiries. */
    private function photo(int $expires):array
    {
        $id=(string)Str::uuid();$assets=[];
        foreach(['master','metadata'] as $kind){
            $asset=(string)Str::uuid();
            $bytes=$kind==='master'?256:96;
            $plain=$bytes-16;
            $manifest=[
                'version'=>1,'algorithm'=>'AES-256-GCM','chunkBytes'=>262144,
                'accountId'=>$this->account,'photoId'=>$id,
                'assetId'=>$asset,'kind'=>$kind,'revision'=>1,
                'expiresAt'=>$expires,'plainBytes'=>$plain,'cipherBytes'=>$bytes,
                'frames'=>[[
                    'index'=>0,'offset'=>0,'bytes'=>$bytes,'plainBytes'=>$plain,
                    'iv'=>P::encode(random_bytes(12)),
                    'digest'=>hash('sha256','p1-281-synthetic-cipher-'.$asset),
                ]],
                'cipherDigest'=>hash('sha256','p1-281-synthetic-'.$asset),
                'wrappedDEK'=>[
                    'iv'=>P::encode(random_bytes(12)),
                    'ciphertext'=>P::encode(random_bytes(64)),
                ],
            ];
            $assets[]=[
                'assetId'=>$asset,'kind'=>$kind,'revision'=>1,'bytes'=>$bytes,
                'sha256'=>hash('sha256','synthetic-asset-'.$asset),
                'manifest'=>$manifest,
            ];
        }
        usort($assets,fn($a,$b)=>strcmp($a['assetId'],$b['assetId']));
        $c=['version'=>1,'photoId'=>$id,'operationId'=>(string)Str::uuid(),
            'expiresAt'=>$expires,'assets'=>$assets];
        $json=json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['id'=>$id,'expires'=>$expires,'json'=>$json,
            'body'=>['contract'=>$json,
                'signature'=>$this->sign('photobunker.photo-sync.v1',$json)]];
    }

    /** Signed Media v1 with one ciphertext chunk and encrypted metadata. */
    private function media(int $expires):array
    {
        $id=(string)Str::uuid();
        $chunks=[];
        foreach([128,84] as $i=>$plain){
            $chunkId=(string)Str::uuid();
            $chunks[]=[
                'chunkId'=>$chunkId,'index'=>$i,
                'kind'=>$i===0?'data':'metadata',
                'plainBytes'=>$plain,'bytes'=>$plain+16,
                'sha256'=>hash('sha256','p1-281-synthetic-chunk-'.$chunkId),
                'iv'=>P::encode(random_bytes(12)),
            ];
        }
        $c=[
            'version'=>1,'accountId'=>$this->account,
            'mediaId'=>$id,'operationId'=>(string)Str::uuid(),
            'mediaType'=>'video','expiresAt'=>$expires,
            'chunkBytes'=>1048576,'plainBytes'=>128,
            'wrappedDEK'=>[
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
            'chunks'=>$chunks,
        ];
        $json=json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['id'=>$id,'expires'=>$expires,'json'=>$json,
            'body'=>['contract'=>$json,
                'signature'=>$this->sign('pb3.media.v1',$json)]];
    }

    private function reserve(string $type,array $f):\Illuminate\Testing\TestResponse
    {
        return $this->postJson($type==='photo'
            ?'/photos/v1/reserve':'/media/v1/reserve',$f['body']);
    }

    private function expiry(int $days,int $extraMs=0):int
    {
        return now()->getTimestampMs()+$days*86400000+$extraMs;
    }

    public function test_new_signed_photo_and_media_enforce_exact_free_go_pro_days():void
    {
        $matrix=[
            ['free',14],['go',30],['pro',90],
        ];
        foreach($matrix as [$plan,$days]){
            // Each account is a separate case; do not mutate paid events
            // of an already tested identity.
            if($plan!=='free')$this->paid($plan);
            $now=$this->expiry($days);
            $p=$this->photo($now);$m=$this->media($now);
            $this->reserve('photo',$p)->assertOk()
                ->assertJsonPath('expiresAt',$now);
            $this->reserve('media',$m)->assertCreated()
                ->assertJsonPath('expiresAt',$now);
            $this->assertDatabaseHas('photo_records',[
                'id'=>$p['id'],'account_id'=>$this->account,'expires_at'=>$now,
            ]);
            $this->assertDatabaseHas('media_files_v1',[
                'id'=>$m['id'],'account_id'=>$this->account,'expires_at'=>$now,
            ]);
            $tooLate=$this->expiry($days,1);
            $this->reserve('photo',$this->photo($tooLate))->assertUnprocessable();
            $this->reserve('media',$this->media($tooLate))->assertUnprocessable();
            $this->assertSame($plan,app(RetentionAdmission::class)
                ->assertNew($this->account,$this->expiry(1))['effectivePlanId']);
            $this->assertSame($days,app(RetentionAdmission::class)
                ->assertNew($this->account,$this->expiry(1))['maxDays']);
            $this->assertSame(1,DB::table('photo_records')
                ->where('account_id',$this->account)->count());
            $this->assertSame(1,DB::table('media_files_v1')
                ->where('account_id',$this->account)->count());
            // Keep older accounts/rows intact and switch current identity.
            if($plan!=='pro')$this->freshAccount();
        }
    }

    private function freshAccount():void
    {
        // Preserve the prior account's records and verify isolation.
        $this->account=(string)Str::uuid();
        $this->device=(string)Str::uuid();
        DB::table('identity_accounts')->insert([
            'id'=>$this->account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>now()->addDays(120),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$this->device,'account_id'=>$this->account,
            'signing_spki'=>$this->spki,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->withSession([
            'identity_account'=>$this->account,'identity_device'=>$this->device,
            'identity_issued'=>time(),
        ])->withHeader('Origin','https://localhost');
    }

    public function test_unlimited_variants_fail_closed_to_14_days_until_approved_renewal():void
    {
        foreach(['unlimited','unlimited_plus'] as $i=>$plan){
            if($i>0)$this->freshAccount();
            $this->paid($plan);
            $bound=app(RetentionAdmission::class)->assertNew(
                $this->account,$this->expiry(14));
            $this->assertSame('unlimited_unresolved_technical_guard',$bound['source']);
            $this->assertSame(14,$bound['maxDays']);
            $this->reserve('photo',$this->photo($this->expiry(14)))
                ->assertOk();
            $this->reserve('media',$this->media($this->expiry(15)))
                ->assertUnprocessable();
        }
    }

    public function test_paid_grace_does_not_retroactively_erase_signed_expiry_or_lost_ack_replay():void
    {
        $this->paid('go');
        $valid=$this->expiry(26);
        $photo=$this->photo($valid);$media=$this->media($valid);
        $this->reserve('photo',$photo)->assertOk();
        $this->reserve('media',$media)->assertCreated();
        $this->assertDatabaseHas('photo_records',['id'=>$photo['id'],'expires_at'=>$valid]);
        $this->assertDatabaseHas('media_files_v1',['id'=>$media['id'],'expires_at'=>$valid]);
        // The paid snapshot ends after one day. New writes fall back Free,
        // but old signed pending reservations stay available for lost ACKs.
        $this->travel(2)->days();
        $this->assertSame('free',app(EntitlementLedger::class)
            ->current($this->account)['effectivePlanId']);
        $this->reserve('photo',$photo)->assertOk()
            ->assertJsonPath('expiresAt',$valid);
        $this->reserve('media',$media)->assertOk()
            ->assertJsonPath('expiresAt',$valid);
        $this->reserve('photo',$this->photo($this->expiry(26)))
            ->assertUnprocessable();
        $this->reserve('media',$this->media($this->expiry(26)))
            ->assertUnprocessable();
        $this->assertDatabaseCount('photo_records',1);
        $this->assertDatabaseCount('media_files_v1',1);
        $this->assertDatabaseHas('photo_records',['id'=>$photo['id'],'expires_at'=>$valid]);
        $this->assertDatabaseHas('media_files_v1',['id'=>$media['id'],'expires_at'=>$valid]);
    }

    public function test_signed_media_and_photo_reject_tampering_and_cross_account_grants():void
    {
        $this->paid('go');
        $p=$this->photo($this->expiry(25));
        $m=$this->media($this->expiry(25));
        $bad=$p;$badJson=json_decode($p['json'],true,32,JSON_THROW_ON_ERROR);
        $badJson['expiresAt']=$this->expiry(27);
        foreach($badJson['assets'] as &$asset){
            $asset['manifest']['expiresAt']=$badJson['expiresAt'];
        }
        unset($asset);
        $bad['body']['contract']=json_encode($badJson,
            JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $this->reserve('photo',$bad)->assertUnauthorized();
        $bad=$m;$badJson=json_decode($m['json'],true,32,JSON_THROW_ON_ERROR);
        $badJson['expiresAt']=$this->expiry(27);
        $bad['body']['contract']=json_encode($badJson,
            JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $this->reserve('media',$bad)->assertUnauthorized();

        $this->freshAccount(); // same signing key, different account and device
        $this->reserve('photo',$p)->assertForbidden();
        $this->reserve('media',$m)->assertUnprocessable();
        $this->assertDatabaseCount('photo_records',0);
        $this->assertDatabaseCount('media_files_v1',0);
    }

    public function test_direct_legacy_signature_validators_remain_free_bounded():void
    {
        $this->paid('go');
        $expires=$this->expiry(25);
        $p=$this->photo($expires);$m=$this->media($expires);
        foreach([
            fn()=>app(PhotoSync::class)->validate(
                $p['json'],$p['body']['signature'],$this->spki),
            fn()=>MediaContract::verify($m['json'],$m['body']['signature'],
                $this->spki,$this->account),
        ] as $check){
            try{$check();$this->fail('Legacy standalone parser bypassed Free cap');}
            catch(HttpException $e){$this->assertSame(422,$e->getStatusCode());}
        }
        $this->reserve('photo',$p)->assertOk();
        $this->reserve('media',$m)->assertCreated();
    }
}
