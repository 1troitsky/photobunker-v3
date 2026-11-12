<?php
declare(strict_types=1);

namespace Tests\Feature\Billing;

use App\Assignments\MonthlyCreationQuota;
use App\Billing\EntitlementLedger;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Historical creation event meter and five-plan UTC allowance evidence. */
final class AssignmentCreationMeterTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown():void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function account():string
    {
        $id=(string)Str::uuid();
        DB::table('identity_accounts')->insert([
            'id'=>$id,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>now()->addWeek(),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        return $id;
    }

    private function trusted(string $account,string $plan):void
    {
        $ledger=app(EntitlementLedger::class);
        $ledger->current($account);
        $start=CarbonImmutable::now('UTC')->subMinute()->startOfSecond();
        $end=CarbonImmutable::now('UTC')->addDays(10)->startOfSecond();
        $ledger->advanceTrusted($account,$plan,1,
            hash('sha256','verified-assignment-tariff:'.$account.':'.$plan),
            'settlement_verified',$start,$end);
    }

    private function meter(string $account,?CarbonImmutable $at=null):string
    {
        $id=(string)Str::uuid();
        DB::table('assignment_creation_meter_v1')->insert([
            'assignment_id'=>$id,'owner_account_id'=>$account,
            'operation_id'=>(string)Str::uuid(),
            'created_at'=>$at??CarbonImmutable::now('UTC'),
        ]);
        return $id;
    }

    public function test_all_five_verified_plans_use_immutable_monthly_creation_allowance():void
    {
        foreach([
            'free'=>3,'go'=>30,'pro'=>100,
            'unlimited'=>null,'unlimited_plus'=>null,
        ] as $plan=>$limit){
            $account=$this->account();
            if($plan!=='free')$this->trusted($account,$plan);
            $state=app(MonthlyCreationQuota::class)->usage($account);
            $this->assertSame($plan,$state['planId']);
            $this->assertSame($limit,$state['limit']);
            $this->assertSame($limit,$state['remaining']);
            $this->assertSame(0,$state['used']);
            $this->assertSame('pb3-2026-11-12',$state['catalogVersion']);
            for($i=0;$i<4;$i++)$this->meter($account);
            $next=app(MonthlyCreationQuota::class)->usage($account);
            $this->assertSame(4,$next['used']);
            $this->assertSame($limit===null?null:max(0,$limit-4),
                $next['remaining']);
            $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-01T/',
                $state['periodStart']);
            $this->assertNotSame($state['periodStart'],$state['periodEnd']);
        }
    }

    public function test_deleted_record_remains_charged_without_leaking_other_account_or_month():void
    {
        $a=$this->account();$b=$this->account();
        $id=$this->meter($a);
        $this->meter($b);
        $this->meter($a,CarbonImmutable::now('UTC')->subMonth());
        $quota=app(MonthlyCreationQuota::class);
        $this->assertSame(1,$quota->usage($a)['used']);
        $this->assertSame(1,$quota->usage($b)['used']);
        // There is deliberately NO FK to a deletion-prone assignment row.
        $this->assertDatabaseHas('assignment_creation_meter_v1',[
            'assignment_id'=>$id,'owner_account_id'=>$a,
        ]);
        DB::table('assignment_creation_meter_v1')
            ->where('assignment_id',$id)->where('owner_account_id',$a)
            ->update(['created_at'=>CarbonImmutable::now('UTC')->subMonth()]);
        $this->assertSame(0,$quota->usage($a)['used']);
        $this->assertSame(1,$quota->usage($b)['used']);
    }

    public function test_migration_backfills_existing_signed_assignments_before_first_metered_create():void
    {
        $account=$this->account();$id=(string)Str::uuid();$op=(string)Str::uuid();
        DB::table('assignment_records_v1')->insert([
            'id'=>$id,'owner_account_id'=>$account,
            'operation_id'=>$op,
            'contract_hash'=>str_repeat('b',64),
            'contract_json'=>'{}','owner_signature'=>'synthetic-test',
            'private_envelope_json'=>'{}',
            'starts_at'=>now()->getTimestampMs(),
            'created_at'=>now('UTC'),'updated_at'=>now('UTC'),
        ]);
        $this->assertDatabaseCount('assignment_creation_meter_v1',0);
        // Only in disposable test DB: simulate a pre-upgrade installation.
        Schema::drop('assignment_creation_meter_v1');
        $migration=require database_path(
            'migrations/2026_11_12_000008_create_assignment_creation_meter_v1.php'
        );
        $migration->up();
        $this->assertDatabaseHas('assignment_creation_meter_v1',[
            'assignment_id'=>$id,'owner_account_id'=>$account,
            'operation_id'=>$op,
        ]);
        $this->assertSame(1,app(MonthlyCreationQuota::class)
            ->usage($account)['used']);
        DB::table('assignment_records_v1')->where('id',$id)->delete();
        $this->assertSame(1,app(MonthlyCreationQuota::class)
            ->usage($account)['used']);
        try{$migration->down();$this->fail('Meter rollback must never erase billing history');}
        catch(\RuntimeException $e){
            $this->assertSame(
                'pb3.assignment_creation_meter.rollback_forbidden',
                $e->getMessage());
        }
    }

    public function test_paid_grace_reverts_to_free_without_deleting_creation_meter():void
    {
        $a=$this->account();
        $this->trusted($a,'pro');
        for($i=0;$i<5;$i++)$this->meter($a);
        $this->assertSame(100,app(MonthlyCreationQuota::class)
            ->usage($a)['limit']);
        $ends=DB::table('billing_entitlement_snapshots_v1')
            ->where('account_id',$a)->where('revision',2)->value('ends_at');
        CarbonImmutable::setTestNow(CarbonImmutable::parse($ends,'UTC')->addDay());
        $grace=app(MonthlyCreationQuota::class)->usage($a);
        $this->assertSame('free',$grace['planId']);
        $this->assertSame(3,$grace['limit']);
        $this->assertSame(5,$grace['used']);
        $this->assertSame(0,$grace['remaining']);
        $this->assertDatabaseCount('assignment_creation_meter_v1',5);
    }
}
