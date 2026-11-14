<?php
declare(strict_types=1);

namespace Tests\Feature\StorageReplication;

use App\Storage\Replication\BoundedReplicaDispatcher;
use App\Storage\Replication\CiphertextReplicaCoordinator;
use App\Storage\StorageAdapter;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/** Synthetic ciphertext stream, NOT a real second cloud S3 provider. */
final class Dispatch234MemoryStore implements StorageAdapter
{
    /** @var array<string,string> */
    public array $objects=[];
    public int $puts=0;
    public bool $failPut=false;

    public function putStream(string $objectKey,mixed $stream):bool
    {
        $this->puts++;
        if ($this->failPut) return false;
        $bytes=stream_get_contents($stream);
        if (!is_string($bytes)) throw new RuntimeException('dispatch234.stream_failed');
        $this->objects[$objectKey]=$bytes;
        return true;
    }
    public function readStream(string $objectKey):mixed
    {
        if (!isset($this->objects[$objectKey])) return false;
        $handle=fopen('php://temp','w+b');
        if (!is_resource($handle)
            || fwrite($handle,$this->objects[$objectKey])
                !==strlen($this->objects[$objectKey])) {
            throw new RuntimeException('dispatch234.invalid_memory_stream');
        }
        rewind($handle);
        return $handle;
    }
    public function exists(string $objectKey):bool
    {
        return isset($this->objects[$objectKey]);
    }
    public function size(string $objectKey):int
    {
        return strlen($this->objects[$objectKey]??'');
    }
    public function delete(string $objectKey):bool
    {
        throw new RuntimeException('dispatch234.must_never_delete');
    }
}

final class BoundedReplicaDispatcherTest extends TestCase
{
    use RefreshDatabase;

    private Dispatch234MemoryStore $a;
    private Dispatch234MemoryStore $b;
    private CiphertextReplicaCoordinator $service;
    private BoundedReplicaDispatcher $dispatcher;
    private CarbonImmutable $clock;

    protected function setUp():void
    {
        parent::setUp();
        $this->a=new Dispatch234MemoryStore();
        $this->b=new Dispatch234MemoryStore();
        $this->service=new CiphertextReplicaCoordinator([
            'app_s3'=>[
                'adapter'=>$this->a,
                'failureDomain'=>'test-garage-a-domain',
                'credentialRevision'=>1,
            ],
            'replica_s3'=>[
                'adapter'=>$this->b,
                'failureDomain'=>'test-garage-b-domain',
                'credentialRevision'=>1,
            ],
        ]);
        $this->dispatcher=new BoundedReplicaDispatcher($this->service);
        $this->clock=CarbonImmutable::now('UTC')->addHour();
    }

    /** @return array{account:string,device:string} */
    private function identity():array
    {
        $account=(string)Str::uuid();
        $device=(string)Str::uuid();
        DB::table('identity_accounts')->insert([
            'id'=>$account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>$this->clock->addDay(),
            'created_at'=>$this->clock,'updated_at'=>$this->clock,
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$account,
            'signing_spki'=>'synthetic-dispatch-234-device',
            'created_at'=>$this->clock,'updated_at'=>$this->clock,
        ]);
        return compact('account','device');
    }

