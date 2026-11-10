<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Matrix identifiers are NOT PB3 auth credentials or E2EE keys.
 * This signed identity/device mapping never stores Matrix access tokens.
 */
return new class extends Migration {
    public function up():void {
        Schema::create('matrix_account_bindings_v1',static function(Blueprint $t):void {
            $t->foreignUuid('account_id')->primary()->constrained('identity_accounts');
            $t->string('homeserver_url',255);
            $t->string('matrix_user_id',255);
            $t->timestampsTz();
            $t->unique(['homeserver_url','matrix_user_id'],'mx_user_unique');
        });
        Schema::create('matrix_device_bindings_v1',static function(Blueprint $t):void {
            $t->foreignUuid('pb3_device_id')->primary()->constrained('identity_devices');
            $t->foreignUuid('account_id')->references('account_id')->on('matrix_account_bindings_v1');
            $t->string('matrix_device_id',128);
            $t->uuid('operation_id')->unique();
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('account_signature');
            $t->text('device_signature');
            $t->timestampsTz();
            $t->unique(['account_id','matrix_device_id'],'mx_device_unique');
        });
    }
    public function down():void {
        // Signed mappings must not disappear during a routine rollback.
        if ((Schema::hasTable('matrix_device_bindings_v1')
                &&DB::table('matrix_device_bindings_v1')->exists())
            ||(Schema::hasTable('matrix_account_bindings_v1')
                &&DB::table('matrix_account_bindings_v1')->exists())) {
            throw new \RuntimeException('pb3.matrix.rollback_forbidden');
        }
        Schema::dropIfExists('matrix_device_bindings_v1');
        Schema::dropIfExists('matrix_account_bindings_v1');
    }
};
