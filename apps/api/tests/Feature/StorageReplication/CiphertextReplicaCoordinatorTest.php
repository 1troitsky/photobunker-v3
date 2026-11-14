<?php
declare(strict_types=1);

namespace Tests\Feature\StorageReplication;

use App\Storage\Replication\CiphertextReplicaCoordinator;
use App\Storage\StorageAdapter;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/** Two independent in-memory ciphertext providers (not independent S3). */
final class ReplicaTestTransport implements StorageAdapter
{
    /** @var array<string,string> */
    public array $objects=[];
    public int $puts=0;
    public bool $failPut=false;
    public bool $failRead=false;
    public bool $damageAfterPut=false;
    public $onPut=null;

    public function putStream(string $objectKey,mixed $stream):bool
    {
        $this->puts++;
        if ($this->failPut) return false;
        if ($this->onPut!==null) ($this->onPut)();
        $content=stream_get_contents($stream);
        if (!is_string($content)) throw new RuntimeException('test.stream_failed');
        if ($this->damageAfterPut) {
            $content[0]=chr(ord($content[0])^1);
        }
        $this->objects[$objectKey]=$content;
        return true;
    }
    public function readStream(string $objectKey):mixed
    {
        if ($this->failRead) throw new RuntimeException('test.opaque_s3_transport_failure');
        if (!array_key_exists($objectKey,$this->objects)) return false;
        $f=fopen('php://temp','w+b');
        if (!is_resource($f)) throw new RuntimeException('test.no_temp');
        fwrite($f,$this->objects[$objectKey]);
        rewind($f);
        return $f;
    }
    public function exists(string $objectKey):bool
    {
        if ($this->failRead) throw new RuntimeException('test.offline');
        return array_key_exists($objectKey,$this->objects);
    }
    public function size(string $objectKey):int
    {
        if ($this->failRead) throw new RuntimeException('test.offline');
        return strlen($this->objects[$objectKey]??'');
    }
    public function delete(string $objectKey):bool
    {
        throw new RuntimeException('test.replication_must_not_delete');
    }
}

final class CiphertextReplicaCoordinatorTest extends TestCase
{
    use RefreshDatabase;
    private ReplicaTestTransport $a;
    private ReplicaTestTransport $b;
    private CiphertextReplicaCoordinator $service;

    protected function setUp():void
    {
        parent::setUp();
        $this->a=new ReplicaTestTransport();
        $this->b=new ReplicaTestTransport();
        $this->service=new CiphertextReplicaCoordinator([
            'app_s3'=>['adapter'=>$this->a,'failureDomain'=>'platform-garage-01',
                'credentialRevision'=>1],
            'replica_s3'=>['adapter'=>$this->b,'failureDomain'=>'secondary-garage-02',
                'credentialRevision'=>2],
        ]);
    }

    private function clock():CarbonImmutable
    {
        return CarbonImmutable::parse('2026-11-14T12:00:00Z');
    }
    private function identity():array
    {
        $now=$this->clock();
        $account=(string)Str::uuid();
        $device=(string)Str::uuid();
        DB::table('identity_accounts')->insert([
            'id'=>$account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>$now->addDay(),
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$account,
            'signing_spki'=>'synthetic-replication-fixture',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        return [$account,$device];
    }

    /** @return array<string,mixed> */
    private function fixture(
        string $kind='photo',string $parentState='active',
        ?array $identity=null
    ):array {
        [$account,$device]=$identity??$this->identity();
        $now=$this->clock();
        $parent=(string)Str::uuid();
        $asset=(string)Str::uuid();
        $source=(string)Str::uuid();
        $target=(string)Str::uuid();
        $cipher=random_bytes($kind==='photo'?1379:4097);
        $sha=hash('sha256',$cipher);
        $sourceKey='cipher/p4-234/'.$parent.'/'.$source;
        $targetKey='cipher/p4-234/'.$parent.'/'.$target;
        if ($kind==='photo') {
            DB::table('photo_records')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),'state'=>$parentState,
                'expires_at'=>$now->addDay()->getTimestampMs(),
                'contract_hash'=>str_repeat('a',64),'contract_json'=>'{}',
                'signature'=>'synthetic','created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('photo_objects')->insert([
                'id'=>$asset,'photo_id'=>$parent,'kind'=>'master','revision'=>1,
                'bytes'=>strlen($cipher),'sha256'=>$sha,'manifest_json'=>'{}',
                'object_key'=>$sourceKey,'state'=>'active',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            $table='storage_locations';$fk='asset_id';
        } else {
            DB::table('media_files_v1')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),'media_type'=>'video',
                'state'=>$parentState,'expires_at'=>$now->addDay()->getTimestampMs(),
                'plain_bytes'=>1337,'cipher_bytes'=>strlen($cipher),
                'contract_hash'=>str_repeat('a',64),'contract_json'=>'{}',
                'signature'=>'synthetic','created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('media_chunks_v1')->insert([
                'id'=>$asset,'media_id'=>$parent,'chunk_index'=>0,
                'kind'=>'data','plain_bytes'=>1337,'bytes'=>strlen($cipher),
                'sha256'=>$sha,'iv'=>'synthetic-iv','state'=>'active',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            $table='media_chunk_locations_v1';$fk='chunk_id';
        }
        foreach ([
            [$source,'app_s3',$sourceKey,'verified'],
            [$target,'replica_s3',$targetKey,'reserved'],
        ] as [$id,$provider,$key,$state]) {
            DB::table($table)->insert([
                'id'=>$id,$fk=>$asset,'provider'=>$provider,
                'object_key'=>$key,'sha256'=>$sha,'bytes'=>strlen($cipher),
                'state'=>$state,'created_at'=>$now,'updated_at'=>$now,
            ]);
        }
        $this->a->objects[$sourceKey]=$cipher;
        return compact('account','device','parent','asset','source','target',
            'sourceKey','targetKey','sha','cipher','kind','table','fk');
    }

