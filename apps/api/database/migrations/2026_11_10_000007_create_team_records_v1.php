<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P1-27: real team ownership, separate from assignment/media ACL.
 * No team role grants decryption, assignment membership or file rights.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::create('team_records_v1',static function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->uuid('operation_id')->unique();
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->string('state',16)->default('active');
            $t->timestampsTz();
            $t->index(['owner_account_id','id'],'team_owner_page');
        });
        Schema::create('team_members_v1',static function(Blueprint $t):void{
            $t->foreignUuid('team_id')->constrained('team_records_v1');
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->string('role',20);
            $t->string('state',16)->default('active');
            $t->timestampsTz();
            $t->unique(['team_id','account_id'],'team_member_identity');
            $t->index(['account_id','state','team_id'],'team_member_inbox');
        });
    }

    public function down():void
    {
        Schema::dropIfExists('team_members_v1');
        Schema::dropIfExists('team_records_v1');
    }
};
