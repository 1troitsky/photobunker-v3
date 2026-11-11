<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Immutable owner-signed removal proof. Never overwrite the original signed
 * invitation, accepted contributor proof, or any contributor-owned content.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::create('assignment_member_removals_v1',static function(Blueprint $t):void {
            $t->uuid('operation_id')->primary();
            $t->uuid('assignment_id');
            $t->uuid('invite_id')->unique();
            $t->uuid('owner_account_id');
            $t->uuid('recipient_account_id');
            $t->char('contract_hash',64);
            $t->text('contract_json');
            $t->text('owner_signature');
            $t->timestamp('created_at');
            $t->index(['assignment_id','recipient_account_id']);
            $t->foreign('assignment_id')->references('id')
                ->on('assignment_records_v1')->restrictOnDelete();
            $t->foreign('invite_id')->references('id')
                ->on('assignment_invites_v1')->restrictOnDelete();
        });
    }

    public function down():void
    {
        if(Schema::hasTable('assignment_member_removals_v1')
            &&DB::table('assignment_member_removals_v1')->exists())
            throw new RuntimeException('pb3.assignment_removals.rollback_forbidden');
        Schema::dropIfExists('assignment_member_removals_v1');
    }
};
