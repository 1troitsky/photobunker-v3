<?php
declare(strict_types=1);

namespace Tests\Feature\StoragePlacement;

use App\Storage\Placement\PlacementReadiness;
use App\Storage\StorageAdapter;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * A deliberately separate ciphertext transport and failure domain.
 *
 * Synthetic in-memory stores make the physical-readback contract observable.
 * They are NOT evidence of two real S3 accounts, distinct cloud regions,
 * valid BYO TLS endpoint pinning, or safe production provider credentials.
 */
final class TestCipherStore implements StorageAdapter
{
    /** @var array<string,string> */
    public array $objects = [];
    public int $reads = 0;
    public $onRead = null;

    public function putStream(string $objectKey, mixed $stream): bool
    {
        throw new RuntimeException('test.must_not_write');
    }

    public function readStream(string $objectKey): mixed
    {
        $this->reads++;
        if ($this->onRead !== null) {
            ($this->onRead)();
        }
        if (!isset($this->objects[$objectKey])) {
            return null;
        }
        $handle = fopen('php://temp', 'w+b');
        fwrite($handle, $this->objects[$objectKey]);
        rewind($handle);
        return $handle;
    }

    public function exists(string $objectKey): bool
    {
        return array_key_exists($objectKey, $this->objects);
    }

    public function size(string $objectKey): int
    {
        return strlen($this->objects[$objectKey] ?? '');
    }

    public function delete(string $objectKey): bool
    {
        throw new RuntimeException('test.must_not_delete');
    }
}

final class PlacementReadinessTest extends TestCase
{
    use RefreshDatabase;

    private TestCipherStore $appStore;
    private TestCipherStore $byoStore;

    protected function setUp(): void
    {
        parent::setUp();
        $this->appStore = new TestCipherStore();
        $this->byoStore = new TestCipherStore();
    }

    private function clock(): CarbonImmutable
    {
        return CarbonImmutable::parse('2026-11-14T12:00:00Z');
    }

    private function account(): array
    {
        $account = (string) Str::uuid();
        $device = (string) Str::uuid();
        $now = $this->clock();
        DB::table('identity_accounts')->insert([
            'id' => $account,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'reserved_until' => $now->addDay(),
            'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('identity_devices')->insert([
            'id' => $device,
            'account_id' => $account,
            'signing_spki' => 'storage-placement-isolated-fixture',
            'created_at' => $now, 'updated_at' => $now,
        ]);
        return [$account, $device];
    }

    private function preflight(?string $sameDomain = null): PlacementReadiness
    {
        return new PlacementReadiness([
            'app_s3' => [
                'adapter' => $this->appStore,
                'failureDomain' => 'app-garage-domain-01',
                'credentialRevision' => 1,
            ],
            'user_s3' => [
                'adapter' => $this->byoStore,
                'failureDomain' => $sameDomain ?? 'user-bucket-domain-02',
                'credentialRevision' => 3,
            ],
        ]);
    }

