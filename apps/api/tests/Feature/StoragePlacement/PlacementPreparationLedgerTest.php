<?php
declare(strict_types=1);

namespace Tests\Feature\StoragePlacement;

use App\Storage\Placement\PlacementPreparationLedger;
use App\Storage\Placement\PlacementReadiness;
use App\Storage\StorageAdapter;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * Purely synthetic ciphertext transport. Its read bytes are real, but this
 * does NOT simulate an independent production S3 fault domain or a
 * StorageManager uploader which participates in a writer fence.
 */
final class CandidateTestStore implements StorageAdapter
{
    /** @var array<string,string> */
    public array $ciphertext = [];
    public int $reads = 0;
    public $onRead = null;

    public function putStream(string $key, mixed $stream): bool
    {
        throw new RuntimeException('test.candidate_must_never_put');
    }
    public function readStream(string $key): mixed
    {
        $this->reads++;
        if ($this->onRead !== null) {
            ($this->onRead)();
        }
        if (!array_key_exists($key,$this->ciphertext)) {
            return null;
        }
        $f=fopen('php://temp','w+b');
        if (!is_resource($f)) {
            throw new RuntimeException('test.cannot_open_stream');
        }
        fwrite($f,$this->ciphertext[$key]);
        rewind($f);
        return $f;
    }
    public function exists(string $key): bool
    {
        return array_key_exists($key,$this->ciphertext);
    }
    public function size(string $key): int
    {
        return strlen($this->ciphertext[$key]??'');
    }
    public function delete(string $key): bool
    {
        throw new RuntimeException('test.candidate_must_never_delete');
    }
}

final class PlacementPreparationLedgerTest extends TestCase
{
    use RefreshDatabase;

    private CandidateTestStore $a;
    private CandidateTestStore $b;
    private PlacementPreparationLedger $ledger;

    protected function setUp(): void
    {
        parent::setUp();
        $this->a=new CandidateTestStore();
        $this->b=new CandidateTestStore();
        $preflight=new PlacementReadiness([
            'app_s3'=>[
                'adapter'=>$this->a,'failureDomain'=>'garage-a-domain-01',
                'credentialRevision'=>1,
            ],
            'user_s3'=>[
                'adapter'=>$this->b,'failureDomain'=>'garage-b-domain-02',
                'credentialRevision'=>2,
            ],
        ]);
        $this->ledger=new PlacementPreparationLedger($preflight);
    }

    private function at(): CarbonImmutable
    {
        return CarbonImmutable::parse('2026-11-14T12:00:00Z');
    }

    /** @return array{0:string,1:string} */
    private function identity(): array
    {
        $now=$this->at();
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
            'signing_spki'=>'placement-sidecar-test-device',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        return [$account,$device];
    }

