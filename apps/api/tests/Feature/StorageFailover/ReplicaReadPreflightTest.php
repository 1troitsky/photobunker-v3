<?php
declare(strict_types=1);

namespace Tests\Feature\StorageFailover;

use App\Storage\Failover\ReplicaReadPreflight;
use App\Storage\StorageAdapter;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

final class FailoverFakeAdapter implements StorageAdapter
{
    /** @var array<string,string> */
    public array $objects=[];
    public int $reads=0;
    public int $otherCalls=0;
    public bool $offline=false;
    public ?\Closure $onRead=null;

    public function putStream(string $objectKey,mixed $stream):bool
    {
        $this->otherCalls++;
        throw new RuntimeException('test.no_put');
    }

    public function readStream(string $objectKey):mixed
    {
        $this->reads++;
        if ($this->offline) throw new RuntimeException('secret.endpoint.should.not_leak');
        if ($this->onRead!==null) ($this->onRead)();
        if (!array_key_exists($objectKey,$this->objects)) return null;
        $h=fopen('php://temp','w+b');
        fwrite($h,$this->objects[$objectKey]);
        rewind($h);
        return $h;
    }

    public function exists(string $objectKey):bool
    {
        $this->otherCalls++;
        if ($this->offline) throw new RuntimeException('secret.endpoint.should.not_leak');
        return array_key_exists($objectKey,$this->objects);
    }

    public function size(string $objectKey):int
    {
        $this->otherCalls++;
        if ($this->offline) throw new RuntimeException('secret.endpoint.should.not_leak');
        return strlen($this->objects[$objectKey]??'');
    }

    public function delete(string $objectKey):bool
    {
        $this->otherCalls++;
        throw new RuntimeException('test.no_delete');
    }
}

/**
 * Real DB predicates + synthetic independent ciphertext transports.
 * NOT an S3 outage/production activation test. No HTTP, routes or live switch.
 */
final class ReplicaReadPreflightTest extends TestCase
{
    use RefreshDatabase;

    private FailoverFakeAdapter $primary;
    private FailoverFakeAdapter $replica;

    protected function setUp():void
    {
        parent::setUp();
        $this->primary=new FailoverFakeAdapter();
        $this->replica=new FailoverFakeAdapter();
    }

    private function clock():CarbonImmutable
    {
        return CarbonImmutable::parse('2026-11-14T12:00:00Z');
    }

    private function preflight(
        string $primaryDomain='primary-domain',
        string $replicaDomain='independent-replica-domain'
    ):ReplicaReadPreflight {
        return new ReplicaReadPreflight([
            'app_s3'=>[
                'adapter'=>$this->primary,
                'failureDomain'=>$primaryDomain,
                'credentialRevision'=>1,
            ],
            'user_s3'=>[
                'adapter'=>$this->replica,
                'failureDomain'=>$replicaDomain,
                'credentialRevision'=>2,
            ],
        ]);
    }

