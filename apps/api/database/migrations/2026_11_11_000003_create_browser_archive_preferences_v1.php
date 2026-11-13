<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Durable account-signed archive preferences; never store private filenames. */
return new class extends Migration {
    public function up():void
    {
        Schema::create('browser_archive_preferences_v1',static function(Blueprint $t):void{
            $t->foreignUuid('account_id')->primary()->constrained('identity_accounts');
            $t->unsignedInteger('revision');
            $t->boolean('use_archive');
            $t->boolean('auto_delete_after_7_days');
            $t->uuid('operation_id');
            $t->timestampsTz();
        });
        Schema::create('browser_archive_preference_events_v1',static function(Blueprint $t):void{
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->foreignUuid('writer_device_id')->constrained('identity_devices');
            $t->unsignedInteger('from_revision');
            $t->unsignedInteger('to_revision');
            $t->char('contract_hash',64);
            $t->text('contract_json');
            $t->text('account_signature');
            $t->timestampTz('created_at');
            $t->unique(['account_id','to_revision'],'archive_preference_account_revision');
        });
    }

    public function down():void
    {
        if((Schema::hasTable('browser_archive_preferences_v1')
                &&DB::table('browser_archive_preferences_v1')->exists())
            ||(Schema::hasTable('browser_archive_preference_events_v1')
                &&DB::table('browser_archive_preference_events_v1')->exists()))
            throw new \RuntimeException('pb3.archive_preferences.rollback_forbidden');
        Schema::dropIfExists('browser_archive_preference_events_v1');
        Schema::dropIfExists('browser_archive_preferences_v1');
    }
};