    /** @return array{account:string,parent:string,asset:string,source:string,target:string,sourceKey:string,targetKey:string,cipher:string} */
    private function photoFixture(
        string $parentState = 'active',
        string $assetState = 'active',
        ?string $account = null,
        ?string $device = null,
    ): array {
        if ($account === null || $device === null) {
            [$account, $device] = $this->account();
        }
        $now = $this->clock();
        $parent = (string)Str::uuid();
        $asset = (string)Str::uuid();
        $source = (string)Str::uuid();
        $target = (string)Str::uuid();
        $cipher = random_bytes(257);
        $sha = hash('sha256', $cipher);
        $sourceKey = 'cipher/v1/'.$account.'/'.$parent.'/'.$source;
        $targetKey = 'cipher/v1/'.$account.'/'.$parent.'/'.$target;
        DB::table('photo_records')->insert([
            'id'=>$parent, 'account_id'=>$account, 'device_id'=>$device,
            'operation_id'=>(string)Str::uuid(), 'state'=>$parentState,
            'expires_at'=>$now->addDay()->getTimestampMs(),
            'contract_hash'=>str_repeat('a',64), 'contract_json'=>'{}',
            'signature'=>'synthetic', 'created_at'=>$now, 'updated_at'=>$now,
        ]);
        DB::table('photo_objects')->insert([
            'id'=>$asset, 'photo_id'=>$parent, 'kind'=>'master',
            'revision'=>1, 'bytes'=>strlen($cipher), 'sha256'=>$sha,
            'manifest_json'=>'{}', 'object_key'=>$sourceKey,
            'state'=>$assetState, 'created_at'=>$now, 'updated_at'=>$now,
        ]);
        foreach ([
            [$source, 'app_s3', $sourceKey],
            [$target, 'user_s3', $targetKey],
        ] as [$id, $provider, $key]) {
            DB::table('storage_locations')->insert([
                'id'=>$id, 'asset_id'=>$asset, 'provider'=>$provider,
                'object_key'=>$key, 'sha256'=>$sha, 'bytes'=>strlen($cipher),
                'state'=>'verified', 'created_at'=>$now, 'updated_at'=>$now,
            ]);
        }
        $this->appStore->objects[$sourceKey] = $cipher;
        $this->byoStore->objects[$targetKey] = $cipher;
        return compact('account','parent','asset','source','target',
            'sourceKey','targetKey','cipher');
    }

    /** @return array{account:string,parent:string,asset:string,source:string,target:string,sourceKey:string,targetKey:string,cipher:string} */
    private function mediaFixture(): array
    {
        [$account,$device] = $this->account();
        $now = $this->clock();
        $parent = (string)Str::uuid();
        $asset = (string)Str::uuid();
        $source = (string)Str::uuid();
        $target = (string)Str::uuid();
        $cipher = random_bytes(413);
        $sha = hash('sha256', $cipher);
        $sourceKey = 'cipher/media/v1/'.$account.'/'.$parent.'/'.$source;
        $targetKey = 'cipher/media/v1/'.$account.'/'.$parent.'/'.$target;
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
            'id'=>$asset,'media_id'=>$parent,'chunk_index'=>0,
            'kind'=>'data','plain_bytes'=>100,'bytes'=>strlen($cipher),
            'sha256'=>$sha,'iv'=>'fixture-nonce','state'=>'active',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        foreach ([
            [$source,'app_s3',$sourceKey],[$target,'user_s3',$targetKey],
        ] as [$id,$provider,$key]) {
            DB::table('media_chunk_locations_v1')->insert([
                'id'=>$id,'chunk_id'=>$asset,'provider'=>$provider,
                'object_key'=>$key,'sha256'=>$sha,'bytes'=>strlen($cipher),
                'state'=>'verified','created_at'=>$now,'updated_at'=>$now,
            ]);
        }
        $this->appStore->objects[$sourceKey] = $cipher;
        $this->byoStore->objects[$targetKey] = $cipher;
        return compact('account','parent','asset','source','target',
            'sourceKey','targetKey','cipher');
    }

    /** @param callable():mixed $call */
    private function denies(callable $call, string $reason): void
    {
        try {
            $call();
            $this->fail('Read-only placement preflight should deny: '.$reason);
        } catch (RuntimeException $e) {
            $this->assertSame($reason, $e->getMessage());
        }
    }

    /** @param array<string,string> $f */
    private function photo(array $f, ?string $account = null): array
    {
        return $this->preflight()->photo(
            $account ?? $f['account'], $f['asset'],
            $f['source'], $f['target'], $this->clock());
    }

    public function test_two_independent_copies_are_actually_read_and_never_promoted(): void
    {
        $f = $this->photoFixture();
        $before = DB::table('storage_locations')->where('asset_id',$f['asset'])
            ->orderBy('id')->get()->toArray();
        $result = $this->photo($f);
        $this->assertSame('physical_preflight_only', $result['status']);
        $this->assertFalse($result['switchAuthorized']);
        $this->assertSame($f['account'],$result['accountId']);
        $this->assertSame(hash('sha256',$f['cipher']),$result['ciphertextSha256']);
        $this->assertSame(3,$result['targetCredentialRevision']);
        $this->assertSame(1,$this->appStore->reads);
        $this->assertSame(1,$this->byoStore->reads);
        $this->assertEquals($before,DB::table('storage_locations')
            ->where('asset_id',$f['asset'])->orderBy('id')->get()->toArray());
    }