    private function account():array
    {
        $a=(string)Str::uuid();
        $d=(string)Str::uuid();
        $now=$this->clock();
        DB::table('identity_accounts')->insert([
            'id'=>$a,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>$now->addDay(),
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$d,'account_id'=>$a,
            'signing_spki'=>'failover-synthetic-test',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        return [$a,$d];
    }

    /** @return array<string,string> */
    private function fixture(string $kind='photo'):array
    {
        [$account,$device]=$this->account();
        $parent=(string)Str::uuid();
        $asset=(string)Str::uuid();
        $source=(string)Str::uuid();
        $target=(string)Str::uuid();
        $cipher=random_bytes(313);
        $sha=hash('sha256',$cipher);
        $now=$this->clock();
        $photo=$kind==='photo';
        $prefix=$photo?'cipher/v1/':'cipher/media/v1/';
        $sourceKey=$prefix.$account.'/'.$parent.'/'.$source;
        $targetKey=$prefix.$account.'/'.$parent.'/'.$target;
        if ($photo) {
            DB::table('photo_records')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),
                'state'=>'active','expires_at'=>$now->addDay()->getTimestampMs(),
                'contract_hash'=>str_repeat('a',64),
                'contract_json'=>'{}','signature'=>'synthetic',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('photo_objects')->insert([
                'id'=>$asset,'photo_id'=>$parent,'kind'=>'master','revision'=>1,
                'bytes'=>strlen($cipher),'sha256'=>$sha,'manifest_json'=>'{}',
                'object_key'=>$sourceKey,'state'=>'active',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
        } else {
            DB::table('media_files_v1')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),'media_type'=>'video',
                'state'=>'active','expires_at'=>$now->addDay()->getTimestampMs(),
                'plain_bytes'=>100,'cipher_bytes'=>strlen($cipher),
                'contract_hash'=>str_repeat('b',64),
                'contract_json'=>'{}','signature'=>'synthetic',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('media_chunks_v1')->insert([
                'id'=>$asset,'media_id'=>$parent,'chunk_index'=>0,'kind'=>'data',
                'plain_bytes'=>100,'bytes'=>strlen($cipher),
                'sha256'=>$sha,'iv'=>'synthetic-nonce',
                'state'=>'active','created_at'=>$now,'updated_at'=>$now,
            ]);
        }
        $table=$photo?'storage_locations':'media_chunk_locations_v1';
        $fk=$photo?'asset_id':'chunk_id';
        foreach ([
            [$source,'app_s3',$sourceKey],
            [$target,'user_s3',$targetKey],
        ] as [$id,$provider,$key]) {
            DB::table($table)->insert([
                'id'=>$id,$fk=>$asset,'provider'=>$provider,
                'object_key'=>$key,'sha256'=>$sha,'bytes'=>strlen($cipher),
                'state'=>'verified','created_at'=>$now,'updated_at'=>$now,
            ]);
        }
        $this->replica->objects[$targetKey]=$cipher;
        return compact('kind','account','parent','asset','source','target',
            'sourceKey','targetKey','cipher','sha');
    }

    /** @param array<string,string> $f */
    private function inspect(array $f,?string $account=null):array
    {
        return $this->preflight()->inspect(
            $account??$f['account'],$f['kind'],$f['asset'],
            $f['source'],$f['target'],$this->clock());
    }

    /** @param callable():mixed $cb */
    private function deny(callable $cb,string $reason):void
    {
        try {
            $cb();
            $this->fail('Expected fail-closed denial: '.$reason);
        } catch (RuntimeException $e) {
            $this->assertSame($reason,$e->getMessage());
        }
    }

    public function test_primary_outage_does_not_prevent_verified_replica_preflight():void
    {
        foreach (['photo','media_chunk'] as $kind) {
            $f=$this->fixture($kind);
            $this->primary->offline=true;
            $proof=$this->inspect($f);
            $this->assertSame('replica_physical_preflight_only',$proof['status']);
            $this->assertTrue($proof['physicallyVerified']);
            $this->assertFalse($proof['failoverAuthorized']);
            $this->assertSame($f['sha'],$proof['ciphertextSha256']);
            $this->assertSame(strlen($f['cipher']),$proof['ciphertextBytes']);
            $this->assertSame(0,$this->primary->otherCalls);
            $this->assertSame(0,$this->primary->reads);
        }
        $this->assertSame(2,$this->replica->reads);
    }

    public function test_wrong_account_expiry_tombstone_and_revocation_are_denied():void
    {
        $f=$this->fixture();
        [$foreign]=$this->account();
        $this->deny(fn()=>$this->inspect($f,$foreign),'failover.asset_unavailable');
        DB::table('photo_records')->where('id',$f['parent'])
            ->update(['expires_at'=>$this->clock()->subSecond()->getTimestampMs()]);
        $this->deny(fn()=>$this->inspect($f),'failover.expired');
        DB::table('photo_records')->where('id',$f['parent'])
            ->update(['expires_at'=>$this->clock()->addDay()->getTimestampMs()]);
        DB::table('photo_tombstones')->insert([
            'photo_id'=>$f['parent'],'created_at'=>$this->clock(),
        ]);
        $this->deny(fn()=>$this->inspect($f),'failover.deleted');
        DB::table('photo_tombstones')->where('photo_id',$f['parent'])->delete();
        DB::table('identity_accounts')->where('id',$f['account'])
            ->update(['status'=>'retired']);
        $this->deny(fn()=>$this->inspect($f),'failover.asset_unavailable');
        $this->assertSame(0,$this->replica->reads);
    }

    public function test_same_failure_domain_and_unverified_or_stale_location_denied():void
    {
        $f=$this->fixture();
        $this->deny(fn()=>$this->preflight('same','same')->inspect(
            $f['account'],$f['kind'],$f['asset'],$f['source'],
            $f['target'],$this->clock()),'failover.same_failure_domain');
        DB::table('storage_locations')->where('id',$f['target'])
            ->update(['state'=>'reserved']);
        $this->deny(fn()=>$this->inspect($f),'failover.location_not_verified');
        DB::table('storage_locations')->where('id',$f['target'])
            ->update(['state'=>'verified','sha256'=>str_repeat('f',64)]);
        $this->deny(fn()=>$this->inspect($f),'failover.location_mismatch');
        $this->assertSame(0,$this->replica->reads);
    }

    public function test_missing_corrupt_or_unavailable_remote_ciphertext_rejected():void
    {
        $f=$this->fixture('media_chunk');
        unset($this->replica->objects[$f['targetKey']]);
        $this->deny(fn()=>$this->inspect($f),'failover.replica_read_unverified');
        $this->replica->objects[$f['targetKey']]=str_repeat('X',strlen($f['cipher']));
        $this->deny(fn()=>$this->inspect($f),'failover.replica_read_unverified');
        $this->replica->objects[$f['targetKey']]='short';
        $this->deny(fn()=>$this->inspect($f),'failover.replica_read_unverified');
        $this->replica->offline=true;
        $this->deny(fn()=>$this->inspect($f),'failover.replica_read_unverified');
    }

    public function test_mutation_during_remote_read_and_delete_race_fails_closed():void
    {
        $f=$this->fixture();
        $this->replica->onRead=static function()use($f):void {
            DB::table('storage_locations')->where('id',$f['target'])
                ->update(['updated_at'=>'2026-11-14 12:00:13']);
        };
        $this->deny(fn()=>$this->inspect($f),'failover.changed_during_read');

        $g=$this->fixture('media_chunk');
        $this->replica->onRead=static function()use($g):void {
            DB::table('media_tombstones_v1')->insert([
                'media_id'=>$g['parent'],'created_at'=>CarbonImmutable::parse('2026-11-14T12:00:00Z'),
            ]);
        };
        $this->deny(fn()=>$this->inspect($g),'failover.deleted');
    }

    public function test_no_valid_registry_or_identifiers_can_trigger_transport_access():void
    {
        $f=$this->fixture();
        $bad=new ReplicaReadPreflight(['user_s3'=>[
            'adapter'=>$this->replica,
            'failureDomain'=>'unknown',
            'credentialRevision'=>0,
        ]]);
        $this->deny(fn()=>$bad->inspect(
            $f['account'],$f['kind'],$f['asset'],$f['source'],$f['target'],
            $this->clock()),'failover.untrusted_transport');
        $this->deny(fn()=>$this->preflight()->inspect(
            $f['account'],$f['kind'],'not-a-uuid',$f['source'],$f['target'],
            $this->clock()),'failover.invalid_identity');
        $this->assertSame(0,$this->replica->reads);
        $this->assertSame(0,$this->replica->otherCalls);
    }
}
