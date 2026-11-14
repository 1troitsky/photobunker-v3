<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * #234 Replication transfer outbox, not Recovery Vault backup.
 *
 * A row is immutable in identity/destination/content; only lease, retry and
 * verified ACK metadata change. A new generation is an explicit repair.
 * This does not change StorageManager's active placement or route requests
 * to any external S3 provider until separately accepted/registered.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('ciphertext_replication_jobs_v1', static function(Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->string('kind',16); // photo | media_chunk
            $t->uuid('logical_id');
            $t->uuid('source_location_id');
            $t->uuid('target_location_id');
            $t->unsignedInteger('generation');
            $t->char('idempotency_sha256',64);
            $t->char('ciphertext_sha256',64);
            $t->unsignedBigInteger('ciphertext_bytes');
            $t->unsignedInteger('source_credential_revision');
            $t->unsignedInteger('target_credential_revision');
            $t->string('state',16)->default('queued'); // queued|leased|retry|verified|cancelled
            $t->unsignedInteger('attempts')->default(0);
            $t->char('lease_sha256',64)->nullable();
            $t->timestampTz('lease_until')->nullable();
            $t->timestampTz('next_attempt_at');
            $t->timestampTz('verified_at')->nullable();
            $t->string('failure_class',32)->nullable();
            $t->timestampsTz();
            $t->unique(['account_id','idempotency_sha256'],'replication_account_idempotency_unique');
            $t->unique(['kind','target_location_id','generation'],'replication_location_generation_unique');
            $t->index(['state','next_attempt_at','lease_until'],'replication_due_jobs');
            $t->index(['account_id','state','created_at'],'replication_account_jobs');
        });
    }

    public function down(): void
    {
        // Deliberately fail rather than silently erase durable replication
        // history. Retention and legal/panic cleanup require a separate,
        // explicitly reviewed migration.
        throw new RuntimeException('replication.history_retention_review_required');
    }
};