    /** @return array<string,mixed> */
    private function fixture(string $kind='photo',?array $identity=null): array
    {
        [$account,$device]=$identity??$this->identity();
        $now=$this->at();
        $parent=(string)Str::uuid();
        $asset=(string)Str::uuid();
        $source=(string)Str::uuid();
        $target=(string)Str::uuid();
        $cipher=random_bytes($kind==='photo'?257:601);
        $sha=hash('sha256',$cipher);
        $sourceKey='cipher/placement-candidate/'.$parent.'/'.$source;
        $targetKey='cipher/placement-candidate/'.$parent.'/'.$target;

        if ($kind==='photo') {
            DB::table('photo_records')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),'state'=>'active',
                'expires_at'=>$now->addDay()->getTimestampMs(),
                'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}',
                'signature'=>'synthetic','created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('photo_objects')->insert([
                'id'=>$asset,'photo_id'=>$parent,'kind'=>'master',
                'revision'=>1,'bytes'=>strlen($cipher),'sha256'=>$sha,
                'manifest_json'=>'{}','object_key'=>$sourceKey,
                'state'=>'active','created_at'=>$now,'updated_at'=>$now,
            ]);
            $table='storage_locations';
            $fk='asset_id';
        } else {
            DB::table('media_files_v1')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),'media_type'=>'video',
                'state'=>'active','expires_at'=>$now->addDay()->getTimestampMs(),
                'plain_bytes'=>200,'cipher_bytes'=>strlen($cipher),
                'contract_hash'=>str_repeat('c',64),
                'contract_json'=>'{}','signature'=>'synthetic',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            DB::table('media_chunks_v1')->insert([
                'id'=>$asset,'media_id'=>$parent,'chunk_index'=>0,'kind'=>'data',
                'plain_bytes'=>200,'bytes'=>strlen($cipher),
                'sha256'=>$sha,'iv'=>'synthetic-iv','state'=>'active',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
            $table='media_chunk_locations_v1';
            $fk='chunk_id';
        }
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
        $this->a->ciphertext[$sourceKey]=$cipher;
        $this->b->ciphertext[$targetKey]=$cipher;
        return compact('kind','account','device','parent','asset',
            'source','target','sourceKey','targetKey','cipher','sha','table');
    }

    /** @param array<string,mixed> $f */
    private function prepare(
        array $f,int $expected=0,
        string $key='candidate-request-00000001',
        bool $reverse=false,
    ): array {
        return $this->ledger->prepare(
            $f['account'],$f['kind'],$f['asset'],
            $reverse?$f['target']:$f['source'],
            $reverse?$f['source']:$f['target'],
            $expected,$key,$this->at(),
        );
    }

    /** @param callable():mixed $fn */
    private function denied(callable $fn,string $reason): void
    {
        try {
            $fn();
            $this->fail('Expected a failed closed placement candidate: '.$reason);
        } catch (RuntimeException $e) {
            $this->assertSame($reason,$e->getMessage());
        }
    }

    private function countRows(): int
    {
        return DB::table('placement_candidate_preparations_v1')->count();
    }

    public function test_photo_candidate_is_durable_and_does_not_mutate_live_storage(): void
    {
        $f=$this->fixture();
        $original=DB::table($f['table'])
            ->whereIn('id',[$f['source'],$f['target']])
            ->orderBy('id')->get()->toArray();
        $candidate=$this->prepare($f);

        $this->assertSame('durable_candidate_only',$candidate['status']);
        $this->assertFalse($candidate['switchAuthorized']);
        $this->assertSame('prepared',$candidate['state']);
        $this->assertSame(1,$candidate['generation']);
        $this->assertSame($f['sha'],$candidate['ciphertextSha256']);
        $this->assertSame(1,$this->countRows());
        $this->assertSame(1,$this->a->reads);
        $this->assertSame(1,$this->b->reads);
        $this->assertEquals($original,DB::table($f['table'])
            ->whereIn('id',[$f['source'],$f['target']])
            ->orderBy('id')->get()->toArray());
        $this->assertSame(hash('sha256','candidate-request-00000001'),
            DB::table('placement_candidate_preparations_v1')
                ->value('idempotency_sha256'));
    }

    public function test_replayed_same_key_returns_same_original_candidate_without_increment():void
    {
        $f=$this->fixture();
        $first=$this->prepare($f);
        $replay=$this->prepare($f);
        $this->assertSame($first,$replay);
        $this->assertSame(1,$this->countRows());
        $this->assertSame(2,$this->a->reads);
        $this->assertSame(2,$this->b->reads);
    }

    public function test_competing_new_keys_cannot_overwrite_active_candidate(): void
    {
        $f=$this->fixture();
        $this->prepare($f);
        $this->denied(fn()=>$this->prepare($f,0,'candidate-request-00000002'),
            'placement.stale_generation');
        $this->denied(fn()=>$this->prepare($f,1,'candidate-request-00000002'),
            'placement.candidate_already_prepared');
        $this->assertSame(1,$this->countRows());
    }

    public function test_same_key_reversed_source_and_target_is_explicit_idempotency_conflict():void
    {
        $f=$this->fixture();
        $this->prepare($f);
        $this->denied(fn()=>$this->prepare($f,0,
            'candidate-request-00000001',true),'placement.idempotency_conflict');
        $this->assertSame(1,$this->countRows());
    }

    public function test_abandon_is_idempotent_and_next_candidate_requires_exact_generation():void
    {
        $f=$this->fixture();
        $first=$this->prepare($f);
        $abandoned=$this->ledger->abandon(
            $f['account'],$f['kind'],$f['asset'],1,
            'candidate-request-00000001',$this->at());
        $this->assertSame('abandoned',$abandoned['state']);
        $again=$this->ledger->abandon(
            $f['account'],$f['kind'],$f['asset'],1,
            'candidate-request-00000001',$this->at());
        $this->assertSame($abandoned,$again);
        $this->denied(fn()=>$this->prepare($f,0,
            'candidate-request-00000002'),'placement.stale_generation');
        $this->denied(fn()=>$this->prepare($f,0),
            'placement.idempotency_consumed');
        $second=$this->prepare($f,1,'candidate-request-00000002');
        $this->assertSame(2,$second['generation']);
        $this->assertNotSame($first['candidateId'],$second['candidateId']);
        $this->assertSame(2,$this->countRows());
        $this->denied(fn()=>$this->ledger->abandon(
            $f['account'],$f['kind'],$f['asset'],1,
            'candidate-request-00000001',$this->at()),
            'placement.candidate_not_current');
        $this->denied(fn()=>$this->prepare($f,0),
            'placement.idempotency_consumed');
    }

    public function test_cross_account_and_cross_asset_key_reuse_fail_closed():void
    {
        $identity=$this->identity();
        $f=$this->fixture('photo',$identity);
        $other=$this->fixture('photo',$identity);
        $first=$this->prepare($f);
        $this->denied(fn()=>$this->prepare($other),
            'placement.idempotency_conflict');
        [$foreign]=$this->identity();
        $this->denied(fn()=>$this->ledger->prepare(
            $foreign,'photo',$f['asset'],$f['source'],$f['target'],
            0,'candidate-request-00000001',$this->at()),
            'placement.not_found');
        $this->denied(fn()=>$this->ledger->abandon(
            $foreign,'photo',$f['asset'],1,
            'candidate-request-00000001',$this->at()),
            'placement.candidate_not_current');
        $this->assertSame($first['candidateId'],
            DB::table('placement_candidate_preparations_v1')->value('id'));
        $this->assertSame(1,$this->countRows());
    }

    public function test_distinct_accounts_can_use_same_client_key_without_aliasing():void
    {
        $a=$this->fixture();
        $b=$this->fixture();
        $first=$this->prepare($a);
        $second=$this->prepare($b);
        $this->assertSame(2,$this->countRows());
        $this->assertNotSame($first['candidateId'],$second['candidateId']);
    }

    public function test_media_chunk_candidate_uses_real_media_ownership_and_location_table():void
    {
        $f=$this->fixture('media_chunk');
        $candidate=$this->prepare($f);
        $this->assertSame('media_chunk',$candidate['kind']);
        $this->assertSame('prepared',$candidate['state']);
        $this->assertSame(1,$candidate['generation']);
        $this->assertSame(2,DB::table('media_chunk_locations_v1')
            ->where('chunk_id',$f['asset'])->count());
        $this->assertSame(1,$this->countRows());
    }

    public function test_corrupted_physical_destination_never_creates_durable_candidate():void
    {
        $f=$this->fixture();
        $corrupt=$f['cipher'];
        $corrupt[23]=chr(ord($corrupt[23])^1);
        $this->b->ciphertext[$f['targetKey']]=$corrupt;
        $this->denied(fn()=>$this->prepare($f),
            'placement.ciphertext_not_verified');
        $this->assertSame(0,$this->countRows());
        $this->assertSame($f['cipher'],$this->a->ciphertext[$f['sourceKey']]);
    }

    public function test_tombstones_expiry_and_pending_asset_never_create_candidate(): void
    {
        $f=$this->fixture();
        DB::table('photo_objects')->where('id',$f['asset'])
            ->update(['state'=>'uploading']);
        $this->denied(fn()=>$this->prepare($f),
            'placement.in_flight_or_inactive');
        DB::table('photo_objects')->where('id',$f['asset'])
            ->update(['state'=>'active']);
        DB::table('photo_records')->where('id',$f['parent'])
            ->update(['expires_at'=>$this->at()->getTimestampMs()]);
        $this->denied(fn()=>$this->prepare($f),
            'placement.expired');
        DB::table('photo_records')->where('id',$f['parent'])
            ->update(['expires_at'=>$this->at()->addDay()->getTimestampMs()]);
        DB::table('photo_tombstones')->insert([
            'photo_id'=>$f['parent'],'account_id'=>$f['account'],
            'operation_id'=>(string)Str::uuid(),'reason'=>'owner',
            'object_keys'=>'[]','created_at'=>$this->at(),
        ]);
        $this->denied(fn()=>$this->prepare($f),
            'placement.deleted');
        $this->assertSame(0,$this->countRows());
    }

    public function test_mid_read_owner_retirement_is_not_persisted(): void
    {
        $f=$this->fixture();
        $this->b->onRead=function()use($f):void {
            DB::table('identity_accounts')->where('id',$f['account'])
                ->update(['status'=>'retired']);
        };
        $this->denied(fn()=>$this->prepare($f),
            'placement.changed_during_preflight');
        $this->assertSame(0,$this->countRows());
    }

    public function test_stale_replay_generation_and_invalid_operation_ids_rejected():void
    {
        $f=$this->fixture();
        $this->prepare($f);
        $this->denied(fn()=>$this->prepare($f,1),
            'placement.stale_generation');
        $this->denied(fn()=>$this->ledger->prepare(
            $f['account'],'photo',$f['asset'],$f['source'],$f['target'],
            -1,'candidate-request-00000001',$this->at()),
            'placement.invalid_candidate_request');
        $this->denied(fn()=>$this->ledger->prepare(
            $f['account'],'photo',$f['asset'],$f['source'],$f['target'],
            0,'short',$this->at()),
            'placement.invalid_candidate_request');
        $this->assertSame(1,$this->countRows());
    }
}
