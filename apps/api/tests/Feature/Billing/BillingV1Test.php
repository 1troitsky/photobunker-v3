<?php
declare(strict_types=1);

namespace Tests\Feature\Billing;

use App\Billing\EntitlementLedger;
use App\Plans\PlanCatalog;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * #224: real Laravel session/PG-ready storage contract. No fake checkout,
 * client-controlled entitlement or plaintext E2EE media in this test.
 */
final class BillingV1Test extends TestCase
{
    use RefreshDatabase;

    private array $users=[];

    protected function setUp():void
    {
        parent::setUp();
        foreach(['alice','bob'] as $label) {
            $account=(string)Str::uuid();
            $device=(string)Str::uuid();
            DB::table('identity_accounts')->insert([
                'id'=>$account,
                'operation_id'=>(string)Str::uuid(),
                'prepare_hash'=>str_repeat('a',64),
                'status'=>'ready',
                'reserved_until'=>now()->addDay(),
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('identity_devices')->insert([
                'id'=>$device,'account_id'=>$account,
                'signing_spki'=>'isolated-test-only-fixture',
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            $this->users[$label]=['account'=>$account,'device'=>$device];
        }
    }

    private function login(string $label):void
    {
        $u=$this->users[$label];
        $this->withSession([
            'identity_account'=>$u['account'],
            'identity_device'=>$u['device'],
            'identity_issued'=>time(),
        ]);
    }

    private function ledger():EntitlementLedger
    {
        return $this->app->make(EntitlementLedger::class);
    }

    private function event(string $tag):string
    {
        return hash('sha256',"verified-test-event\n".$tag);
    }

    /** @return array{0:CarbonImmutable,1:CarbonImmutable} */
    private function paidPeriod():array
    {
        return [
            CarbonImmutable::now('UTC')->subMinutes(2)->startOfSecond(),
            CarbonImmutable::now('UTC')->addDay()->startOfSecond(),
        ];
    }

    private function activate(string $plan='go',string $tag='paid',int $expected=1):array
    {
        $a=$this->users['alice']['account'];
        [$start,$end]=$this->paidPeriod();
        return $this->ledger()->advanceTrusted($a,$plan,$expected,
            $this->event($tag),'settlement_verified',$start,$end);
    }

    public function test_public_catalog_has_exact_owner_prices_and_approved_decimal_byte_ceilings():void
    {
        $response=$this->getJson('/billing/v1/plans')->assertOk()
            ->assertHeader('Cache-Control','no-store, private')
            ->assertJsonPath('schemaVersion',1)
            ->assertJsonPath('catalogVersion','pb3-2026-11-12')
            ->assertJsonPath('effectiveAt','2026-11-12T00:00:00Z')
            ->assertJsonPath('unitPolicy','DECIMAL_GB_TB_V1')
            ->assertJsonCount(5,'plans');
        $plans=$response->json('plans');
        $this->assertSame(['free','go','pro','unlimited','unlimited_plus'],
            array_column($plans,'planId'));
        $this->assertSame([0,1500,3000,5000,10000],
            array_column($plans,'monthlyPriceCents'));
        $this->assertSame([3,30,100,null,null],
            array_map(static fn(array $p)=>$p['limits']['assignmentCreationsPerMonth'],$plans));
        $this->assertSame([50,250,2000,null,null],
            array_map(static fn(array $p)=>$p['limits']['maxMediaFiles'],$plans));
        $this->assertSame([14,30,90,null,null],
            array_map(static fn(array $p)=>$p['limits']['retention']['days']??null,$plans));
        $this->assertSame([null,15,30,60,90],
            array_map(static fn(array $p)=>$p['limits']['graceDays'],$plans));
        $this->assertSame([false,false,false,false,true],
            array_map(static fn(array $p)=>$p['featureFlags']['byoS3'],$plans));
        $this->assertSame([false,false,false,false,true],
            array_map(static fn(array $p)=>$p['featureFlags']['ownMatrixHomeserver'],$plans));
        $approvedCeilings=[1000000000,30000000000,200000000000,
            500000000000,1000000000000];
        foreach($plans as $i=>$p){
            $this->assertSame($approvedCeilings[$i],
                $p['limits']['storage']['byteCeiling']);
            $this->assertSame('DECIMAL_GB_TB_V1',
                $p['limits']['storage']['unitPolicy']);
            $this->assertTrue($p['featureFlags']['matrixE2eeMessages']);
            $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/D',$p['definitionSha256']);
            $this->assertSame($p['monthlyPriceCents'],$p['periodPricesCents'][1]);
        }
        $this->assertSame([
            'amount'=>1,'unit'=>'TB','byteCeiling'=>1000000000000,
            'unitPolicy'=>'DECIMAL_GB_TB_V1',
        ],$plans[4]['limits']['storage']);
        $this->assertDatabaseCount('billing_entitlement_heads_v1',0);
    }

    public function test_untrusted_billing_requests_have_no_activation_write_surface():void
    {
        $this->getJson('/billing/v1/me')->assertUnauthorized();
        $this->postJson('/billing/v1/me',['planId'=>'unlimited_plus'])->assertStatus(405);
        $this->postJson('/billing/v1/subscribe',['planId'=>'unlimited_plus'])->assertNotFound();
        $this->postJson('/billing/v1/entitlements',['planId'=>'unlimited_plus'])
            ->assertNotFound();
        $this->postJson('/billing/v1/plans',['priceCents'=>0])->assertStatus(405);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1',0);
    }

    public function test_new_account_bootstraps_only_free_once_on_authenticated_server_read():void
    {
        $this->login('alice');
        $first=$this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('schemaVersion',1)
            ->assertJsonPath('entitlement.planId','free')
            ->assertJsonPath('entitlement.effectivePlanId','free')
            ->assertJsonPath('entitlement.revision',1)
            ->assertJsonPath('entitlement.status','active')
            ->assertJsonPath('entitlement.source','free_bootstrap')
            ->assertJsonPath('entitlement.paidPrivilegesActive',false)
            ->assertJsonPath('entitlement.effectiveLimits.maxMediaFiles',50)
            ->assertJsonPath('usage.activeLogicalMediaFiles',0)
            ->assertJsonPath('usage.recordedCipherBytes',0)
            ->assertJsonPath('usage.measurement','read_only_non_atomic')->json();
        $this->assertNull($first['entitlement']['endsAt']);
        $this->assertNull($first['entitlement']['graceEndsAt']);
        $this->assertSame(1000000000,$first['usage']['enforcedByteCeiling']);
        $this->assertSame('DECIMAL_GB_TB_V1',$first['usage']['byteUnitPolicy']);
        $this->assertSame('plan_plus_free_technical_guard',
            $first['usage']['quotaSource']);
        $this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('entitlement.snapshotSha256',
                $first['entitlement']['snapshotSha256']);
        $this->assertDatabaseCount('billing_entitlement_heads_v1',1);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1',1);
        $this->assertDatabaseHas('billing_entitlement_snapshots_v1',[
            'account_id'=>$this->users['alice']['account'],
            'plan_id'=>'free','revision'=>1,
        ]);
    }

    public function test_other_account_and_revoked_or_expired_device_cannot_read_private_entitlement():void
    {
        $this->login('alice');
        $alice=$this->getJson('/billing/v1/me')->assertOk()->json();
        $this->login('bob');
        $bob=$this->getJson('/billing/v1/me?accountId='.
            $this->users['alice']['account'])->assertOk()->json();
        $this->assertNotSame($alice['entitlement']['snapshotSha256'],
            $bob['entitlement']['snapshotSha256']);
        $this->assertSame('free',$bob['entitlement']['planId']);
        $this->assertSame(2,DB::table('billing_entitlement_heads_v1')->count());
        $this->getJson('/billing/v1/accounts/'.$this->users['alice']['account'])
            ->assertNotFound();
        DB::table('identity_devices')->where('id',$this->users['bob']['device'])
            ->update(['revoked_at'=>now()]);
        $this->getJson('/billing/v1/me')->assertUnauthorized();
        $this->withSession(['identity_account'=>$this->users['alice']['account'],
            'identity_device'=>$this->users['alice']['device'],
            'identity_issued'=>time()-90000]);
        $this->getJson('/billing/v1/me')->assertUnauthorized();
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1',2);
    }

    public function test_trusted_paid_transition_is_atomic_versioned_idempotent_and_retains_free_history():void
    {
        $this->login('alice');
        $initial=$this->getJson('/billing/v1/me')->assertOk()->json('entitlement');
        $a=$this->users['alice']['account'];
        [$start,$end]=$this->paidPeriod();
        $event=$this->event('go-settled');
        $one=$this->ledger()->advanceTrusted($a,'go',1,$event,
            'settlement_verified',$start,$end);
        $this->assertSame(['revision'=>2,'unchanged'=>false],$one);
        $replay=$this->ledger()->advanceTrusted($a,'go',1,$event,
            'settlement_verified',$start,$end);
        $this->assertSame(['revision'=>2,'unchanged'=>true],$replay);
        $current=$this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('entitlement.planId','go')
            ->assertJsonPath('entitlement.status','active')
            ->assertJsonPath('entitlement.paidPrivilegesActive',true)
            ->assertJsonPath('entitlement.effectiveLimits.maxMediaFiles',250)
            ->assertJsonPath('entitlement.effectiveFeatureFlags.encryptedCloudBackup',true)
            ->assertJsonPath('entitlement.effectiveFeatureFlags.byoS3',false)
            ->json('entitlement');
        $this->assertNotSame($initial['snapshotSha256'],$current['snapshotSha256']);
        $this->assertSame($initial['snapshotSha256'],
            DB::table('billing_entitlement_snapshots_v1')
                ->where('account_id',$a)->where('revision',1)->value('snapshot_hash'));
        $this->assertSame(2,DB::table('billing_entitlement_snapshots_v1')
            ->where('account_id',$a)->count());
        $this->assertSame(2,(int)DB::table('billing_entitlement_heads_v1')
            ->where('account_id',$a)->value('revision'));
    }

    public function test_stale_cas_and_reused_event_with_altered_intent_fail_without_new_snapshot():void
    {
        $this->login('alice');
        $this->getJson('/billing/v1/me')->assertOk();
        [$start,$end]=$this->paidPeriod();
        $a=$this->users['alice']['account'];
        $key=$this->event('fixed-operation');
        $this->ledger()->advanceTrusted($a,'pro',1,$key,
            'settlement_verified',$start,$end);
        foreach([
            fn()=> $this->ledger()->advanceTrusted($a,'unlimited_plus',1,
                $this->event('stale'),'settlement_verified',$start,$end),
            fn()=> $this->ledger()->advanceTrusted($a,'unlimited',1,
                $key,'settlement_verified',$start,$end),
        ] as $attempt){
            try{$attempt();$this->fail('Expected CAS or event tampering rejection');}
            catch(HttpException $e){$this->assertSame(409,$e->getStatusCode());}
        }
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1',2);
        $this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('entitlement.planId','pro')
            ->assertJsonPath('entitlement.revision',2);
    }

    public function test_grace_expiry_and_downgrade_never_reactivate_paid_privileges():void
    {
        $this->login('alice');
        $a=$this->users['alice']['account'];
        $this->getJson('/billing/v1/me')->assertOk();
        [$start,$end]=$this->paidPeriod();
        $this->ledger()->advanceTrusted($a,'unlimited_plus',1,
            $this->event('plus'),'settlement_verified',$start,$end);
        $current=$this->ledger()->current($a,$start->addMinutes(1));
        $this->assertSame('active',$current['status']);
        $this->assertTrue($current['effectiveFeatureFlags']['byoS3']);
        $this->assertTrue($current['effectiveFeatureFlags']['ownMatrixHomeserver']);
        $grace=$this->ledger()->current($a,$end->addDay());
        $this->assertSame('grace',$grace['status']);
        $this->assertSame('unlimited_plus',$grace['planId']);
        $this->assertSame('free',$grace['effectivePlanId']);
        $this->assertFalse($grace['paidPrivilegesActive']);
        $this->assertFalse($grace['effectiveFeatureFlags']['byoS3']);
        $this->assertFalse($grace['effectiveFeatureFlags']['ownMatrixHomeserver']);
        $this->assertSame(50,$grace['effectiveLimits']['maxMediaFiles']);
        $expired=$this->ledger()->current($a,$end->addDays(91));
        $this->assertSame('expired',$expired['status']);
        $this->assertFalse($expired['paidPrivilegesActive']);

        // Trusted downgrade creates a new revision instead of overwriting
        // the historical Unlimited+ payment/entitlement definition.
        $new=$this->ledger()->advanceTrusted($a,'free',2,
            $this->event('downgrade'),'admin_mfa_approved',$start,null);
        $this->assertSame(['revision'=>3,'unchanged'=>false],$new);
        $this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('entitlement.planId','free')
            ->assertJsonPath('entitlement.revision',3)
            ->assertJsonPath('entitlement.paidPrivilegesActive',false)
            ->assertJsonPath('entitlement.effectiveFeatureFlags.byoS3',false);
        $this->assertDatabaseHas('billing_entitlement_snapshots_v1',[
            'account_id'=>$a,'revision'=>2,'plan_id'=>'unlimited_plus',
        ]);
    }

    public function test_paid_billing_usage_reports_real_decimal_limit_without_client_control():void
    {
        $this->login('alice');
        $this->getJson('/billing/v1/me')->assertOk();
        $this->activate('go','decimal-api');
        $this->getJson('/billing/v1/me?enforcedByteCeiling=999999999999999')
            ->assertOk()
            ->assertJsonPath('entitlement.planId','go')
            ->assertJsonPath('entitlement.effectivePlanId','go')
            ->assertJsonPath('entitlement.effectiveLimits.storage.byteCeiling',
                30000000000)
            ->assertJsonPath('entitlement.effectiveLimits.storage.unitPolicy',
                'DECIMAL_GB_TB_V1')
            ->assertJsonPath('usage.enforcedByteCeiling',30000000000)
            ->assertJsonPath('usage.byteUnitPolicy','DECIMAL_GB_TB_V1')
            ->assertJsonPath('usage.quotaSource','plan_entitlement')
            ->assertJsonPath('usage.measurement','read_only_non_atomic');
        // Billing never creates a mutation endpoint from a client planId.
        $this->postJson('/billing/v1/me',['planId'=>'unlimited_plus'])
            ->assertStatus(405);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1',2);
    }

    public function test_bad_decimal_policy_version_or_overflow_cannot_be_published():void
    {
        $config=config('plans');
        config()->set('plans.catalog_version','pb3-2026-11-09');
        config()->set('plans.effective_at','2026-11-09T00:00:00Z');
        try{
            $this->getJson('/billing/v1/plans')->assertStatus(500);
        }finally{
            config()->set('plans',$config);
        }
        config()->set('plans.plans.unlimited_plus.storage_quota.amount',
            PHP_INT_MAX);
        try{
            $this->getJson('/billing/v1/plans')->assertStatus(500);
        }finally{
            config()->set('plans',$config);
        }
        $this->getJson('/billing/v1/plans')->assertOk()
            ->assertJsonPath('plans.4.limits.storage.byteCeiling',
                1000000000000);
    }

    public function test_paid_snapshot_stays_immutable_across_later_public_price_revision():void
    {
        $this->login('alice');
        $this->getJson('/billing/v1/me')->assertOk();
        $this->activate('go','pricing-v1');
        $before=$this->getJson('/billing/v1/me')->assertOk()->json('entitlement');
        config()->set('plans.catalog_version','pb3-2026-11-13');
        config()->set('plans.effective_at','2026-11-13T00:00:00Z');
        config()->set('plans.plans.go.monthly_price_cents',1900);
        config()->set('plans.plans.go.period_prices_cents',[
            1=>1900,6=>9999,12=>19999,
        ]);
        $this->getJson('/billing/v1/plans')->assertOk()
            ->assertJsonPath('plans.1.monthlyPriceCents',1900);
        $after=$this->getJson('/billing/v1/me')->assertOk()->json('entitlement');
        $this->assertSame('go',$after['planId']);
        $this->assertSame(1500,$after['definition']['monthlyPriceCents']);
        $this->assertSame('pb3-2026-11-12',$after['catalogVersion']);
        $this->assertSame($before['definitionSha256'],$after['definitionSha256']);
        $this->assertSame($before['snapshotSha256'],$after['snapshotSha256']);
    }

    public function test_usage_is_server_measured_per_account_in_utc_not_from_input():void
    {
        $this->login('alice');
        $a=$this->users['alice'];
        $id=(string)Str::uuid();
        $operation=(string)Str::uuid();
        DB::table('assignment_records_v1')->insert([
            'id'=>$id,'owner_account_id'=>$a['account'],
            'operation_id'=>$operation,
            'contract_hash'=>str_repeat('a',64),
            'contract_json'=>'{}','owner_signature'=>'internal-test',
            'private_envelope_json'=>'{}',
            'starts_at'=>now()->getTimestampMs(),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('assignment_creation_meter_v1')->insert([
            'assignment_id'=>$id,'owner_account_id'=>$a['account'],
            'operation_id'=>$operation,'created_at'=>now('UTC'),
        ]);
        DB::table('media_files_v1')->insert([
            'id'=>(string)Str::uuid(),'account_id'=>$a['account'],
            'device_id'=>$a['device'],'operation_id'=>(string)Str::uuid(),
            'media_type'=>'audio','state'=>'active',
            'expires_at'=>now()->addDay()->getTimestampMs(),
            'plain_bytes'=>200,'cipher_bytes'=>256,
            'contract_hash'=>str_repeat('b',64),
            'contract_json'=>'{}','signature'=>'internal-test',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->getJson('/billing/v1/me?assignmentsCreatedThisUtcMonth=0')
            ->assertOk()
            ->assertJsonPath('usage.assignmentsCreatedThisUtcMonth',1)
            ->assertJsonPath('usage.activeLogicalMediaFiles',1)
            ->assertJsonPath('usage.recordedCipherBytes',256)
            ->assertJsonPath('usage.byteUnitPolicy','DECIMAL_GB_TB_V1')
            ->assertJsonPath('usage.enforcedByteCeiling',1000000000);
        // Physical retention cleanup cannot refund a created assignment.
        DB::table('assignment_records_v1')->where('id',$id)->delete();
        $this->getJson('/billing/v1/me')
            ->assertJsonPath('usage.assignmentsCreatedThisUtcMonth',1);
        $this->login('bob');
        $this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('usage.assignmentsCreatedThisUtcMonth',0)
            ->assertJsonPath('usage.activeLogicalMediaFiles',0)
            ->assertJsonPath('usage.recordedCipherBytes',0);
    }

    public function test_bad_sources_unverified_or_unbounded_paid_periods_cannot_transition():void
    {
        $a=$this->users['alice']['account'];
        [$start,$end]=$this->paidPeriod();
        foreach([
            fn()=> $this->ledger()->advanceTrusted($a,'unlimited_plus',1,
                'not-a-sha','settlement_verified',$start,$end),
            fn()=> $this->ledger()->advanceTrusted($a,'pro',1,
                $this->event('frontend'),'from_vue',$start,$end),
            fn()=> $this->ledger()->advanceTrusted($a,'pro',1,
                $this->event('no-period'),'settlement_verified',$start,null),
            fn()=> $this->ledger()->advanceTrusted($a,'pro',1,
                $this->event('future'),'settlement_verified',$end,$end->addDay()),
        ] as $attempt){
            try{$attempt();$this->fail('Must fail before granting paid snapshot');}
            catch(\RuntimeException $e){
                $this->assertContains($e->getMessage(),[
                    'billing.unverified_transition','billing.invalid_transition_period',
                ]);
            }
        }
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1',0);
    }

    public function test_tampered_definition_or_pointer_fails_closed_and_rollback_never_erases_history():void
    {
        $this->login('alice');
        $this->getJson('/billing/v1/me')->assertOk();
        $a=$this->users['alice']['account'];
        DB::table('billing_entitlement_snapshots_v1')
            ->where('account_id',$a)->update(['definition_json'=>'{}']);
        $this->getJson('/billing/v1/me')->assertStatus(500)
            ->assertDontSee('unlimited_plus');
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1',1);
        $this->assertTrue(Schema::hasTable('billing_entitlement_snapshots_v1'));
        $migration=require database_path(
            'migrations/2026_11_12_000007_create_billing_entitlements_v1.php',
        );
        try{$migration->down();$this->fail('Entitlement history must be durable');}
        catch(\RuntimeException $e){
            $this->assertSame('pb3.billing_entitlements.rollback_forbidden',
                $e->getMessage());
        }
        $this->assertTrue(Schema::hasTable('billing_entitlement_heads_v1'));
    }
}
