<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Per-target current state points into an immutable event stream.
        // A lock on the existing identity_accounts row serializes first-write
        // creation even when this head does not exist yet.
        Schema::create('admin_temporary_restriction_heads_v1',
            static function (Blueprint $table): void {
                $table->string('target_type', 16);
                $table->uuid('target_id');
                $table->foreignUuid('account_id')->constrained('identity_accounts');
                $table->unsignedInteger('revision');
                $table->uuid('last_operation_id');
                $table->char('last_event_hash', 64);
                $table->primary(['target_type', 'target_id'],
                    'admin_temp_restriction_target_pk');
                $table->index('account_id', 'admin_temp_restriction_accounts');
            });

        // Only stable technical IDs, fixed reason codes and policy deadlines.
        // No IP, CIDR, secrets, recovery keys, user content or freeform text.
        Schema::create('admin_temporary_restriction_events_v1',
            static function (Blueprint $table): void {
                $table->uuid('operation_id')->primary();
                $table->uuid('actor_id');
                $table->foreignUuid('account_id')->constrained('identity_accounts');
                $table->string('target_type', 16);
                $table->uuid('target_id');
                $table->string('action', 16);
                $table->string('reason_code', 64);
                $table->unsignedInteger('expected_revision');
                $table->unsignedInteger('revision');
                $table->timestampTz('expires_at')->nullable();
                $table->char('request_hash', 64);
                $table->char('previous_hash', 64);
                $table->char('event_hash', 64);
                $table->timestampTz('recorded_at');
                $table->unique(['target_type', 'target_id', 'revision'],
                    'admin_temp_restriction_revision_unique');
                $table->index(['account_id', 'target_type', 'target_id'],
                    'admin_temp_restriction_account_target');
            });
    }

    public function down(): void
    {
        // Do not silently erase audit and restriction evidence on rollback.
        throw new RuntimeException('admin.restriction_history_rollback_forbidden');
    }
};
