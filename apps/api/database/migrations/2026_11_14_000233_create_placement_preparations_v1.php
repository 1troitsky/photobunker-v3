<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A sidecar journal for NON-ACTIVATING source/target placement proposals.
 *
 * No production storage location is promoted, deleted or rewritten by this
 * table. Generation is a durable candidate revision, NOT an active S3
 * placement generation and NOT a signed verification receipt. The row lock
 * in PlacementPreparationLedger is only between cooperating preparers.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('placement_candidate_preparations_v1',
            static function (Blueprint $table): void {
                $table->uuid('id')->primary();
                $table->foreignUuid('account_id')->constrained('identity_accounts');
                $table->string('kind',16); // photo | media_chunk
                $table->uuid('logical_id');
                $table->unsignedBigInteger('generation');
                $table->char('idempotency_sha256',64);
                $table->uuid('source_location_id');
                $table->uuid('target_location_id');
                $table->char('ciphertext_sha256',64);
                $table->unsignedBigInteger('ciphertext_bytes');
                $table->unsignedInteger('source_credential_revision');
                $table->unsignedInteger('target_credential_revision');
                $table->timestampTz('physically_observed_at');
                $table->string('state',16)->default('prepared'); // prepared | abandoned
                $table->timestampsTz();

                $table->unique(['account_id','idempotency_sha256'],
                    'placement_candidate_idempotency_unique');
                $table->unique(['kind','logical_id','generation'],
                    'placement_candidate_generation_unique');
                $table->index(['kind','logical_id','generation'],
                    'placement_candidate_current');
                $table->index(['account_id','state','created_at'],
                    'placement_candidate_account_status');
            });
    }

    public function down(): void
    {
        // Explicit retention gate: silently reversing a schema migration
        // must never erase a durable placement audit journal.
        throw new RuntimeException('placement.candidate_history_requires_explicit_retention_review');
    }
};
