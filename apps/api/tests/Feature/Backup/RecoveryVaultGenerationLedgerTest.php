<?php
declare(strict_types=1);

namespace Tests\Feature\Backup;

use App\Backup\RecoveryVaultGenerationLedger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class RecoveryVaultGenerationLedgerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('ciphertext');
    }

    /** Synthetic OPAQUE bytes only: never place plaintext or user keys here. */
    private function start(?string $accountId = null): array
    {
        $account = $accountId ?? (string) Str::uuid();
        if ($accountId === null) {
            DB::table('identity_accounts')->insert([
                'id' => $account, 'operation_id' => (string) Str::uuid(),
                'prepare_hash' => str_repeat('a', 64), 'status' => 'ready',
                'reserved_until' => now()->addDay(), 'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        $operation = (string) Str::uuid();
        $lease = (string) Str::uuid();
        DB::table('backup_start_operations_v1')->insert([
            'operation_id' => $operation, 'account_id' => $account,
            'lease_id' => $lease, 'state' => 'started',
            'reserved_at' => now(), 'accepted_at' => now(),
            'lease_expires_at' => now()->addMinutes(15),
            'finished_at' => null,
        ]);
        return compact('account', 'operation', 'lease');
    }

    private function stage(array $auth, string $bytes, ?string $expectedSha = null): array
    {
        $generation = (string) Str::uuid();
        $hash = $expectedSha ?? hash('sha256', $bytes);
        $key = app(RecoveryVaultGenerationLedger::class)->stageTrusted(
            $auth['account'], $auth['operation'], $auth['lease'],
            $generation, $hash, strlen($bytes));
        return compact('generation', 'key', 'hash');
    }

    private function activate(array $auth, array $candidate): string
    {
        return app(RecoveryVaultGenerationLedger::class)->activateVerifiedTrusted(
            $auth['account'], $auth['operation'], $auth['lease'],
            $candidate['generation']);
    }

    public function test_verified_ciphertext_manifest_becomes_only_active_generation(): void
    {
        $a = $this->start();
        $bytes = random_bytes(512);
        $candidate = $this->stage($a, $bytes);
        $this->assertNull(app(RecoveryVaultGenerationLedger::class)
            ->currentActive($a['account']));
        Storage::disk('ciphertext')->put($candidate['key'], $bytes);
        $this->assertSame($candidate['generation'], $this->activate($a, $candidate));
        $active = app(RecoveryVaultGenerationLedger::class)
            ->currentActive($a['account']);
        $this->assertSame($candidate['generation'], $active->id);
        $this->assertSame($candidate['hash'], $active->manifest_sha256);
        $this->assertNotNull($active->verified_at);
        $this->assertDatabaseCount('backup_generation_heads_v1', 1);
        $this->assertDatabaseHas('backup_generations_v1', [
            'id' => $candidate['generation'], 'state' => 'active',
        ]);
        // Lost ACK from the exact already committed generation is idempotent.
        $this->assertSame($candidate['generation'], $this->activate($a, $candidate));
    }

    public function test_missing_manifest_and_bad_hash_do_not_promote_candidate(): void
    {
        $a = $this->start();
        $bytes = random_bytes(256);
        $candidate = $this->stage($a, $bytes);
        try {
            $this->activate($a, $candidate);
            $this->fail('missing manifest accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.manifest_not_verified', $e->getMessage());
        }
        // Equal-size corruption is not accepted as a valid ciphertext blob.
        Storage::disk('ciphertext')->put($candidate['key'], random_bytes(256));
        try {
            $this->activate($a, $candidate);
            $this->fail('corrupted manifest accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.manifest_not_verified', $e->getMessage());
        }
        $this->assertNull(app(RecoveryVaultGenerationLedger::class)
            ->currentActive($a['account']));
        $this->assertDatabaseHas('backup_generations_v1', [
            'id' => $candidate['generation'], 'state' => 'staged',
        ]);
    }

    public function test_short_manifest_and_unconfirmed_reservation_fail_closed(): void
    {
        $a = $this->start();
        $g = (string) Str::uuid();
        $ledger = app(RecoveryVaultGenerationLedger::class);
        try {
            $ledger->stageTrusted($a['account'], $a['operation'], $a['lease'],
                $g, str_repeat('a', 64), 12);
            $this->fail('short manifest accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.invalid_manifest', $e->getMessage());
        }
        DB::table('backup_start_operations_v1')->where('operation_id', $a['operation'])
            ->update(['state' => 'reserved']);
        try {
            $ledger->stageTrusted($a['account'], $a['operation'], $a['lease'],
                $g, str_repeat('a', 64), 256);
            $this->fail('reservation accepted as start');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.backup_lease_not_started', $e->getMessage());
        }
        $this->assertDatabaseCount('backup_generations_v1', 0);
    }

    public function test_stale_worker_cannot_activate_even_after_physical_readback(): void
    {
        $a = $this->start();
        $bytes = random_bytes(300);
        $candidate = $this->stage($a, $bytes);
        Storage::disk('ciphertext')->put($candidate['key'], $bytes);
        DB::table('backup_start_operations_v1')->where('operation_id', $a['operation'])
            ->update(['lease_expires_at' => now()->subMinute()]);
        try {
            $this->activate($a, $candidate);
            $this->fail('stale lease promoted candidate');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.backup_lease_not_started', $e->getMessage());
        }
        $this->assertNull(app(RecoveryVaultGenerationLedger::class)
            ->currentActive($a['account']));
    }

    public function test_failed_replacement_preserves_last_verified_snapshot_and_bytes(): void
    {
        $a = $this->start();
        $firstBytes = random_bytes(360);
        $first = $this->stage($a, $firstBytes);
        Storage::disk('ciphertext')->put($first['key'], $firstBytes);
        $this->activate($a, $first);
        DB::table('backup_start_operations_v1')->where('operation_id', $a['operation'])
            ->update(['state' => 'completed', 'lease_expires_at' => null,
                'finished_at' => now()]);
        $b = $this->start($a['account']);
        $second = $this->stage($b, random_bytes(450));
        // Remote object does not exist: simulate upload outage.
        try {
            $this->activate($b, $second);
            $this->fail('partial replacement was promoted');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.manifest_not_verified', $e->getMessage());
        }
        $this->assertSame($first['generation'], app(RecoveryVaultGenerationLedger::class)
            ->currentActive($a['account'])->id);
        $this->assertSame($firstBytes, Storage::disk('ciphertext')->get($first['key']));
        $this->assertDatabaseHas('backup_generations_v1', [
            'id' => $first['generation'], 'state' => 'active',
        ]);
        // Once exact bytes are present, the new snapshot atomically replaces head,
        // but old ciphertext stays in S3 for future retention/GC policy.
        $newBytes = random_bytes(450);
        // The staged digest was for different bytes, so it must still reject.
        Storage::disk('ciphertext')->put($second['key'], $newBytes);
        try {
            $this->activate($b, $second);
            $this->fail('mismatched replacement promoted');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.manifest_not_verified', $e->getMessage());
        }
        $this->assertSame($first['generation'], app(RecoveryVaultGenerationLedger::class)
            ->currentActive($a['account'])->id);
    }

    public function test_valid_replacement_retains_retired_ciphertext_and_only_one_head(): void
    {
        $a = $this->start();
        $firstBytes = random_bytes(330);
        $first = $this->stage($a, $firstBytes);
        Storage::disk('ciphertext')->put($first['key'], $firstBytes);
        $this->activate($a, $first);
        DB::table('backup_start_operations_v1')->where('operation_id', $a['operation'])
            ->update(['state' => 'completed', 'lease_expires_at' => null,
                'finished_at' => now()]);
        $b = $this->start($a['account']);
        $secondBytes = random_bytes(450);
        $second = $this->stage($b, $secondBytes);
        Storage::disk('ciphertext')->put($second['key'], $secondBytes);
        $this->activate($b, $second);
        $this->assertSame($second['generation'], app(RecoveryVaultGenerationLedger::class)
            ->currentActive($a['account'])->id);
        $this->assertDatabaseHas('backup_generations_v1', [
            'id' => $first['generation'], 'state' => 'retired',
        ]);
        $this->assertDatabaseHas('backup_generations_v1', [
            'id' => $second['generation'], 'state' => 'active',
        ]);
        $this->assertSame($firstBytes, Storage::disk('ciphertext')->get($first['key']));
        $this->assertDatabaseCount('backup_generation_heads_v1', 1);
    }

    public function test_conflicting_replay_and_second_stage_are_rejected(): void
    {
        $a = $this->start();
        $bytes = random_bytes(256);
        $candidate = $this->stage($a, $bytes);
        $ledger = app(RecoveryVaultGenerationLedger::class);
        $this->assertSame($candidate['key'],
            $ledger->stageTrusted($a['account'], $a['operation'], $a['lease'],
                $candidate['generation'], $candidate['hash'], strlen($bytes)));
        try {
            $ledger->stageTrusted($a['account'], $a['operation'], $a['lease'],
                $candidate['generation'], str_repeat('b', 64), strlen($bytes));
            $this->fail('mismatched replay accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.generation_conflict', $e->getMessage());
        }
        try {
            $ledger->stageTrusted($a['account'], $a['operation'], $a['lease'],
                (string) Str::uuid(), $candidate['hash'], strlen($bytes));
            $this->fail('parallel stage accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.stage_in_progress', $e->getMessage());
        }
    }

    public function test_cross_account_generation_cannot_be_adopted(): void
    {
        $a = $this->start();
        $b = $this->start();
        $bytes = random_bytes(256);
        $candidate = $this->stage($a, $bytes);
        $ledger = app(RecoveryVaultGenerationLedger::class);
        try {
            $ledger->stageTrusted($b['account'], $b['operation'], $b['lease'],
                $candidate['generation'], $candidate['hash'], strlen($bytes));
            $this->fail('cross-account stage accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.generation_conflict', $e->getMessage());
        }
        Storage::disk('ciphertext')->put($candidate['key'], $bytes);
        try {
            $ledger->activateVerifiedTrusted($b['account'], $b['operation'],
                $b['lease'], $candidate['generation']);
            $this->fail('cross-account activation accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.generation_missing', $e->getMessage());
        }
        $this->assertNull($ledger->currentActive($b['account']));
    }

    public function test_corrupt_head_rolls_back_replacement_without_losing_staged_row(): void
    {
        $a = $this->start();
        $one = random_bytes(330);
        $first = $this->stage($a, $one);
        Storage::disk('ciphertext')->put($first['key'], $one);
        $this->activate($a, $first);
        DB::table('backup_start_operations_v1')->where('operation_id', $a['operation'])
            ->update(['state' => 'completed', 'lease_expires_at' => null,
                'finished_at' => now()]);
        $b = $this->start($a['account']);
        $two = random_bytes(370);
        $second = $this->stage($b, $two);
        Storage::disk('ciphertext')->put($second['key'], $two);
        // Test-only corruption to prove the transaction fails closed.
        DB::table('backup_generations_v1')->where('id', $first['generation'])
            ->update(['state' => 'retired']);
        try {
            $this->activate($b, $second);
            $this->fail('corrupt head accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('vault.head_integrity_failed', $e->getMessage());
        }
        $this->assertDatabaseHas('backup_generations_v1', [
            'id' => $second['generation'], 'state' => 'staged',
        ]);
        $this->assertDatabaseHas('backup_generation_heads_v1', [
            'account_id' => $a['account'], 'generation_id' => $first['generation'],
        ]);
    }
}
