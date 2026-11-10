<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Immutable PB3-account-signed escrow for the Matrix 4S secret-storage key.
 * This is an encrypted SEED backup, not a recovered Matrix room-key backup.
 * The backend cannot read the key and stores no bearer tokens.
 */
return new class extends Migration {
    public function up():void {
        Schema::create('matrix_recovery_escrows_v1',static function(Blueprint $t):void {
            $t->foreignUuid('account_id')->primary()
                ->references('account_id')->on('matrix_account_bindings_v1');
            $t->unsignedInteger('account_revision');
            $t->uuid('operation_id')->unique();
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('account_signature');
            $t->timestampsTz();
        });
    }
    public function down():void {
        // An automated rollback must never silently destroy the only
        // potentially recoverable Matrix secret-storage key escrow.
        if(Schema::hasTable('matrix_recovery_escrows_v1')
           &&DB::table('matrix_recovery_escrows_v1')->exists()) {
            throw new \RuntimeException('pb3.matrix_recovery.rollback_forbidden');
        }
        Schema::dropIfExists('matrix_recovery_escrows_v1');
    }
};
