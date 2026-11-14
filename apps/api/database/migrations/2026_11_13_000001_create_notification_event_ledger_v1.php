<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('notification_event_streams_v1', static function (Blueprint $t): void {
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->string('subject_type', 32);
            $t->uuid('subject_id');
            // Sequence admission only, NOT an ACK or consumer delivery checkpoint.
            $t->unsignedInteger('contiguous_revision')->default(0);
            $t->primary(['account_id', 'subject_type', 'subject_id'], 'notif_stream_pk');
        });
        Schema::create('notification_event_ledger_v1', static function (Blueprint $t): void {
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->uuid('event_id');
            $t->string('subject_type', 32);
            $t->uuid('subject_id');
            $t->unsignedInteger('revision');
            $t->char('fingerprint', 64);
            $t->text('envelope_json');
            $t->unsignedBigInteger('delivery_sequence')->nullable();
            $t->string('admission_state', 16); // deferred or sequenced
            $t->timestampTz('received_at');
            $t->primary(['account_id', 'event_id'], 'notif_event_pk');
            $t->unique(['account_id', 'subject_type', 'subject_id', 'revision'], 'notif_revision_unique');
            $t->index(['account_id', 'subject_type', 'subject_id', 'admission_state'], 'notif_pending_idx');
            $t->unique(['account_id', 'delivery_sequence'], 'notif_account_delivery_unique');
        });
        Schema::create('notification_account_delivery_v1', static function (Blueprint $t): void {
            $t->foreignUuid('account_id')->primary()->constrained('identity_accounts');
            $t->unsignedBigInteger('last_sequence')->default(0);
        });
    }

    public function down(): void
    {
        // Never silently delete pending security/retention notices on rollback.
        throw new RuntimeException('pb3.notification_event_ledger.rollback_forbidden');
    }
};
