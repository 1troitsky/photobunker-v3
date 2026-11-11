<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Browser folder snapshots contain ONLY opaque E2EE ciphertext.
 * No filenames, folder hierarchy or media permission data on the server.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::create('browser_folder_snapshots_v1',static function(Blueprint $t):void {
            $t->foreignUuid('account_id')->primary()->constrained('identity_accounts');
            $t->unsignedBigInteger('revision');
            $t->unsignedInteger('key_revision');
            $t->foreignUuid('writer_device_id')->constrained('identity_devices');
            $t->uuid('operation_id')->unique();
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('account_signature');
            $t->timestampsTz();
        });
        Schema::create('browser_folder_events_v1',static function(Blueprint $t):void {
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->foreignUuid('writer_device_id')->constrained('identity_devices');
            $t->unsignedBigInteger('from_revision');
            $t->unsignedBigInteger('to_revision');
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('account_signature');
            $t->timestampTz('created_at');
            $t->unique(['account_id','to_revision'],'browser_folder_account_revision');
        });
    }

    public function down():void
    {
        // Never destroy an unexported account's encrypted folder hierarchy.
        if ((Schema::hasTable('browser_folder_snapshots_v1')
                &&DB::table('browser_folder_snapshots_v1')->exists())
            ||(Schema::hasTable('browser_folder_events_v1')
                &&DB::table('browser_folder_events_v1')->exists()))
            throw new \RuntimeException('pb3.browser_folders.rollback_forbidden');
        Schema::dropIfExists('browser_folder_events_v1');
        Schema::dropIfExists('browser_folder_snapshots_v1');
    }
};
