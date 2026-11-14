<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Vault manifests hold only opaque ciphertext references, never account keys
 * or private metadata. Retired generations are retained for recovery/GC.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('backup_generations_v1', static function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->uuid('operation_id');
            $t->uuid('lease_id');
            $t->string('state', 16);
            $t->char('manifest_sha256', 64);
            $t->unsignedBigInteger('manifest_bytes');
            $t->string('object_key', 180);
            $t->timestampTz('verified_at')->nullable();
            $t->timestampsTz();
            $t->unique(['account_id', 'operation_id'], 'vault_account_operation_unique');
            $t->index(['account_id', 'state'], 'vault_account_state_idx');
        });
        DB::statement("CREATE UNIQUE INDEX vault_one_stage_per_account_idx
            ON backup_generations_v1(account_id) WHERE state = 'staged'");
        DB::statement("CREATE UNIQUE INDEX vault_one_active_per_account_idx
            ON backup_generations_v1(account_id) WHERE state = 'active'");

        Schema::create('backup_generation_heads_v1', static function (Blueprint $t): void {
            $t->foreignUuid('account_id')->primary()->constrained('identity_accounts');
            $t->foreignUuid('generation_id')->unique()->constrained('backup_generations_v1');
            $t->timestampTz('updated_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('backup_generation_heads_v1');
        Schema::dropIfExists('backup_generations_v1');
    }
};
