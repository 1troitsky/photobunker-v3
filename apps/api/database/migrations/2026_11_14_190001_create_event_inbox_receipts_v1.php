<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1 #406: metadata-only durable admission receipts, not an event payload,
 * producer outbox, delivery ACK, subscriber checkpoint, or transport token.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('event_inbox_receipts_v1', static function (Blueprint $table): void {
            $table->uuid('account_id');
            $table->uuid('event_id');
            $table->uuid('subject_id');
            $table->string('subject_type', 24);
            $table->string('event_type', 48);
            $table->unsignedSmallInteger('schema_version');
            $table->unsignedInteger('revision');
            $table->bigInteger('occurred_at_ms');
            $table->char('fingerprint', 64); // SHA-256 of canonical public metadata only
            $table->string('admission_state', 12); // deferred or accepted, never delivered
            $table->timestampsTz();

            $table->primary(['account_id', 'event_id'], 'event_inbox_receipt_pk_v1');
            $table->unique(
                ['account_id', 'subject_type', 'subject_id', 'revision'],
                'event_inbox_stream_rev_unique_v1'
            );
            $table->index(['account_id', 'admission_state'], 'event_inbox_pending_lookup_v1');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE event_inbox_receipts_v1 ADD CONSTRAINT event_inbox_state_v1 CHECK (admission_state IN ('accepted', 'deferred'))");
            DB::statement('ALTER TABLE event_inbox_receipts_v1 ADD CONSTRAINT event_inbox_revision_v1 CHECK (revision >= 1 AND schema_version = 1)');
            DB::statement("ALTER TABLE event_inbox_receipts_v1 ADD CONSTRAINT event_inbox_fingerprint_v1 CHECK (fingerprint ~ '^[a-f0-9]{64}$')");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('event_inbox_receipts_v1');
    }
};
