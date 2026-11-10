<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('identity_accounts', function(Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('operation_id')->unique();
            $t->char('prepare_hash',64);
            $t->string('status',16)->default('reserved');
            $t->string('locator',24)->nullable()->unique();
            $t->text('account_spki')->nullable();
            $t->text('recovery_envelope')->nullable();
            $t->unsignedInteger('revision')->default(1);
            $t->uuid('rotation_op')->nullable();
            $t->char('rotation_hash',64)->nullable();
            $t->timestampTz('reserved_until');
            $t->timestampsTz();
        });
        Schema::create('identity_devices',function(Blueprint $t) {
            $t->uuid('id')->primary(); $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->text('signing_spki'); $t->timestampTz('revoked_at')->nullable();
            $t->timestampsTz(); $t->index(['account_id','revoked_at']);
        });
        Schema::create('identity_challenges',function(Blueprint $t) {
            $t->uuid('id')->primary(); $t->string('purpose',32);
            $t->uuid('account_id'); $t->text('payload');
            $t->char('digest',64); $t->char('nonce',43);
            $t->timestampTz('expires_at'); $t->timestampTz('consumed_at')->nullable();
            $t->timestampsTz(); $t->index(['account_id','expires_at']);
        });
        Schema::create('identity_pairings',function(Blueprint $t) {
            $t->uuid('id')->primary(); $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->uuid('device_id'); $t->text('device_spki'); $t->text('ecdh_spki');
            $t->char('token_hash',64); $t->char('fingerprint',64);
            $t->text('envelope')->nullable(); $t->uuid('approved_by')->nullable();
            $t->timestampTz('expires_at'); $t->timestampTz('consumed_at')->nullable();
            $t->timestampsTz(); $t->index(['account_id','expires_at']);
        });
    }
    public function down(): void {
        Schema::dropIfExists('identity_pairings');
        Schema::dropIfExists('identity_challenges');
        Schema::dropIfExists('identity_devices');
        Schema::dropIfExists('identity_accounts');
    }
};
