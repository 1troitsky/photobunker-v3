<?php
declare(strict_types=1);

namespace Tests\Feature\DeadMan;

use App\DeadMan\DeadManSwitch;
use App\Identity\Protocol;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class DeadManSwitchTest extends TestCase
{
    use RefreshDatabase;

    private DeadManSwitch $service;
    private string $account;
    private string $device;
    private \OpenSSLAsymmetricKey $key;

    protected function setUp(): void
    {
        parent::setUp();
        CarbonImmutable::setTestNow('2026-11-14 12:00:00 UTC');
        $this->service = new DeadManSwitch();
        [$this->account,$this->device,$this->key] = $this->identity();
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function identity(string $status = 'ready', ?string $existingAccount = null): array
    {
        $account = $existingAccount ?? (string)Str::uuid();
        if ($existingAccount === null) {
            DB::table('identity_accounts')->insert([
                'id'=>$account,
                'operation_id'=>(string)Str::uuid(),
                'prepare_hash'=>str_repeat('c',64),
                'status'=>$status,
                'reserved_until'=>CarbonImmutable::now()->addDay(),
                'created_at'=>CarbonImmutable::now(),
                'updated_at'=>CarbonImmutable::now(),
            ]);
        }
        $device=(string)Str::uuid();
        $key=openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1',
        ]);
        self::assertInstanceOf(\OpenSSLAsymmetricKey::class,$key);
        $details=openssl_pkey_get_details($key);
        self::assertIsArray($details);
        $spki=base64_decode((string)preg_replace(
            '/-----[^-]+-----|\s+/','',$details['key'],
        ),true);
        self::assertIsString($spki);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$account,
            'signing_spki'=>Protocol::encode($spki),
            'created_at'=>CarbonImmutable::now(),
            'updated_at'=>CarbonImmutable::now(),
        ]);
        return [$account,$device,$key];
    }

    /** @return array<string,mixed> */
    private function payload(string $kind='configure', ?int $months=4, ?int $rev=0): array
    {
        return [
            'accountId'=>$this->account,
            'deviceId'=>$this->device,
            'operationId'=>(string)Str::uuid(),
            'version'=>1,
            'kind'=>$kind,
            'expectedRevision'=>$rev,
            'months'=>$months,
        ];
    }

    private function sign(array $payload, ?\OpenSSLAsymmetricKey $key=null,
        string $purpose="pb3.dead-man-switch.v1\n"):string
    {
        ksort($payload,SORT_STRING);
        $canonical=json_encode($payload,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        self::assertTrue(openssl_sign($purpose.$canonical,$der,$key??$this->key,OPENSSL_ALGO_SHA256));
        self::assertSame("\x30",$der[0]);
        $pos=2;
        $integer=static function()use(&$pos,$der):string{
            if(ord($der[$pos++])!==2)throw new \LogicException('DER integer');
            $size=ord($der[$pos++]);
            $bytes=substr($der,$pos,$size);
            $pos+=$size;
            return str_pad(ltrim($bytes,"\x00"),32,"\x00",STR_PAD_LEFT);
        };
        return Protocol::encode($integer().$integer());
    }

    /** @return array<string,mixed> */
    private function submit(array $payload, ?\OpenSSLAsymmetricKey $key=null,
        ?string $signature=null): array
    {
        return $this->service->applySigned($payload,$signature??$this->sign($payload,$key));
    }

    private function reject(callable $operation): void
    {
        try{
            $operation();
            self::fail('Untrusted Dead Man action was accepted');
        }catch(\DomainException $e){
            self::assertSame('deadman.operation_denied',$e->getMessage());
        }
    }

    private function advance(string $date):void
    {
        CarbonImmutable::setTestNow($date);
    }

    private function row():?object
    {
        return DB::table('dead_man_switches_v1')->where('account_id',$this->account)->first();
    }

    public function test_default_is_off_and_cannot_fake_checkin_before_configuration():void
    {
        self::assertNull($this->row());
        $p=$this->payload('checkin',null);
        $this->reject(fn()=> $this->submit($p));
        self::assertDatabaseCount('dead_man_switches_v1',0);
        self::assertDatabaseCount('dead_man_operations_v1',0);
    }

    public function test_signed_enable_persists_exact_server_deadline_and_idempotent_receipt():void
    {
        $p=$this->payload();
        $a=$this->submit($p);
        self::assertSame('armed',$a['state']);
        self::assertSame(1,$a['revision']);
        self::assertFalse($a['idempotent']);
        self::assertSame('2027-03-14T12:00:00+00:00',$a['deadlineAt']);
        $b=$this->submit($p);
        self::assertTrue($b['idempotent']);
        self::assertSame($a['deadlineAt'],$b['deadlineAt']);
        self::assertDatabaseCount('dead_man_operations_v1',1);
        self::assertSame(4,(int)$this->row()->months);
        self::assertSame(1,(int)$this->row()->revision);
    }

    public function test_off_and_all_four_allowed_months_from_server_clock():void
    {
        foreach([0,4,6,12,24] as $period) {
            [$account,$device,$key]=$this->identity();
            $p=$this->payload();
            $p['accountId']=$account;
            $p['deviceId']=$device;
            $p['months']=$period;
            $r=$this->submit($p,$key);
            self::assertSame($period===0?'disabled':'armed',$r['state']);
            self::assertSame($period===0, $r['deadlineAt'] === null,
                'Disabled has null deadline');
            self::assertSame($period,(int)DB::table('dead_man_switches_v1')
                ->where('account_id',$account)->value('months'));
        }
    }

    public function test_server_calendar_months_no_overflow_on_end_of_month():void
    {
        $this->advance('2027-01-31 23:30:00 UTC');
        $p=$this->payload('configure',4);
        $r=$this->submit($p);
        self::assertSame('2027-05-31T23:30:00+00:00',$r['deadlineAt']);
        self::assertSame('2027-05-01 23:30:00',(string)$this->row()->warning_at);
    }

    public function test_warning_is_idempotent_and_has_no_destructive_side_effect():void
    {
        $this->submit($this->payload());
        $this->advance('2027-02-12 11:59:59 UTC');
        self::assertSame(['warning'=>0,'expiredReview'=>0],$this->service->sweepDue());
        $this->advance('2027-02-12 12:00:00 UTC');
        // Exact threshold is 2027-02-12 12:00 UTC (30 days before Mar 14).
        self::assertSame(['warning'=>1,'expiredReview'=>0],$this->service->sweepDue());
        self::assertSame(['warning'=>0,'expiredReview'=>0],$this->service->sweepDue());
        self::assertSame('warning',$this->row()->state);
        self::assertNull($this->row()->expired_review_at);
        self::assertDatabaseCount('dead_man_operations_v1',1);
    }

    public function test_expiry_moves_only_to_review_and_repeated_sweep_is_noop():void
    {
        $this->submit($this->payload());
        $this->advance('2027-03-14 12:00:00 UTC');
        self::assertSame(['warning'=>0,'expiredReview'=>1],$this->service->sweepDue());
        self::assertSame('expired_review',$this->row()->state);
        self::assertSame(['warning'=>0,'expiredReview'=>0],$this->service->sweepDue());
        self::assertDatabaseCount('dead_man_switches_v1',1);
        self::assertDatabaseCount('identity_accounts',1);
        self::assertDatabaseCount('identity_devices',1);
        self::assertDatabaseCount('dead_man_operations_v1',1);
    }

    public function test_signed_trusted_checkin_prevents_elapsed_trigger_and_restarts_timer():void
    {
        $this->submit($this->payload());
        $this->advance('2027-03-13 12:00:00 UTC');
        $p=$this->payload('checkin',null,1);
        $a=$this->submit($p);
        self::assertSame('armed',$a['state']);
        self::assertSame(2,$a['revision']);
        self::assertSame('2027-07-13T12:00:00+00:00',$a['deadlineAt']);
        $this->advance('2027-03-14 12:00:01 UTC');
        self::assertSame(['warning'=>0,'expiredReview'=>0],$this->service->sweepDue());
    }

    public function test_owner_can_rearm_from_expired_review_before_any_external_policy():void
    {
        $this->submit($this->payload());
        $this->advance('2027-03-15 12:00:00 UTC');
        $this->service->sweepDue();
        $result=$this->submit($this->payload('checkin',null,1));
        self::assertSame('armed',$result['state']);
        self::assertNull($this->row()->expired_review_at);
        self::assertSame('2027-07-15T12:00:00+00:00',$result['deadlineAt']);
    }

    public function test_signed_disable_cancels_future_warning_and_expiration():void
    {
        $this->submit($this->payload());
        $p=$this->payload('configure',0,1);
        self::assertSame('disabled',$this->submit($p)['state']);
        self::assertNull($this->row()->warning_at);
        self::assertNull($this->row()->deadline_at);
        $this->advance('2029-03-14 12:00:00 UTC');
        self::assertSame(['warning'=>0,'expiredReview'=>0],$this->service->sweepDue());
        $this->reject(fn()=> $this->submit($this->payload('checkin',null,2)));
    }

    public function test_conflicting_operation_replay_cannot_extend_deadline_or_change_period():void
    {
        $p=$this->payload();
        $this->submit($p);
        $changed=$p;
        $changed['months']=24;
        $this->reject(fn()=> $this->submit($changed));
        self::assertSame(4,(int)$this->row()->months);
        self::assertDatabaseCount('dead_man_operations_v1',1);
    }

    public function test_stale_revision_and_double_request_cannot_extend_once_more():void
    {
        $this->submit($this->payload());
        $p=$this->payload('checkin',null,1);
        $this->submit($p);
        $this->reject(fn()=> $this->submit($this->payload('checkin',null,1)));
        self::assertSame(2,(int)$this->row()->revision);
        self::assertDatabaseCount('dead_man_operations_v1',2);
    }

    public function test_real_p256_signature_is_required_and_domain_separated():void
    {
        $p=$this->payload();
        $this->reject(fn()=> $this->submit($p,signature:str_repeat('A',86)));
        $this->reject(fn()=> $this->submit($p,signature:$this->sign($p,purpose:"pb3.other.v1\n")));
        $other=openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1',
        ]);
        self::assertInstanceOf(\OpenSSLAsymmetricKey::class,$other);
        $this->reject(fn()=> $this->submit($p,$other));
        self::assertDatabaseCount('dead_man_switches_v1',0);
    }

    public function test_foreign_and_revoked_device_cannot_submit_or_replay_signed_operation():void
    {
        [$otherAccount,$otherDevice,$otherKey]=$this->identity();
        $p=$this->payload();
        $p['deviceId']=$otherDevice;
        $this->reject(fn()=> $this->submit($p,$otherKey));
        $valid=$this->payload();
        $this->submit($valid);
        DB::table('identity_devices')->where('id',$this->device)
            ->update(['revoked_at'=>CarbonImmutable::now()]);
        $this->reject(fn()=> $this->submit($valid));
        $this->reject(fn()=> $this->submit($this->payload()));
        self::assertDatabaseCount('dead_man_operations_v1',1);
    }

    public function test_replay_operation_id_cannot_be_adopted_by_different_account():void
    {
        $p=$this->payload();
        $this->submit($p);
        [$account,$device,$key]=$this->identity();
        $p['accountId']=$account;
        $p['deviceId']=$device;
        $this->reject(fn()=> $this->submit($p,$key));
        self::assertDatabaseCount('dead_man_operations_v1',1);
    }

    public function test_stale_or_nonready_account_is_denied():void
    {
        DB::table('identity_accounts')->where('id',$this->account)->update(['status'=>'reserved']);
        $this->reject(fn()=> $this->submit($this->payload()));
        self::assertDatabaseCount('dead_man_operations_v1',0);
    }

    public function test_unknown_months_missing_fields_client_clock_and_invalid_revisions_denied():void
    {
        $p=$this->payload();
        foreach([1,2,3,5,30,-4,'4',null] as $invalid){
            $bad=$p;$bad['months']=$invalid;
            $this->reject(fn()=> $this->submit($bad));
        }
        foreach([
            ['deadlineAt'=>'2050-01-01T00:00:00Z'],
            ['now'=>1],
            ['secret'=>'recovery-key'],
        ] as $extra){
            $this->reject(fn()=> $this->submit($p+$extra));
        }
        foreach([-1,4294967295,'0'] as $invalid){
            $bad=$p;$bad['expectedRevision']=$invalid;
            $this->reject(fn()=> $this->submit($bad));
        }
        $bad=$p;$bad['version']=2;
        $this->reject(fn()=> $this->submit($bad));
        self::assertDatabaseCount('dead_man_operations_v1',0);
    }

    public function test_scheduler_rejects_invalid_batch_and_does_not_trigger_inactive_account():void
    {
        $this->reject(fn()=> $this->service->sweepDue(0));
        $this->reject(fn()=> $this->service->sweepDue(501));
        $this->submit($this->payload());
        DB::table('identity_accounts')->where('id',$this->account)->update(['status'=>'reserved']);
        $this->advance('2027-03-15 12:00:00 UTC');
        self::assertSame(['warning'=>0,'expiredReview'=>0],$this->service->sweepDue());
        self::assertSame('armed',$this->row()->state);
    }

    public function test_operation_ledger_contains_only_signed_metadata_not_keys_or_pin():void
    {
        $p=$this->payload();
        $this->submit($p);
        $op=DB::table('dead_man_operations_v1')->first();
        self::assertSame($this->account,$op->account_id);
        self::assertSame(hash('sha256',$this->signedMessage($p)),$op->payload_hash);
        self::assertObjectNotHasProperty('recovery_key',$op);
        self::assertObjectNotHasProperty('pin',$op);
        self::assertObjectNotHasProperty('message_body',$op);
    }

    /**
     * PG18 acceptance uses clock_timestamp(), NOT Carbon's test clock.
     * This proves signed state and due transitions against a real DB clock.
     */
    public function test_pg_server_clock_and_non_destructive_transitions():void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            self::markTestSkipped('PG18-only server clock acceptance');
        }
        $before=CarbonImmutable::parse(DB::selectOne(
            'SELECT clock_timestamp() AS db_now',
        )->db_now);
        $p=$this->payload();
        $first=$this->submit($p);
        $after=CarbonImmutable::parse(DB::selectOne(
            'SELECT clock_timestamp() AS db_now',
        )->db_now);
        $confirmed=CarbonImmutable::parse($this->row()->last_confirmed_at);
        // Eloquent/PDO may round timestamps to whole seconds; the DB clock
        // still has to fall inside the surrounding real PostgreSQL samples.
        self::assertTrue($confirmed->greaterThanOrEqualTo($before->subSecond()));
        self::assertTrue($confirmed->lessThanOrEqualTo($after->addSecond()));
        self::assertSame($confirmed->addMonthsNoOverflow(4)->toIso8601String(),
            CarbonImmutable::parse($first['deadlineAt'])->toIso8601String());
        self::assertSame(1,DB::table('dead_man_operations_v1')->count());

        DB::table('dead_man_switches_v1')->where('account_id',$this->account)
            ->update([
                'warning_at'=>DB::raw("clock_timestamp() - interval '1 second'"),
                'deadline_at'=>DB::raw("clock_timestamp() + interval '1 day'"),
            ]);
        self::assertSame(['warning'=>1,'expiredReview'=>0],$this->service->sweepDue());
        self::assertSame('warning',$this->row()->state);
        DB::table('dead_man_switches_v1')->where('account_id',$this->account)
            ->update(['deadline_at'=>DB::raw("clock_timestamp() - interval '1 second'")]);
        self::assertSame(['warning'=>0,'expiredReview'=>1],$this->service->sweepDue());
        self::assertSame(['warning'=>0,'expiredReview'=>0],$this->service->sweepDue());
        self::assertSame('expired_review',$this->row()->state);
        self::assertDatabaseCount('identity_accounts',1);
        self::assertDatabaseCount('identity_devices',1);
        self::assertDatabaseCount('dead_man_operations_v1',1);
    }

    private function signedMessage(array $p):string
    {
        ksort($p,SORT_STRING);
        return "pb3.dead-man-switch.v1\n".json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    }
}