    public function test_media_chunk_uses_actual_media_ownership_and_verified_ciphertext(): void
    {
        $f = $this->mediaFixture();
        $result = $this->preflight()->mediaChunk(
            $f['account'],$f['asset'],$f['source'],$f['target'],$this->clock());
        $this->assertSame('media_chunk',$result['kind']);
        $this->assertFalse($result['switchAuthorized']);
        $this->assertSame(hash('sha256',$f['cipher']),$result['ciphertextSha256']);
        $this->assertSame(1,$this->appStore->reads);
        $this->assertSame(1,$this->byoStore->reads);
    }

    public function test_cross_account_and_cross_asset_location_ids_are_denied(): void
    {
        $f = $this->photoFixture();
        [$other] = $this->account();
        $this->denies(fn()=>$this->photo($f,$other),'placement.not_found');
        $otherFile = $this->photoFixture();
        $this->denies(fn()=>$this->preflight()->photo(
            $f['account'],$f['asset'],$f['source'],$otherFile['target'],$this->clock()
        ),'placement.location_not_found');
        $this->assertSame(0,$this->appStore->reads);
        $this->assertSame(0,$this->byoStore->reads);
    }

    public function test_pending_upload_deleted_expired_and_unready_identity_are_denied(): void
    {
        $f = $this->photoFixture('pending');
        $this->denies(fn()=>$this->photo($f),'placement.in_flight_or_inactive');
        DB::table('photo_records')->where('id',$f['parent'])->update(['state'=>'active']);
        DB::table('photo_objects')->where('id',$f['asset'])->update(['state'=>'uploading']);
        $this->denies(fn()=>$this->photo($f),'placement.in_flight_or_inactive');
        DB::table('photo_objects')->where('id',$f['asset'])->update(['state'=>'active']);
        DB::table('photo_records')->where('id',$f['parent'])
            ->update(['expires_at'=>$this->clock()->getTimestampMs()]);
        $this->denies(fn()=>$this->photo($f),'placement.expired');
        DB::table('photo_records')->where('id',$f['parent'])
            ->update(['expires_at'=>$this->clock()->addDay()->getTimestampMs()]);
        DB::table('photo_tombstones')->insert([
            'photo_id'=>$f['parent'],'account_id'=>$f['account'],
            'operation_id'=>(string)Str::uuid(),'reason'=>'owner',
            'object_keys'=>'[]','cleanup_until'=>$this->clock()->addDay(),
            'created_at'=>$this->clock(),
        ]);
        $this->denies(fn()=>$this->photo($f),'placement.deleted');
        DB::table('photo_tombstones')->where('photo_id',$f['parent'])->delete();
        DB::table('identity_accounts')->where('id',$f['account'])
            ->update(['status'=>'retired']);
        $this->denies(fn()=>$this->photo($f),'placement.not_found');
        $this->assertSame(0,$this->appStore->reads);
    }

    public function test_media_tombstone_and_in_flight_media_are_denied(): void
    {
        $f = $this->mediaFixture();
        DB::table('media_chunks_v1')->where('id',$f['asset'])
            ->update(['state'=>'pending']);
        $this->denies(fn()=>$this->preflight()->mediaChunk(
            $f['account'],$f['asset'],$f['source'],$f['target'],$this->clock()
        ),'placement.in_flight_or_inactive');
        DB::table('media_chunks_v1')->where('id',$f['asset'])
            ->update(['state'=>'verified']);
        DB::table('media_tombstones_v1')->insert([
            'media_id'=>$f['parent'],'account_id'=>$f['account'],
            'operation_id'=>(string)Str::uuid(),
            'object_keys'=>'[]','next_sweep_at'=>$this->clock(),
            'created_at'=>$this->clock(),
        ]);
        $this->denies(fn()=>$this->preflight()->mediaChunk(
            $f['account'],$f['asset'],$f['source'],$f['target'],$this->clock()
        ),'placement.deleted');
    }

