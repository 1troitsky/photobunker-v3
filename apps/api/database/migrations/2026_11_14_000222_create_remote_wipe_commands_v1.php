<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P3 #222: a deferred local-wipe request is NEVER evidence of a completed
 * wipe and never causes remote cloud / Matrix / Recovery Vault deletion.
 */
return new class extends Migration {
    public function up(): void {
        Schema::create('remote_wipe_commands', function (Blueprint $t): void {
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->foreignUuid('actor_device_id')->constrained('identity_devices');
            $t->foreignUuid('target_device_id')->unique()->constrained('identity_devices');
            $t->unsignedInteger('account_revision');
            $t->char('command_sha256', 64);
            $t->text('command_payload');
            $t->text('account_signature');
            $t->text('actor_signature');
            $t->timestampTz('target_revoked_at');
            $t->timestampTz('target_reported_at')->nullable();
            $t->char('target_receipt_sha256', 64)->nullable();
            $t->text('target_receipt_payload')->nullable();
            $t->text('target_receipt_signature')->nullable();
            $t->timestampsTz();
            $t->index(['account_id', 'created_at']);
        });
    }

    public function down(): void {
        Schema::dropIfExists('remote_wipe_commands');
    }
};
