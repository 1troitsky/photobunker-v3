<?php
declare(strict_types=1);

namespace Tests\Feature\Billing;

use App\Billing\EntitlementLedger;
use App\Billing\QuotaAdmission;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * #192: actual account-locked and cross-protocol quota admission.
 * No payment endpoint or false verified invoice. Approved DECIMAL_GB_TB_V1
 * quotas must not mutate the historical OPEN_GB_VS_GIB snapshots.
 */
final class QuotaAdmissionTest extends TestCase
{
    use RefreshDatabase;

    /** @var array<string,string> */
    private array $devices=[];

    protected function tearDown():void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function account():string
    {
        $id=(string)Str::uuid();$device=(string)Str::uuid();
        DB::table('identity_accounts')->insert([
            'id'=>$id,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>now()->addDays(10),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$id,
            'signing_spki'=>'unit-fixture-only',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->devices[$id]=$device;
        return $id;
    }

    private function photo(string $account,int $bytes=0,string $state='pending',
        ?int $expires=null):string
    {
        $id=(string)Str::uuid();
        DB::table('photo_records')->insert([
            'id'=>$id,'account_id'=>$account,
            'device_id'=>$this->devices[$account],
            'operation_id'=>(string)Str::uuid(),
            'state'=>$state,
            'expires_at'=>$expires??now()->addDay()->getTimestampMs(),
            'contract_hash'=>str_repeat('a',64),
            'contract_json'=>'{}','signature'=>'synthetic',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        if($bytes>0){
            $asset=(string)Str::uuid();
            DB::table('photo_objects')->insert([
                'id'=>$asset,'photo_id'=>$id,'kind'=>'master',
                'revision'=>1,'bytes'=>$bytes,
                'sha256'=>str_repeat('b',64),'manifest_json'=>'{}',
                'object_key'=>'cipher/v1/'.$account.'/'.$id.'/'.$asset,
                'state'=>'pending','created_at'=>now(),'updated_at'=>now(),
            ]);
        }
        return $id;
    }

    private function media(string $account,int $bytes,string $state='pending',
        ?int $expires=null):string
    {
        $id=(string)Str::uuid();
        DB::table('media_files_v1')->insert([
            'id'=>$id,'account_id'=>$account,
            'device_id'=>$this->devices[$account],
            'operation_id'=>(string)Str::uuid(),
            'media_type'=>'video','state'=>$state,
            'expires_at'=>$expires??now()->addDay()->getTimestampMs(),
            'plain_bytes'=>max(128,$bytes-16),
            'cipher_bytes'=>$bytes,
            'contract_hash'=>str_repeat('a',64),'contract_json'=>'{}',
            'signature'=>'synthetic',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        return $id;
    }

    private function quota():QuotaAdmission
    {
        return app(QuotaAdmission::class);
    }

    private function expectStatus(int $code,callable $call):void
    {
        try{$call();$this->fail('quota admission unexpectedly succeeded');}
        catch(HttpException $e){$this->assertSame($code,$e->getStatusCode());}
    }

    private function paid(string $account,string $plan):void
    {
        $ledger=app(EntitlementLedger::class);
        $ledger->current($account);
        $start=CarbonImmutable::now('UTC')->subMinutes(2)->startOfSecond();
        $end=CarbonImmutable::now('UTC')->addDay()->startOfSecond();
        $ledger->advanceTrusted($account,$plan,1,
            hash('sha256','test-verified-settlement:'.$account.':'.$plan),
            'settlement_verified',$start,$end);
    }

    public function test_new_account_is_free_and_both_protocols_charge_same_pending_budget():void
    {
        $a=$this->account();
        $begin=$this->quota()->admit($a,256);
        $this->assertSame('free',$begin['planId']);
        $this->assertSame(1,$begin['revision']);
        $this->assertSame(50,$begin['fileLimit']);
        $this->assertSame(0,$begin['filesUsed']);
        $this->assertSame(1000000000,$begin['technicalByteGuard']);
        $this->assertSame(1000000000,$begin['enforcedByteCeiling']);
        $this->assertSame('DECIMAL_GB_TB_V1',$begin['byteUnitPolicy']);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1',1);

        $this->photo($a,240);
        $this->media($a,256);
        $check=$this->quota()->admit($a,128);
        $this->assertSame(2,$check['filesUsed']);
        $this->assertSame(496,$check['recordedCipherBytes']);
        // A pending reservation is charged ONCE. Repeated calls merely read
        // usage: they never allocate a second file or byte reservation.
        $this->assertSame($check,$this->quota()->admit($a,128));
        $this->assertDatabaseCount('photo_records',1);
        $this->assertDatabaseCount('media_files_v1',1);
    }

    public function test_real_free_file_and_legacy_byte_boundaries_fail_closed():void
    {
        $a=$this->account();
        for($i=0;$i<48;$i++)$this->photo($a);
        $this->media($a,250);
        $this->assertSame(49,$this->quota()->admit($a,1)['filesUsed']);
        $final=$this->photo($a);
        $this->expectStatus(413,fn()=>$this->quota()->admit($a,1));
        DB::table('photo_records')->where('id',$final)->update(['state'=>'deleting']);
        $this->assertSame(49,$this->quota()->admit($a,1)['filesUsed']);

        // Free decimal entitlement and the existing stricter operator
        // bootstrap guard remain 1,000,000,000 ciphertext bytes.
        $this->expectStatus(413,
            fn()=>$this->quota()->admit($a,1000000000));
        $allowed=$this->quota()->admit($a,999999750);
        $this->assertSame(250,$allowed['recordedCipherBytes']);
        $this->assertSame(1000000000,$allowed['technicalByteGuard']);
        $this->expectStatus(422,fn()=>$this->quota()->admit($a,0));
    }

    public function test_legacy_free_technical_file_cap_can_be_stricter_than_entitlement():void
    {
        $free=$this->account();
        config()->set('photo_sync.bootstrap_free_file_cap',1);
        $this->assertSame(1,$this->quota()->admit($free,256)['fileLimit']);
        $this->photo($free);
        $this->expectStatus(413,fn()=>$this->quota()->admit($free,256));
        // Product file count from verified active Go is 250, not the Free
        // technical 1-file bootstrap limit. Its decimal byte quota is 30e9.
        $paid=$this->account();
        $this->paid($paid,'go');
        $this->photo($paid);
        $this->assertSame(250,$this->quota()->admit($paid,256)['fileLimit']);
        $this->assertSame(1,$this->quota()->admit($paid,256)['filesUsed']);
        $this->assertSame(30000000000,
            $this->quota()->admit($paid,256)['enforcedByteCeiling']);
        $this->assertNull($this->quota()->admit($paid,256)['technicalByteGuard']);
    }

    public function test_all_five_paid_decimal_byte_ceilings_are_enforced_exactly():void
    {
        $limits=[
            'free'=>[50,1000000000],
            'go'=>[250,30000000000],
            'pro'=>[2000,200000000000],
            'unlimited'=>[null,500000000000],
            'unlimited_plus'=>[null,1000000000000],
        ];
        foreach($limits as $plan=>[$count,$ceiling]){
            $id=$this->account();
            if($plan!=='free')$this->paid($id,$plan);
            $r=$this->quota()->admit($id,500);
            $this->assertSame($plan,$r['planId']);
            $this->assertSame($count,$r['fileLimit']);
            $this->assertSame($plan==='free'?1:2,$r['revision']);
            $this->assertSame($ceiling,$r['enforcedByteCeiling']);
            $this->assertSame('DECIMAL_GB_TB_V1',$r['byteUnitPolicy']);
            $this->assertSame($plan==='free'?1000000000:null,
                $r['technicalByteGuard']);
            $this->assertSame(
                $plan==='free'?'plan_plus_free_technical_guard':'plan_entitlement',
                $r['quotaSource']);
            $this->assertSame($ceiling,$this->quota()->admit($id,$ceiling)
                ['enforcedByteCeiling']);
            $this->expectStatus(413,
                fn()=>$this->quota()->admit($id,$ceiling+1));
        }
    }

    public function test_approved_paid_bytes_account_for_both_signed_protocols_at_exact_boundary():void
    {
        $id=$this->account();$this->paid($id,'go');
        $this->photo($id,11000000000);
        $this->media($id,18999999744);
        $expected=29999999744;
        $state=$this->quota()->admit($id,256);
        $this->assertSame(2,$state['filesUsed']);
        $this->assertSame($expected,$state['recordedCipherBytes']);
        $this->assertSame(30000000000,$state['enforcedByteCeiling']);
        $this->expectStatus(413,fn()=>$this->quota()->admit($id,257));
        // Admission merely checks: no bytes are created or over-reserved
        // until the caller's signed /reserve transaction inserts its row.
        $this->assertDatabaseCount('media_files_v1',1);
        $this->assertDatabaseCount('photo_records',1);
    }

    public function test_unversioned_legacy_paid_bytes_stay_conservative_until_trusted_new_transition():void
    {
        $id=$this->account();
        $newCatalog=config('plans');
        config()->set('plans.catalog_version','pb3-2026-11-09');
        config()->set('plans.effective_at','2026-11-09T00:00:00Z');
        config()->set('plans.storage_unit_policy','OPEN_GB_VS_GIB');
        try{
            $this->paid($id,'go');
            $historical=app(EntitlementLedger::class)->current($id);
            $this->assertSame('OPEN_GB_VS_GIB',
                $historical['effectiveLimits']['storage']['unitPolicy']);
            $this->assertNull(
                $historical['effectiveLimits']['storage']['byteCeiling']);
            $storedHash=$historical['snapshotSha256'];
        }finally{
            config()->set('plans',$newCatalog);
        }

        $legacy=$this->quota()->admit($id,1000000000);
        $this->assertSame('go',$legacy['planId']);
        $this->assertSame('OPEN_GB_VS_GIB',$legacy['byteUnitPolicy']);
        $this->assertSame(1000000000,$legacy['enforcedByteCeiling']);
        $this->assertSame('legacy_technical_guard',$legacy['quotaSource']);
        $this->expectStatus(413,fn()=>$this->quota()->admit($id,1000000001));
        $this->assertSame($storedHash,app(EntitlementLedger::class)
            ->current($id)['snapshotSha256']);

        $start=CarbonImmutable::now('UTC')->subMinute()->startOfSecond();
        $end=CarbonImmutable::now('UTC')->addDays(3)->startOfSecond();
        app(EntitlementLedger::class)->advanceTrusted($id,'pro',2,
            hash('sha256','verified-new-policy-transition:'.$id),
            'admin_mfa_approved',$start,$end);
        $approved=$this->quota()->admit($id,30000000000);
        $this->assertSame('pro',$approved['planId']);
        $this->assertSame(200000000000,$approved['enforcedByteCeiling']);
        $this->assertSame('DECIMAL_GB_TB_V1',$approved['byteUnitPolicy']);
        $this->assertSame($storedHash,
            DB::table('billing_entitlement_snapshots_v1')
                ->where('account_id',$id)->where('revision',2)
                ->value('snapshot_hash'));
        $this->assertDatabaseHas('billing_entitlement_heads_v1',[
            'account_id'=>$id,'revision'=>3,
        ]);
    }

    public function test_paid_file_count_expands_to_250_and_grace_reverts_to_free_without_purging():void
    {
        $id=$this->account();
        $this->paid($id,'go');
        for($i=0;$i<50;$i++)$this->photo($id);
        // Paid-plan downgrade must not be mistaken for ordinary file expiry.
        DB::table('photo_records')->where('account_id',$id)
            ->update(['expires_at'=>now()->addDays(90)->getTimestampMs()]);
        $active=$this->quota()->admit($id,1);
        $this->assertSame('go',$active['planId']);
        $this->assertSame(250,$active['fileLimit']);
        $this->assertSame(50,$active['filesUsed']);
        // Same persisted 50 ciphertext records, later grace is Free cap 50.
        $end=DB::table('billing_entitlement_snapshots_v1')
            ->where('account_id',$id)->where('revision',2)->value('ends_at');
        CarbonImmutable::setTestNow(CarbonImmutable::parse($end,'UTC')->addDay());
        $this->expectStatus(413,fn()=>$this->quota()->admit($id,1));
        $this->assertDatabaseCount('photo_records',50);
        $this->assertSame('free',app(EntitlementLedger::class)
            ->current($id)['effectivePlanId']);
    }

    public function test_expired_and_deleting_files_do_not_hold_quota_and_other_account_is_isolated():void
    {
        $alice=$this->account();$bob=$this->account();
        $this->photo($alice,260,'deleting');
        $this->media($alice,250,'pending',now()->subDay()->getTimestampMs());
        $this->photo($bob,300);
        $usage=$this->quota()->admit($alice,128);
        $this->assertSame(0,$usage['filesUsed']);
        $this->assertSame(0,$usage['recordedCipherBytes']);
        $other=$this->quota()->admit($bob,128);
        $this->assertSame(1,$other['filesUsed']);
        $this->assertSame(300,$other['recordedCipherBytes']);
    }

    public function test_corrupt_entitlement_is_never_silently_downgraded_to_unlimited():void
    {
        $a=$this->account();
        $this->quota()->admit($a,128);
        DB::table('billing_entitlement_snapshots_v1')
            ->where('account_id',$a)->update(['definition_json'=>'{"forged":true}']);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('billing.snapshot_integrity_failed');
        $this->quota()->admit($a,128);
    }
}
