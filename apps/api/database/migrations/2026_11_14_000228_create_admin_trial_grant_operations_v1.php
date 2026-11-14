<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // A durable idempotency *receipt*, separate from the immutable billing
        // snapshots and the #227 append-only audit stream. No user secrets.
        Schema::create('admin_trial_grant_operations_v1', static function (Blueprint $t): void {
            $t->uuid('operation_id')->primary();
            $t->uuid('actor_id')->index();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->string('plan_id', 24);
            $t->unsignedInteger('expected_revision');
            $t->string('reason_code', 64);
            $t->timestampTz('starts_at');
            $t->timestampTz('expires_at');
            $t->char('intent_hash', 64);
            $t->char('audit_digest', 64);
            $t->char('verified_event_hash', 64)->unique();
            $t->unsignedInteger('entitlement_revision');
            $t->timestampTz('created_at');
            $t->index(['account_id','created_at'], 'admin_trial_grants_account_history');
        });
    }

    public function down(): void
    {
        // Never accidentally discard already issued billing/audit evidence.
        throw new RuntimeException('admin.trial_history_rollback_forbidden');
    }
};
