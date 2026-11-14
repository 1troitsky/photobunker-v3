<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * #222. Replay/rate-limit evidence for a narrow signed revoked-device poll.
 * Stores only a hash of canonical signed poll bytes, never a recovery key,
 * nonce, signing secret, cookie, token, or media plaintext.
 *
 * This is NOT proof of remote-device erasure. No route or executor is mounted.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('remote_wipe_delivery_proofs', function (Blueprint $table): void {
            $table->uuid('request_id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts');
            $table->foreignUuid('target_device_id')->constrained('identity_devices');
            $table->foreignUuid('operation_id')->constrained('remote_wipe_commands', 'operation_id');
            $table->char('proof_sha256', 64);
            $table->timestampTz('created_at');
            $table->index(['target_device_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('remote_wipe_delivery_proofs');
    }
};
