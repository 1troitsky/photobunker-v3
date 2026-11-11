<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Signed account-owned archive intents. Never move physical ciphertext paths.
 * TTL remains authoritative in photo_records / media_files_v1.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::create('browser_archive_entries_v1',static function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->string('kind',8); // photo / media
            $t->uuid('asset_id'); // do NOT FK: keep audit when GC removed source row
            $t->unsignedInteger('revision');
            $t->string('state',16); // archived / restored / deleting
            $t->unsignedBigInteger('asset_expires_at_ms');
            $t->unsignedBigInteger('archive_until_ms')->nullable();
            $t->string('media_type',8)->nullable();
            $t->unsignedBigInteger('plain_bytes')->nullable();
            $t->uuid('last_operation_id');
            $t->timestampsTz();
            $t->unique(['kind','asset_id'],'browser_archive_asset_unique');
            $t->index(['account_id','state','id'],'browser_archive_owner_cursor');
            $t->index(['state','archive_until_ms','id'],'browser_archive_due');
        });
        Schema::create('browser_archive_events_v1',static function(Blueprint $t):void{
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->foreignUuid('writer_device_id')->constrained('identity_devices');
            $t->string('kind',8);
            $t->uuid('asset_id');
            $t->string('action',16);
            $t->unsignedInteger('from_revision');
            $t->unsignedInteger('to_revision');
            $t->char('contract_hash',64);
            $t->longText('command_json');
            $t->text('account_signature');
            $t->json('result_json');
            $t->timestampTz('created_at');
            $t->index(['account_id','asset_id','to_revision']);
        });
    }
    public function down():void
    {
        if((Schema::hasTable('browser_archive_entries_v1')
                &&DB::table('browser_archive_entries_v1')->exists())
            ||(Schema::hasTable('browser_archive_events_v1')
                &&DB::table('browser_archive_events_v1')->exists())){
            throw new \RuntimeException('pb3.browser_archive.rollback_forbidden');
        }
        Schema::dropIfExists('browser_archive_events_v1');
        Schema::dropIfExists('browser_archive_entries_v1');
    }
};