    /** @return array<string,mixed> */
    private function fixture(
        string $kind='photo',
        ?array $identity=null,
        int $size=2048,
    ):array {
        $who=$identity??$this->identity();
        $account=$who['account'];
        $device=$who['device'];
        $parent=(string)Str::uuid();
        $asset=(string)Str::uuid();
        $source=(string)Str::uuid();
        $target=(string)Str::uuid();
        $cipher=random_bytes($size);
        $sha=hash('sha256',$cipher);
        $sourceKey='cipher/p4-234-dispatch/'.$parent.'/'.$source;
        $targetKey='cipher/p4-234-dispatch/'.$parent.'/'.$target;

        if ($kind==='photo') {
            DB::table('photo_records')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),'state'=>'active',
                'expires_at'=>$this->clock->addDay()->getTimestampMs(),
                'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}',
                'signature'=>'synthetic',
                'created_at'=>$this->clock,'updated_at'=>$this->clock,
            ]);
            DB::table('photo_objects')->insert([
                'id'=>$asset,'photo_id'=>$parent,'kind'=>'master','revision'=>1,
                'bytes'=>strlen($cipher),'sha256'=>$sha,
                'manifest_json'=>'{}','object_key'=>$sourceKey,
                'state'=>'active',
                'created_at'=>$this->clock,'updated_at'=>$this->clock,
            ]);
            $table='storage_locations'; $fk='asset_id';
        } else {
            DB::table('media_files_v1')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),'media_type'=>'video',
                'state'=>'active',
                'expires_at'=>$this->clock->addDay()->getTimestampMs(),
                'plain_bytes'=>128,'cipher_bytes'=>strlen($cipher),
                'contract_hash'=>str_repeat('c',64),
                'contract_json'=>'{}','signature'=>'synthetic',
                'created_at'=>$this->clock,'updated_at'=>$this->clock,
            ]);
            DB::table('media_chunks_v1')->insert([
                'id'=>$asset,'media_id'=>$parent,
                'chunk_index'=>0,'kind'=>'data',
                'plain_bytes'=>128,'bytes'=>strlen($cipher),
                'sha256'=>$sha,'iv'=>'synthetic-iv',
                'state'=>'active',
                'created_at'=>$this->clock,'updated_at'=>$this->clock,
            ]);
            $table='media_chunk_locations_v1'; $fk='chunk_id';
        }

        foreach ([
            [$source,'app_s3',$sourceKey,'verified'],
            [$target,'replica_s3',$targetKey,'reserved'],
        ] as [$id,$provider,$key,$state]) {
            DB::table($table)->insert([
                'id'=>$id,$fk=>$asset,'provider'=>$provider,
                'object_key'=>$key,'sha256'=>$sha,
                'bytes'=>strlen($cipher),'state'=>$state,
                'created_at'=>$this->clock,'updated_at'=>$this->clock,
            ]);
        }
        $this->a->objects[$sourceKey]=$cipher;
        return compact('account','device','parent','asset','source','target',
            'sourceKey','targetKey','cipher','sha','size','kind','table');
    }

    /** @param array<string,mixed> $f */
    private function enqueue(array $f):array
    {
        return $this->service->enqueue(
            $f['account'],$f['kind'],$f['asset'],
            $f['source'],$f['target'],
            'dispatch234-request-'.$f['asset'],
            $this->clock,
        );
    }

    private function job(string $id):object
    {
        $row=DB::table('ciphertext_replication_jobs_v1')
            ->where('id',$id)->first();
        if ($row===null) throw new RuntimeException('dispatch234.job_missing');
        return $row;
    }

    public function test_due_photo_and_media_are_actually_replicated_once_with_explicit_batch():void
    {
        $a=$this->fixture();
        $b=$this->fixture('media_chunk');
        $one=$this->enqueue($a);
        $two=$this->enqueue($b);

        $result=$this->dispatcher->dispatch(
            $this->clock,maxJobs:2,maxBytes:8192,maxPerAccount:1);
        $this->assertSame(2,$result['invoked']);
        $this->assertSame(2,$result['observedVerified']);
        $this->assertSame(4096,$result['bytesBudgeted']);
        $this->assertTrue($result['noAutomaticScheduling']);
        $this->assertFalse($result['globalRateLimitEnforced']);
        $this->assertSame('verified',$this->job($one['jobId'])->state);
        $this->assertSame('verified',$this->job($two['jobId'])->state);
        $this->assertSame(2,$this->b->puts);
        $this->assertSame($a['cipher'],$this->b->objects[$a['targetKey']]);
        $this->assertSame($b['cipher'],$this->b->objects[$b['targetKey']]);
        $this->assertSame($a['cipher'],$this->a->objects[$a['sourceKey']]);
        $this->assertSame($b['cipher'],$this->a->objects[$b['sourceKey']]);
        $this->assertSame(0,$this->dispatcher->dispatch($this->clock)['invoked']);
    }

    public function test_one_account_cannot_starve_second_account_with_rank_one_fairness():void
    {
        $who=$this->identity();
        $first=$this->fixture('photo',$who);
        $second=$this->fixture('photo',$who);
        $foreign=$this->fixture();
        $one=$this->enqueue($first);
        $two=$this->enqueue($second);
        $three=$this->enqueue($foreign);

        $result=$this->dispatcher->dispatch(
            $this->clock,maxJobs:2,maxBytes:8192,maxPerAccount:1);
        $this->assertSame(2,$result['invoked']);
        $this->assertSame(2,$result['observedVerified']);
        $this->assertSame(2,$this->b->puts);
        $accountCompleted=(int)DB::table('ciphertext_replication_jobs_v1')
            ->where('account_id',$who['account'])->where('state','verified')
            ->count();
        $this->assertSame(1,$accountCompleted);
        $this->assertSame('verified',$this->job($three['jobId'])->state);
        $this->assertContains(
            $this->job($one['jobId'])->state,['queued','verified']);
        $this->assertContains(
            $this->job($two['jobId'])->state,['queued','verified']);
        $this->assertSame(1,DB::table('ciphertext_replication_jobs_v1')
            ->where('account_id',$who['account'])
            ->where('state','queued')->count());
    }

    public function test_complete_ciphertext_must_fit_remaining_byte_budget():void
    {
        $first=$this->fixture(size:1800);
        $second=$this->fixture(size:3500);
        $one=$this->enqueue($first);
        $two=$this->enqueue($second);
        $result=$this->dispatcher->dispatch(
            $this->clock,maxJobs:2,maxBytes:2000,maxPerAccount:1);
        $this->assertSame(1,$result['invoked']);
        $this->assertSame(1,$result['observedVerified']);
        $this->assertSame(1,$result['budgetSkipped']);
        $this->assertSame(1800,$result['bytesBudgeted']);
        $this->assertSame('verified',$this->job($one['jobId'])->state);
        $this->assertSame('queued',$this->job($two['jobId'])->state);
        $this->assertSame(1,$this->b->puts);
    }

    public function test_future_retry_is_not_dispatched_before_durable_due_time():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        DB::table('ciphertext_replication_jobs_v1')
            ->where('id',$job['jobId'])->update([
                'state'=>'retry',
                'attempts'=>1,
                'next_attempt_at'=>$this->clock->addMinutes(2),
            ]);
        $early=$this->dispatcher->dispatch($this->clock);
        $this->assertSame(0,$early['invoked']);
        $this->assertSame(0,$this->b->puts);
        $due=$this->dispatcher->dispatch($this->clock->addMinutes(3));
        $this->assertSame(1,$due['invoked']);
        $this->assertSame(1,$due['observedVerified']);
        $this->assertSame(2,(int)$this->job($job['jobId'])->attempts);
    }

    public function test_unexpired_leased_job_is_skipped_but_expired_lease_can_recover():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        DB::table('ciphertext_replication_jobs_v1')->where('id',$job['jobId'])
            ->update([
                'state'=>'leased','attempts'=>1,
                'lease_sha256'=>hash('sha256','previous-dispatcher-worker'),
                'lease_until'=>$this->clock->addSeconds(45),
            ]);
        $this->assertSame(0,$this->dispatcher->dispatch($this->clock)['invoked']);
        $this->assertSame(0,$this->b->puts);
        $recovered=$this->dispatcher->dispatch(
            $this->clock->addSeconds(50));
        $this->assertSame(1,$recovered['invoked']);
        $this->assertSame(1,$recovered['observedVerified']);
        $this->assertSame(2,(int)$this->job($job['jobId'])->attempts);
        $this->assertSame(1,$this->b->puts);
    }

    public function test_attempt_limit_filters_due_poison_job_without_faking_ack():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        DB::table('ciphertext_replication_jobs_v1')->where('id',$job['jobId'])
            ->update([
                'state'=>'retry','attempts'=>5,
                'next_attempt_at'=>$this->clock,
            ]);
        $skip=$this->dispatcher->dispatch(
            $this->clock,maxAttempts:5);
        $this->assertSame(0,$skip['invoked']);
        $this->assertSame(0,$skip['observedVerified']);
        $this->assertSame(0,$this->b->puts);
        $allow=$this->dispatcher->dispatch(
            $this->clock,maxAttempts:6);
        $this->assertSame(1,$allow['invoked']);
        $this->assertSame(1,$allow['observedVerified']);
        $this->assertSame(6,(int)$this->job($job['jobId'])->attempts);
    }

    public function test_retryable_provider_error_does_not_ack_and_other_account_may_continue():void
    {
        $f=$this->fixture();
        $job=$this->enqueue($f);
        $this->b->failPut=true;
        $result=$this->dispatcher->dispatch($this->clock);
        $this->assertSame(1,$result['invoked']);
        $this->assertSame(1,$result['observedRetry']);
        $this->assertSame(0,$result['observedVerified']);
        $this->assertSame('retry',$this->job($job['jobId'])->state);
        $this->assertSame('reserved',DB::table($f['table'])
            ->where('id',$f['target'])->value('state'));
        $this->b->failPut=false;
        $again=$this->dispatcher->dispatch($this->clock->addSeconds(5));
        $this->assertSame(0,$again['invoked']);
        $restored=$this->dispatcher->dispatch($this->clock->addSeconds(11));
        $this->assertSame(1,$restored['observedVerified']);
        $this->assertSame($f['cipher'],$this->b->objects[$f['targetKey']]);
    }

    public function test_revoked_owner_is_not_dispatched_and_unrelated_job_still_runs():void
    {
        $revoked=$this->fixture();
        $other=$this->fixture();
        $one=$this->enqueue($revoked);
        $two=$this->enqueue($other);
        DB::table('identity_accounts')->where('id',$revoked['account'])
            ->update(['status'=>'retired']);
        $result=$this->dispatcher->dispatch($this->clock,maxJobs:2);
        $this->assertSame(1,$result['invoked']);
        $this->assertSame(1,$result['observedVerified']);
        $this->assertSame('queued',$this->job($one['jobId'])->state);
        $this->assertSame('verified',$this->job($two['jobId'])->state);
        $this->assertArrayNotHasKey($revoked['targetKey'],$this->b->objects);
    }

    public function test_invalid_internal_batch_budgets_fail_closed():void
    {
        $cases=[
            [0,1000,1,5],[17,1000,1,5],
            [1,0,1,5],[1,64*1024*1024+1,1,5],
            [1,1000,0,5],[1,1000,3,5],
            [1,1000,1,0],[1,1000,1,13],
        ];
        foreach ($cases as [$maxJobs,$maxBytes,$perAccount,$maxAttempts]) {
            try {
                $this->dispatcher->dispatch(
                    $this->clock,$maxJobs,$maxBytes,$perAccount,$maxAttempts);
                $this->fail('accepted invalid dispatcher budget');
            } catch (RuntimeException $e) {
                $this->assertSame('replication.invalid_dispatch_limits',
                    $e->getMessage());
            }
        }
    }

    public function test_returned_counters_do_not_leak_account_ids_or_object_keys():void
    {
        $f=$this->fixture();
        $this->enqueue($f);
        $result=$this->dispatcher->dispatch($this->clock);
        $json=json_encode($result,JSON_THROW_ON_ERROR);
        foreach (['account','jobId','object','source','target','credential'] as $term) {
            $this->assertStringNotContainsString($term,$json);
        }
        $this->assertStringNotContainsString($f['account'],$json);
        $this->assertStringNotContainsString($f['sourceKey'],$json);
        $this->assertStringNotContainsString($f['targetKey'],$json);
        $this->assertTrue($result['noAutomaticScheduling']);
        $this->assertFalse($result['globalRateLimitEnforced']);
    }
}