    /** @param array<string,mixed> $f */
    private function enqueue(array $f,string $key='replica-operation-00000001'):array
    {
        return $this->service->enqueue(
            $f['account'],$f['kind'],$f['asset'],$f['source'],$f['target'],
            $key,$this->clock());
    }
    /** @param callable():mixed $action */
    private function denied(callable $action,string $expected):void
    {
        try {
            $action();
            $this->fail('Expected denial: '.$expected);
        } catch (RuntimeException $e) {
            $this->assertSame($expected,$e->getMessage());
        }
    }

    public function test_photo_is_really_copied_only_after_primary_integrity_and_readback():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        $this->assertSame('queued',$job['state']);
        $this->assertFalse($job['liveReplicaActivated']);
        $result=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('verified',$result['state']);
        $this->assertTrue($result['transferVerified']);
        $this->assertFalse($result['liveReplicaActivated']);
        $this->assertSame(1,$result['attempts']);
        $this->assertSame(1,$this->b->puts);
        $this->assertSame($f['cipher'],$this->b->objects[$f['targetKey']]);
        $this->assertSame($f['cipher'],$this->a->objects[$f['sourceKey']]);
        $this->assertSame('verified',DB::table($f['table'])
            ->where('id',$f['target'])->value('state'));
        $this->assertSame('verified',$this->service->process(
            $job['jobId'],$this->clock()->addMinute())['state']);
        $this->assertSame(1,$this->b->puts);
        $this->assertSame($job['jobId'],$this->enqueue($f)['jobId']);
    }

    public function test_media_chunk_replication_uses_separate_location_table():void
    {
        $f=$this->fixture('media_chunk');
        $job=$this->enqueue($f);
        $result=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('verified',$result['state']);
        $this->assertSame('verified',DB::table('media_chunk_locations_v1')
            ->where('id',$f['target'])->value('state'));
        $this->assertSame($f['sha'],hash('sha256',$this->b->objects[$f['targetKey']]));
    }

    public function test_lost_put_ack_is_reconciled_with_physical_get_without_new_put():void
    {
        $f=$this->fixture();
        $this->b->objects[$f['targetKey']]=$f['cipher'];
        $job=$this->enqueue($f);
        $result=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('verified',$result['state']);
        $this->assertSame(0,$this->b->puts);
        $this->assertSame('verified',DB::table($f['table'])
            ->where('id',$f['target'])->value('state'));
    }

    public function test_target_outage_is_durable_retry_then_physical_recovery():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        $this->b->failPut=true;
        $first=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('retry',$first['state']);
        $this->assertFalse($first['transferVerified']);
        $this->assertSame(1,$first['attempts']);
        $this->assertSame('reserved',DB::table($f['table'])
            ->where('id',$f['target'])->value('state'));
        $this->assertSame('retry',$this->service->process(
            $job['jobId'],$this->clock()->addSeconds(5))['state']);
        $this->assertSame(1,$this->service->status(
            $f['account'],$job['jobId'])['attempts']);
        $this->b->failPut=false;
        $second=$this->service->process(
            $job['jobId'],$this->clock()->addSeconds(11));
        $this->assertSame('verified',$second['state']);
        $this->assertSame(2,$second['attempts']);
        $this->assertSame($f['cipher'],$this->b->objects[$f['targetKey']]);
    }

    public function test_same_length_corrupted_source_cannot_propagate_any_ciphertext():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        $corrupt=$f['cipher'];
        $corrupt[9]=chr(ord($corrupt[9])^1);
        $this->a->objects[$f['sourceKey']]=$corrupt;
        $ret=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('retry',$ret['state']);
        $this->assertSame(0,$this->b->puts);
        $this->assertArrayNotHasKey($f['targetKey'],$this->b->objects);
        $this->assertSame('reserved',DB::table($f['table'])
            ->where('id',$f['target'])->value('state'));
    }

    public function test_put_ack_without_matching_destination_readback_is_retried():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        $this->b->damageAfterPut=true;
        $first=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('retry',$first['state']);
        $this->assertSame(1,$this->b->puts);
        $this->assertNotSame($f['sha'],hash('sha256',$this->b->objects[$f['targetKey']]));
        $this->assertSame('reserved',DB::table($f['table'])
            ->where('id',$f['target'])->value('state'));
        $this->b->damageAfterPut=false;
        $again=$this->service->process($job['jobId'],$this->clock()->addSeconds(11));
        $this->assertSame('verified',$again['state']);
        $this->assertSame(2,$this->b->puts);
    }

    public function test_delete_tombstone_mid_put_must_not_promote_destination():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        $this->b->onPut=function()use($f):void {
            DB::table('photo_tombstones')->insert([
                'photo_id'=>$f['parent'],'account_id'=>$f['account'],
                'operation_id'=>(string)Str::uuid(),
                'reason'=>'owner','object_keys'=>'[]',
                'created_at'=>$this->clock(),
            ]);
        };
        $ret=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('retry',$ret['state']);
        $this->assertSame('reserved',DB::table($f['table'])
            ->where('id',$f['target'])->value('state'));
        $this->assertSame($f['cipher'],$this->a->objects[$f['sourceKey']]);
        $this->assertSame($f['cipher'],$this->b->objects[$f['targetKey']]);
    }

    public function test_revoked_account_mid_transfer_cancels_ticket_without_verified_ack():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        $this->b->onPut=function()use($f):void {
            DB::table('identity_accounts')->where('id',$f['account'])
                ->update(['status'=>'retired']);
        };
        $result=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('cancelled',$result['state']);
        $this->assertFalse($result['transferVerified']);
        $this->assertSame('reserved',DB::table($f['table'])
            ->where('id',$f['target'])->value('state'));
        $this->assertSame('account_revoked',DB::table('ciphertext_replication_jobs_v1')
            ->where('id',$job['jobId'])->value('failure_class'));
        $this->assertSame($f['cipher'],$this->a->objects[$f['sourceKey']]);
    }

    public function test_remote_put_can_finish_after_lease_expiry_without_claiming_verified():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        $this->b->onPut=function()use($job):void {
            DB::table('ciphertext_replication_jobs_v1')->where('id',$job['jobId'])
                ->update(['lease_until'=>$this->clock()->subSecond()]);
        };
        $result=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('retry',$result['state']);
        $this->assertFalse($result['transferVerified']);
        $this->assertSame('reserved',DB::table($f['table'])
            ->where('id',$f['target'])->value('state'));
        // Physical PUT was completed, then ACK was lost/rejected. The
        // next fresh GET+SHA is enough; it must NOT issue another PUT.
        $this->b->onPut=null;
        $next=$this->service->process($job['jobId'],
            $this->clock()->addSeconds(11));
        $this->assertSame('verified',$next['state']);
        $this->assertSame(1,$this->b->puts);
    }

    public function test_parent_expiring_during_remote_put_never_promotes_replica():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        $this->b->onPut=function()use($f):void {
            DB::table('photo_records')->where('id',$f['parent'])
                ->update(['expires_at'=>$this->clock()->getTimestampMs()]);
        };
        $result=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('retry',$result['state']);
        $this->assertSame('reserved',DB::table($f['table'])
            ->where('id',$f['target'])->value('state'));
        $this->assertSame($f['cipher'],$this->a->objects[$f['sourceKey']]);
    }

    public function test_mid_put_object_key_swap_denies_verified_ack():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        $this->b->onPut=function()use($f):void {
            DB::table($f['table'])->where('id',$f['target'])
                ->update(['object_key'=>'cipher/tampered/another-target',
                    'updated_at'=>$this->clock()->addMinute()]);
        };
        $result=$this->service->process($job['jobId'],$this->clock());
        $this->assertSame('retry',$result['state']);
        $this->assertSame(0,DB::table($f['table'])
            ->where('id',$f['target'])->where('state','verified')->count());
    }

    public function test_idempotency_key_collision_different_asset_denied():void
    {
        $who=$this->identity();
        $a=$this->fixture('photo','active',$who);
        $b=$this->fixture('photo','active',$who);
        $this->enqueue($a);
        $this->denied(fn()=>$this->enqueue($b),'replication.idempotency_conflict');
        $this->assertSame(1,DB::table('ciphertext_replication_jobs_v1')->count());
    }

    public function test_different_keys_same_target_busy_until_ack_and_explicit_degrade():void
    {
        $f=$this->fixture();
        $a=$this->enqueue($f);
        $this->denied(fn()=>$this->enqueue($f,'replica-operation-00000002'),
            'replication.target_busy');
        $this->service->process($a['jobId'],$this->clock());
        $this->denied(fn()=>$this->enqueue($f,'replica-operation-00000002'),
            'replication.location_not_eligible');
        DB::table($f['table'])->where('id',$f['target'])->update([
            'state'=>'degraded','updated_at'=>$this->clock()->addMinute(),
        ]);
        $repair=$this->enqueue($f,'replica-operation-00000002');
        $this->assertSame(2,$repair['generation']);
        $this->assertSame('queued',$repair['state']);
        $this->assertSame(2,DB::table('ciphertext_replication_jobs_v1')->count());
    }

    public function test_foreign_owner_and_inactive_parent_never_enqueue():void
    {
        $f=$this->fixture();
        [$foreign]=$this->identity();
        $this->denied(fn()=>$this->service->enqueue(
            $foreign,'photo',$f['asset'],$f['source'],$f['target'],
            'replica-operation-00000001',$this->clock()),
            'replication.inactive_or_invalid_asset');
        DB::table('photo_records')->where('id',$f['parent'])
            ->update(['state'=>'deleting']);
        $this->denied(fn()=>$this->enqueue($f),'replication.inactive_or_invalid_asset');
        $this->assertSame(0,DB::table('ciphertext_replication_jobs_v1')->count());
    }

    public function test_expired_and_tombstoned_objects_never_enqueue():void
    {
        $f=$this->fixture();
        DB::table('photo_records')->where('id',$f['parent'])
            ->update(['expires_at'=>$this->clock()->getTimestampMs()]);
        $this->denied(fn()=>$this->enqueue($f),'replication.inactive_or_invalid_asset');
        DB::table('photo_records')->where('id',$f['parent'])
            ->update(['expires_at'=>$this->clock()->addDay()->getTimestampMs()]);
        DB::table('photo_tombstones')->insert([
            'photo_id'=>$f['parent'],'account_id'=>$f['account'],
            'operation_id'=>(string)Str::uuid(),
            'reason'=>'owner','object_keys'=>'[]','created_at'=>$this->clock(),
        ]);
        $this->denied(fn()=>$this->enqueue($f),'replication.inactive_or_invalid_asset');
    }

    public function test_same_provider_failure_domain_fails_closed():void
    {
        $f=$this->fixture();
        $c=new CiphertextReplicaCoordinator([
            'app_s3'=>['adapter'=>$this->a,
                'failureDomain'=>'shared-location-01','credentialRevision'=>1],
            'replica_s3'=>['adapter'=>$this->b,
                'failureDomain'=>'shared-location-01','credentialRevision'=>1],
        ]);
        $this->denied(fn()=>$c->enqueue(
            $f['account'],'photo',$f['asset'],$f['source'],$f['target'],
            'replica-operation-00000001',$this->clock()),
            'replication.same_failure_domain');
    }

    public function test_recovery_from_expired_lease_after_simulated_worker_crash():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        DB::table('ciphertext_replication_jobs_v1')->where('id',$job['jobId'])
            ->update([
                'state'=>'leased','attempts'=>1,
                'lease_sha256'=>hash('sha256','old-stale-worker-lease'),
                'lease_until'=>$this->clock()->addSeconds(8),
            ]);
        $this->assertSame('leased',$this->service->process(
            $job['jobId'],$this->clock()->addSeconds(4))['state']);
        $good=$this->service->process(
            $job['jobId'],$this->clock()->addSeconds(9));
        $this->assertSame('verified',$good['state']);
        $this->assertSame(2,$good['attempts']);
    }

    public function test_status_hides_sensitive_paths_and_enforces_account_scope():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        [$foreign]=$this->identity();
        $this->denied(fn()=>$this->service->status(
            $foreign,$job['jobId']),'replication.not_found');
        $status=$this->service->status($f['account'],$job['jobId']);
        $raw=json_encode($status,JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString($f['sourceKey'],$raw);
        $this->assertStringNotContainsString($f['targetKey'],$raw);
        $this->assertArrayNotHasKey('lease_hash',$status);
    }
}
