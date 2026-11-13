<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Account-signed policy DRAFTS only. No public access/ciphertext key endpoint.
 * Deliberately avoid FKs to media files: retain signed audit through eventual
 * TTL/physical deletion without allowing a draft to block media cleanup.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::create('media_file_preview_policies_v1',static function(Blueprint $t):void{
            $t->uuid('safe_media_id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->uuid('source_media_id');
            $t->char('source_contract_hash',64);
            $t->char('safe_contract_hash',64);
            $t->unsignedSmallInteger('revision');
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('account_signature');
            $t->unsignedBigInteger('expires_at_ms');
            $t->timestampsTz();
            $t->index(['account_id','source_media_id']);
        });
        Schema::create('media_file_preview_policy_events_v1',static function(Blueprint $t):void{
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->uuid('source_media_id');
            $t->uuid('safe_media_id');
            $t->unsignedSmallInteger('from_revision');
            $t->unsignedSmallInteger('to_revision');
            $t->char('previous_policy_hash',64);
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('account_signature');
            $t->timestampTz('created_at');
            $t->unique(['safe_media_id','to_revision'],'file_preview_revision_unique');
            $t->index(['account_id','safe_media_id','to_revision'],
                'file_preview_audit');
        });
    }
    public function down():void
    {
        if(DB::table('media_file_preview_policies_v1')->exists()
            ||DB::table('media_file_preview_policy_events_v1')->exists())
            throw new RuntimeException('pb3.file_preview.rollback_forbidden');
        Schema::dropIfExists('media_file_preview_policy_events_v1');
        Schema::dropIfExists('media_file_preview_policies_v1');
    }
};