    public function test_unverified_metadata_and_reused_location_are_denied_before_read(): void
    {
        $f = $this->photoFixture();
        $this->denies(fn()=>$this->preflight()->photo(
            $f['account'],$f['asset'],$f['source'],$f['source'],$this->clock()
        ),'placement.same_location');
        DB::table('storage_locations')->where('id',$f['target'])
            ->update(['state'=>'pending']);
        $this->denies(fn()=>$this->photo($f),'placement.location_not_verified');
        DB::table('storage_locations')->where('id',$f['target'])
            ->update(['state'=>'verified','sha256'=>str_repeat('0',64)]);
        $this->denies(fn()=>$this->photo($f),'placement.metadata_mismatch');
        DB::table('storage_locations')->where('id',$f['target'])
            ->update(['sha256'=>hash('sha256',$f['cipher']),'bytes'=>1]);
        $this->denies(fn()=>$this->photo($f),'placement.metadata_mismatch');
        $this->assertSame(0,$this->appStore->reads);
    }

    public function test_real_missing_shortened_and_corrupt_ciphertext_are_denied(): void
    {
        $f = $this->photoFixture();
        unset($this->byoStore->objects[$f['targetKey']]);
        $this->denies(fn()=>$this->photo($f),'placement.ciphertext_not_verified');
        $this->byoStore->objects[$f['targetKey']] = substr($f['cipher'],0,-1);
        $this->denies(fn()=>$this->photo($f),'placement.ciphertext_not_verified');
        $corrupt = $f['cipher'];
        $corrupt[12] = chr(ord($corrupt[12]) ^ 1);
        $this->byoStore->objects[$f['targetKey']] = $corrupt;
        $this->denies(fn()=>$this->photo($f),'placement.ciphertext_not_verified');
        $this->assertSame(hash('sha256',$f['cipher']),
            DB::table('photo_objects')->where('id',$f['asset'])->value('sha256'));
    }

    public function test_unbound_provider_equal_failure_domain_and_wrong_revision_are_denied(): void
    {
        $f = $this->photoFixture();
        $this->denies(fn()=>(new PlacementReadiness([
            'app_s3'=>[
                'adapter'=>$this->appStore,
                'failureDomain'=>'app-garage-domain-01','credentialRevision'=>1,
            ],
        ]))->photo($f['account'],$f['asset'],$f['source'],$f['target'],$this->clock()),
        'placement.provider_not_configured');
        $this->denies(fn()=>$this->preflight('app-garage-domain-01')->photo(
            $f['account'],$f['asset'],$f['source'],$f['target'],$this->clock()
        ),'placement.same_failure_domain');
        $this->denies(fn()=>(new PlacementReadiness([
            'app_s3'=>[
                'adapter'=>$this->appStore,
                'failureDomain'=>'app-garage-domain-01','credentialRevision'=>0,
            ],
            'user_s3'=>[
                'adapter'=>$this->byoStore,
                'failureDomain'=>'user-bucket-domain-02','credentialRevision'=>3,
            ],
        ]))->photo($f['account'],$f['asset'],$f['source'],$f['target'],$this->clock()),
        'placement.provider_not_configured');
    }

    public function test_changed_db_location_during_physical_read_is_denied(): void
    {
        $f = $this->photoFixture();
        $this->byoStore->onRead = static function()use($f):void {
            DB::table('storage_locations')->where('id',$f['target'])
                ->update(['state'=>'deleting','updated_at'=>now()->addMinute()]);
        };
        $this->denies(fn()=>$this->photo($f),'placement.changed_during_preflight');
        $this->assertSame('deleting',DB::table('storage_locations')
            ->where('id',$f['target'])->value('state'));
    }
}
