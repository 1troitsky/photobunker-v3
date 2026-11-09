<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Immutable signed links deliberately retain opaque IDs after physical TTL
 * deletion. Do NOT cascade media_file FKs here: linked media must not make
 * the existing safe, verified S3 cleanup permanently impossible.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::create('media_revision_links_v1',static function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->uuid('operation_id')->unique();
            $t->uuid('root_media_id');
            $t->uuid('previous_media_id');
            $t->uuid('new_media_id')->unique();
            $t->unsignedInteger('from_revision');
            $t->unsignedInteger('to_revision');
            $t->char('root_contract_hash',64);
            $t->char('previous_contract_hash',64);
            $t->char('new_contract_hash',64);
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->timestampTz('created_at');
            $t->unique(['root_media_id','to_revision'],'media_revision_unique_order');
            $t->index(['account_id','root_media_id','to_revision'],
                'media_revision_owner_history');
            $t->index(['previous_media_id'],'media_revision_predecessor');
        });
    }
    public function down():void
    {
        Schema::dropIfExists('media_revision_links_v1');
    }
};
