<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::create('team_invites_v1',static function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('team_id')->constrained('team_records_v1');
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->foreignUuid('recipient_account_id')->constrained('identity_accounts');
            $t->uuid('operation_id')->unique();
            $t->string('role',20);
            $t->string('state',16)->default('pending');
            $t->char('recipient_key_digest',64);
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->unsignedBigInteger('expires_at');
            $t->uuid('accepted_operation_id')->nullable()->unique();
            $t->longText('accepted_contract')->nullable();
            $t->text('accepted_signature')->nullable();
            $t->timestampTz('accepted_at')->nullable();
            $t->timestampsTz();
            $t->unique(['team_id','recipient_account_id'],'team_invite_single_recipient_v1');
            $t->index(['recipient_account_id','state','id'],'team_invite_inbox_v1');
            $t->index(['team_id','id'],'team_invite_roster_v1');
        });
    }

    public function down():void
    {
        // Losing signed invitation/consent history silently is a security
        // regression, even if a grant has expired. Stop writers separately.
        if(Schema::hasTable('team_invites_v1')
            &&DB::table('team_invites_v1')->exists()){
            throw new \RuntimeException('pb3.team_invites.rollback_forbidden');
        }
        Schema::dropIfExists('team_invites_v1');
    }
};
