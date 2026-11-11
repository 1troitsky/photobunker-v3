<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Append-only Matrix 4S escrow revision lineage.
 * Legacy v1 escrow remains immutable and is the first chain anchor.
 * No plaintext secrets or Matrix access tokens are held by this table.
 */
return new class extends Migration {
    public function up():void {
        Schema::create('matrix_recovery_escrow_revisions_v2',
            static function(Blueprint $t):void {
                $t->foreignUuid('account_id')
                    ->references('account_id')->on('matrix_account_bindings_v1');
                $t->unsignedInteger('account_revision');
                $t->uuid('operation_id')->unique();
                $t->char('parent_contract_hash',64);
                $t->char('contract_hash',64);
                $t->longText('contract_json');
                $t->text('account_signature');
                $t->timestampsTz();
                $t->primary(['account_id','account_revision'],'mx_escrow_revision_pk');
            }
        );
    }
    public function down():void {
        // Never discard historical encrypted key envelopes during rollback.
        if(Schema::hasTable('matrix_recovery_escrow_revisions_v2')
           &&DB::table('matrix_recovery_escrow_revisions_v2')->exists()) {
            throw new \RuntimeException('pb3.matrix_recovery_v2.rollback_forbidden');
        }
        Schema::dropIfExists('matrix_recovery_escrow_revisions_v2');
    }
};
