<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * #221 inert server preflight ledger. NO destructive worker, HTTP handler,
 * revocation state, S3 delete, Matrix teardown, Recovery Vault operation,
 * server ACK, dispatch queue or purge status exists in this table.
 *
 * One immutable first-prepared intent per registered device, pending a future
 * separately audited and explicitly authorized destructive state machine.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('panic_preflight_intents_v1', function (Blueprint $table): void {
            $table->uuid('operation_id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts');
            $table->foreignUuid('device_id')->constrained('identity_devices');
            $table->unsignedInteger('key_revision');
            $table->char('contract_hash', 64);
            $table->text('contract_json');
            $table->string('signature', 96);
            $table->string('phase', 24)->default('preflight_only');
            $table->timestampTz('prepared_at');
            $table->unique(['account_id', 'device_id'], 'panic_one_preflight_per_device_idx');
            $table->index(['account_id', 'prepared_at'], 'panic_preflight_account_time_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('panic_preflight_intents_v1');
    }
};
