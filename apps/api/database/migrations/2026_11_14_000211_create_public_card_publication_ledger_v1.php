<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Feature-gated signed public-card INTENT journal. Never grants access.
 *
 * Deliberately no media FKs: keep revocations and token-hash reuse evidence
 * after media TTL/GC, without preventing media deletion.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('public_card_intent_heads_v1', static function (Blueprint $t): void {
            $t->uuid('safe_media_id')->primary();
            $t->uuid('account_id');
            $t->uuid('source_media_id');
            $t->unsignedInteger('revision');
            $t->string('state', 12); // staged / revoked; NO published state
            $t->char('current_event_hash', 64);
            $t->char('token_hash', 64);
            $t->unsignedBigInteger('expires_at_ms');
            $t->timestampsTz();
            $t->index(['account_id', 'state', 'safe_media_id'], 'public_card_intent_account_state');
        });

        Schema::create('public_card_intent_events_v1', static function (Blueprint $t): void {
            $t->uuid('operation_id')->primary();
            $t->uuid('account_id');
            $t->uuid('source_media_id');
            $t->uuid('safe_media_id');
            $t->unsignedInteger('revision');
            $t->string('kind', 12); // stage / revoke
            $t->char('previous_event_hash', 64);
            $t->char('event_hash', 64);
            $t->char('token_hash', 64);
            $t->longText('signed_json');
            $t->text('owner_signature');
            $t->timestampTz('created_at');
            $t->unique(['safe_media_id', 'revision'], 'public_card_intent_safe_revision_unique');
            $t->unique('event_hash', 'public_card_intent_event_hash_unique');
            $t->index(['account_id', 'safe_media_id', 'revision'], 'public_card_intent_audit');
        });

        Schema::create('public_card_token_reservations_v1', static function (Blueprint $t): void {
            $t->char('token_hash', 64)->primary();
            $t->uuid('account_id');
            $t->uuid('safe_media_id');
            $t->uuid('stage_operation_id')->unique();
            $t->timestampTz('created_at');
        });
    }

    public function down(): void
    {
        // A rollback must never erase evidence of a revoked/replayed token.
        foreach ([
            'public_card_intent_events_v1',
            'public_card_intent_heads_v1',
            'public_card_token_reservations_v1',
        ] as $table) {
            if (DB::table($table)->exists()) {
                throw new RuntimeException('pb3.public_card_intent.rollback_forbidden');
            }
        }
        Schema::dropIfExists('public_card_token_reservations_v1');
        Schema::dropIfExists('public_card_intent_events_v1');
        Schema::dropIfExists('public_card_intent_heads_v1');
    }
};
