<?php
declare(strict_types=1);

namespace Tests\Feature\StorageContracts;

use App\Storage\AppS3Adapter;
use App\Storage\StorageManager;
use Illuminate\Support\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

final class StorageContractTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Never connect to production S3. Real disposable Garage is separately
        // exercised by the existing CI storage smoke scripts.
        Storage::fake('ciphertext');
    }

    private function stream(string $data): mixed
    {
        $stream = fopen('php://temp', 'w+b');
        self::assertIsResource($stream);
        fwrite($stream, $data);
        rewind($stream);
        return $stream;
    }

    /** @return array{account:string,device:string} */
    private function identity(): array
    {
        $account = (string) Str::uuid();
        $device = (string) Str::uuid();
        $now = now();
        DB::table('identity_accounts')->insert([
            'id' => $account,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'reserved_until' => now()->addDay(),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('identity_devices')->insert([
            'id' => $device,
            'account_id' => $account,
            'signing_spki' => 'synthetic-test-only',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        return compact('account', 'device');
    }

    /** @return array{asset:string,key:string,bytes:string} */
    private function photoFixture(string $state = 'verified'): array
    {
        $user = $this->identity();
        $photo = (string) Str::uuid();
        $asset = (string) Str::uuid();
        $key = 'cipher/v1/'.$user['account'].'/'.$photo.'/'.$asset;
        $bytes = random_bytes(384); // synthetic ciphertext only
        $now = now();

        DB::table('photo_records')->insert([
            'id' => $photo,
            'account_id' => $user['account'],
            'device_id' => $user['device'],
            'operation_id' => (string) Str::uuid(),
            'expires_at' => now()->addDays(5)->getTimestampMs(),
            'contract_hash' => str_repeat('b', 64),
            'contract_json' => '{}',
            'signature' => 'synthetic-only',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('photo_objects')->insert([
            'id' => $asset,
            'photo_id' => $photo,
            'kind' => 'master',
            'revision' => 1,
            'bytes' => strlen($bytes),
            'sha256' => hash('sha256', $bytes),
            'manifest_json' => '{}',
            'object_key' => $key,
            'state' => $state,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('storage_locations')->insert([
            'id' => (string) Str::uuid(),
            'asset_id' => $asset,
            'provider' => 'app_s3',
            'object_key' => $key,
            'bytes' => strlen($bytes),
            'sha256' => hash('sha256', $bytes),
            'state' => $state,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        return compact('asset', 'key', 'bytes');
    }

    /** @return array{chunk:string,key:string,bytes:string} */
    private function mediaFixture(string $state = 'verified'): array
    {
        $user = $this->identity();
        $media = (string) Str::uuid();
        $chunk = (string) Str::uuid();
        $key = 'cipher/media/v1/'.$user['account'].'/'.$media.'/'.$chunk;
        $bytes = random_bytes(384);
        $now = now();

        DB::table('media_files_v1')->insert([
            'id' => $media,
            'account_id' => $user['account'],
            'device_id' => $user['device'],
            'operation_id' => (string) Str::uuid(),
            'media_type' => 'video',
            'expires_at' => now()->addDays(5)->getTimestampMs(),
            'plain_bytes' => 256,
            'cipher_bytes' => strlen($bytes),
            'contract_hash' => str_repeat('c', 64),
            'contract_json' => '{}',
            'signature' => 'synthetic-only',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('media_chunks_v1')->insert([
            'id' => $chunk,
            'media_id' => $media,
            'chunk_index' => 0,
            'kind' => 'master',
            'plain_bytes' => 256,
            'bytes' => strlen($bytes),
            'sha256' => hash('sha256', $bytes),
            'iv' => 'synthetic-iv',
            'state' => $state,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('media_chunk_locations_v1')->insert([
            'id' => (string) Str::uuid(),
            'chunk_id' => $chunk,
            'provider' => 'app_s3',
            'object_key' => $key,
            'bytes' => strlen($bytes),
            'sha256' => hash('sha256', $bytes),
            'state' => $state,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        return compact('chunk', 'key', 'bytes');
    }

    public function test_real_app_s3_adapter_conforms_to_stream_roundtrip_on_isolated_disk(): void
    {
        $adapter = new AppS3Adapter();
        $key = 'cipher/v1/synthetic/roundtrip.bin';
        $data = random_bytes(1024);
        $input = $this->stream($data);
        try {
            self::assertTrue($adapter->putStream($key, $input));
        } finally {
            fclose($input);
        }
        self::assertTrue($adapter->exists($key));
        self::assertSame(strlen($data), $adapter->size($key));
        $output = $adapter->readStream($key);
        self::assertIsResource($output);
        try {
            self::assertSame($data, stream_get_contents($output));
        } finally {
            fclose($output);
        }
        self::assertTrue($adapter->delete($key));
        self::assertFalse($adapter->exists($key));
    }

    public function test_app_s3_rejects_non_stream_input_without_writing(): void
    {
        $adapter = new AppS3Adapter();
        $key = 'cipher/v1/synthetic/invalid.bin';
        try {
            $adapter->putStream($key, 'not-a-stream');
            self::fail('Unsafe non-stream write accepted');
        } catch (\InvalidArgumentException $e) {
            self::assertSame('Ciphertext stream required', $e->getMessage());
        }
        self::assertFalse($adapter->exists($key));
    }

    public function test_asset_write_failure_is_not_silent_and_does_not_mark_verified(): void
    {
        $f = $this->photoFixture('reserved');
        $adapter = new ContractAdapter();
        $adapter->rejectPut = true;
        $manager = new StorageManager($adapter);
        $stream = $this->stream($f['bytes']);
        try {
            self::assertFalse($manager->writeAsset($f['asset'], $stream));
        } finally {
            fclose($stream);
        }
        self::assertSame([], $adapter->objects);
        self::assertFalse($manager->verifyAsset(
            $f['asset'], strlen($f['bytes']), hash('sha256', $f['bytes']),
        ));
        $this->assertDatabaseHas('storage_locations', [
            'asset_id' => $f['asset'], 'state' => 'reserved',
        ]);
    }

    public function test_asset_verification_checks_size_digest_and_all_registered_locations(): void
    {
        $f = $this->photoFixture();
        $adapter = new ContractAdapter();
        $manager = new StorageManager($adapter);
        $stream = $this->stream($f['bytes']);
        try {
            self::assertTrue($manager->writeAsset($f['asset'], $stream));
        } finally {
            fclose($stream);
        }
        $digest = hash('sha256', $f['bytes']);
        self::assertTrue($manager->verifyAsset($f['asset'], strlen($f['bytes']), $digest));
        self::assertFalse($manager->verifyAsset($f['asset'], strlen($f['bytes']) + 1, $digest));
        self::assertFalse($manager->verifyAsset($f['asset'], strlen($f['bytes']), str_repeat('0', 64)));
        $adapter->corruptReads = true;
        self::assertFalse($manager->verifyAsset($f['asset'], strlen($f['bytes']), $digest));
        $adapter->corruptReads = false;

        // Second registered placement must not be silently ignored.
        DB::table('storage_locations')->insert([
            'id' => (string) Str::uuid(), 'asset_id' => $f['asset'],
            'provider' => 'app_s3', 'object_key' => $f['key'].'-replica',
            'sha256' => $digest, 'bytes' => strlen($f['bytes']),
            'state' => 'verified', 'created_at' => now(), 'updated_at' => now(),
        ]);
        self::assertFalse($manager->verifyAsset($f['asset'], strlen($f['bytes']), $digest));
        $adapter->objects[$f['key'].'-replica'] = $f['bytes'];
        self::assertTrue($manager->verifyAsset($f['asset'], strlen($f['bytes']), $digest));
        $replicaKey = $f['key'].'-replica';
        $adapter->objects[$replicaKey][0] =
            chr(ord($adapter->objects[$replicaKey][0]) ^ 1);
        self::assertFalse($manager->verifyAsset($f['asset'], strlen($f['bytes']), $digest));
    }

    public function test_read_requires_verified_location_and_never_falls_back_to_pending(): void
    {
        $f = $this->photoFixture('reserved');
        $adapter = new ContractAdapter();
        $adapter->objects[$f['key']] = $f['bytes'];
        $manager = new StorageManager($adapter);
        try {
            $manager->readAsset($f['asset']);
            self::fail('Unverified location leaked bytes');
        } catch (RuntimeException $e) {
            self::assertSame('storage.no_verified_location', $e->getMessage());
        }
        DB::table('storage_locations')->where('asset_id', $f['asset'])
            ->update(['state' => 'verified']);
        $stream = $manager->readAsset($f['asset']);
        self::assertIsResource($stream);
        try {
            self::assertSame($f['bytes'], stream_get_contents($stream));
        } finally {
            fclose($stream);
        }
        $adapter->throwOnRead = true;
        $this->expectExceptionMessage('test.injected_read_outage');
        $manager->readAsset($f['asset']);
    }

    public function test_invalid_write_placement_and_unsupported_provider_fail_closed(): void
    {
        $f = $this->photoFixture('reserved');
        $adapter = new ContractAdapter();
        $manager = new StorageManager($adapter);
        DB::table('storage_locations')->where('asset_id', $f['asset'])->delete();
        $missingPlacementStream = $this->stream($f['bytes']);
        try {
            $manager->writeAsset($f['asset'], $missingPlacementStream);
            self::fail('Missing placement accepted');
        } catch (RuntimeException $e) {
            self::assertSame('storage.invalid_write_placement', $e->getMessage());
        } finally {
            fclose($missingPlacementStream);
        }

        DB::table('storage_locations')->insert([
            'id' => (string) Str::uuid(), 'asset_id' => $f['asset'],
            'provider' => 'unknown_s3', 'object_key' => $f['key'],
            'sha256' => hash('sha256', $f['bytes']), 'bytes' => strlen($f['bytes']),
            'state' => 'reserved', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $stream = $this->stream($f['bytes']);
        try {
            $manager->writeAsset($f['asset'], $stream);
            self::fail('Unknown provider was silently accepted');
        } catch (RuntimeException $e) {
            self::assertSame('storage.unsupported_provider', $e->getMessage());
        } finally {
            fclose($stream);
        }
        self::assertSame(0, $adapter->putCalls);
    }

    public function test_failed_delete_preserves_references_and_missing_delete_is_idempotent(): void
    {
        $f = $this->photoFixture();
        $adapter = new ContractAdapter();
        $adapter->objects[$f['key']] = $f['bytes'];
        $manager = new StorageManager($adapter);
        $adapter->rejectDelete = true;
        try {
            $manager->deleteAsset($f['asset']);
            self::fail('Failed delete was acknowledged');
        } catch (RuntimeException $e) {
            self::assertSame('storage.delete_unconfirmed', $e->getMessage());
        }
        self::assertArrayHasKey($f['key'], $adapter->objects);
        $this->assertDatabaseHas('storage_locations', ['asset_id' => $f['asset']]);

        $adapter->rejectDelete = false;
        $adapter->reportDeletedObjectStillPresent = true;
        try {
            $manager->deleteAsset($f['asset']);
            self::fail('Stale post-delete existence was acknowledged');
        } catch (RuntimeException $e) {
            self::assertSame('storage.delete_unconfirmed', $e->getMessage());
        }

        // Both failed physical delete confirmations must now OPEN the durable
        // S3 circuit. No third adapter call is permitted during cooldown:
        // the old contract's immediate success assumption predated #202.
        $this->assertDatabaseHas('storage_provider_health', [
            'provider' => 'app_s3', 'state' => 'open', 'failures' => 2,
        ]);
        $callsDuringCooldown = $adapter->deleteCalls;
        $adapter->reportDeletedObjectStillPresent = false;
        try {
            $manager->deleteAsset($f['asset']);
            self::fail('Open circuit silently contacted S3 or acknowledged deletion');
        } catch (RuntimeException $e) {
            self::assertSame('storage.circuit_open', $e->getMessage());
        }
        self::assertSame($callsDuringCooldown, $adapter->deleteCalls);
        $this->assertDatabaseHas('storage_locations', ['asset_id' => $f['asset']]);

        // Once the real cooldown has elapsed, a single half-open probe may
        // confirm deletion. The original no-false-ACK and idempotency
        // assertions below remain intact, without disabling the breaker.
        Carbon::setTestNow(now()->addSeconds(31));
        try {
            $manager->deleteAsset($f['asset']);
            $after = $adapter->deleteCalls;
            $manager->deleteAsset($f['asset']); // object already missing
            self::assertSame($after, $adapter->deleteCalls);
            $this->assertDatabaseHas('storage_locations', ['asset_id' => $f['asset']]);
            $this->assertDatabaseHas('storage_provider_health', [
                'provider' => 'app_s3', 'state' => 'closed', 'failures' => 0,
            ]);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_media_chunk_verification_and_delete_are_safe_for_missing_and_corrupt_data(): void
    {
        $f = $this->mediaFixture('reserved');
        $adapter = new ContractAdapter();
        $manager = new StorageManager($adapter);
        $digest = hash('sha256', $f['bytes']);
        self::assertFalse($manager->verifyMediaChunk($f['chunk'], strlen($f['bytes']), $digest));

        $stream = $this->stream($f['bytes']);
        try {
            self::assertTrue($manager->writeMediaChunk($f['chunk'], $stream));
        } finally {
            fclose($stream);
        }
        self::assertTrue($manager->verifyMediaChunk($f['chunk'], strlen($f['bytes']), $digest));
        try {
            $manager->readMediaChunk($f['chunk']);
            self::fail('Reserved location exposed MediaFile ciphertext');
        } catch (RuntimeException $e) {
            self::assertSame('storage.media_chunk_unavailable', $e->getMessage());
        }
        DB::table('media_chunk_locations_v1')->where('chunk_id', $f['chunk'])
            ->update(['state' => 'verified']);
        $stream = $manager->readMediaChunk($f['chunk']);
        self::assertIsResource($stream);
        fclose($stream);
        $adapter->corruptReads = true;
        self::assertFalse($manager->verifyMediaChunk($f['chunk'], strlen($f['bytes']), $digest));
        $adapter->corruptReads = false;

        $adapter->rejectDelete = true;
        try {
            $manager->deleteMediaChunk($f['chunk']);
            self::fail('Failed MediaFile delete was acknowledged');
        } catch (RuntimeException $e) {
            self::assertSame('storage.media_delete_unconfirmed', $e->getMessage());
        }
        $adapter->rejectDelete = false;
        $manager->deleteMediaChunk($f['chunk']);
        self::assertFalse($adapter->exists($f['key']));
        $manager->deleteMediaChunk($f['chunk']);
        $this->assertDatabaseHas('media_chunk_locations_v1', ['chunk_id' => $f['chunk']]);
    }

    public function test_tombstone_sweeps_refuse_arbitrary_keys_and_require_confirmed_delete(): void
    {
        $f = $this->photoFixture();
        $adapter = new ContractAdapter();
        $adapter->objects[$f['key']] = $f['bytes'];
        $manager = new StorageManager($adapter);
        foreach (['../private', 'http://127.0.0.1/private', 'cipher/v1/invalid',
            $f['key'].'/extra',
        ] as $malicious) {
            try {
                $manager->sweepLateWrite($malicious);
                self::fail('Unsafe late-write key accepted');
            } catch (RuntimeException $e) {
                self::assertSame('storage.invalid_tombstone', $e->getMessage());
            }
        }
        $adapter->rejectDelete = true;
        try {
            $manager->sweepLateWrite($f['key']);
            self::fail('Failed tombstone sweep silently succeeded');
        } catch (RuntimeException $e) {
            self::assertSame('storage.tombstone_retry', $e->getMessage());
        }
        self::assertTrue($adapter->exists($f['key']));
        $adapter->rejectDelete = false;
        $manager->sweepLateWrite($f['key']);
        self::assertFalse($adapter->exists($f['key']));
        $manager->sweepLateWrite($f['key']); // no repeat delete
    }

    public function test_media_tombstone_guard_is_separate_from_photo_namespace(): void
    {
        $f = $this->mediaFixture();
        $adapter = new ContractAdapter();
        $adapter->objects[$f['key']] = $f['bytes'];
        $manager = new StorageManager($adapter);
        try {
            $manager->sweepMediaLateWrite(str_replace('/media/', '/', $f['key']));
            self::fail('Wrong namespace permitted');
        } catch (RuntimeException $e) {
            self::assertSame('storage.invalid_media_tombstone', $e->getMessage());
        }
        $adapter->rejectDelete = true;
        try {
            $manager->sweepMediaLateWrite($f['key']);
            self::fail('Failed media tombstone sweep accepted');
        } catch (RuntimeException $e) {
            self::assertSame('storage.media_tombstone_retry', $e->getMessage());
        }
        $adapter->rejectDelete = false;
        $manager->sweepMediaLateWrite($f['key']);
        self::assertFalse($adapter->exists($f['key']));
    }
}
