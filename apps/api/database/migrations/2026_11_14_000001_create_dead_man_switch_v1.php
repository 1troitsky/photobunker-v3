<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('dead_man_switches_v1', function (Blueprint $table): void {
            $table->uuid('account_id')->primary();
            $table->foreign('account_id')->references('id')->on('identity_accounts');
            $table->unsignedSmallInteger('months')->default(0);
            $table->string('state', 24)->default('disabled');
            $table->unsignedInteger('revision')->default(0);
            $table->timestampTz('last_confirmed_at')->nullable();
            $table->timestampTz('warning_at')->nullable();
            $table->timestampTz('warned_at')->nullable();
            $table->timestampTz('deadline_at')->nullable();
            $table->timestampTz('expired_review_at')->nullable();
            $table->timestampsTz();
            $table->index(['state', 'warning_at'], 'dms_due_warning_idx');
            $table->index(['state', 'deadline_at'], 'dms_due_expiry_idx');
        });
        Schema::create('dead_man_operations_v1', function (Blueprint $table): void {
            $table->uuid('operation_id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts');
            $table->foreignUuid('device_id')->constrained('identity_devices');
            $table->char('payload_hash', 64);
            $table->string('kind', 16);
            $table->unsignedInteger('result_revision');
            $table->string('result_state', 24);
            $table->timestampTz('result_deadline_at')->nullable();
            $table->timestampTz('accepted_at');
            $table->index(['account_id', 'accepted_at'], 'dms_account_operation_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dead_man_operations_v1');
        Schema::dropIfExists('dead_man_switches_v1');
    }
};
