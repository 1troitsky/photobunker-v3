<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        // Immutable v1 history is untouched: a previously excluded recipient
        // may be re-invited only under a DIFFERENT, newer Team DEK epoch.
        Schema::create('team_invites_v2',static function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('team_id')->constrained('team_records_v1');
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->foreignUuid('recipient_account_id')->constrained('identity_accounts');
            $t->uuid('operation_id')->unique();
            $t->unsignedInteger('key_epoch');
            $t->unsignedInteger('membership_revision');
            $t->char('root_contract_hash',64);
            $t->char('epoch_contract_hash',64);
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
            // One consent request per recipient per key epoch (no accidental
            // re-use of a signed envelope after rejection, expiry, exclusion).
            $t->unique(['team_id','recipient_account_id','key_epoch'],
                'team_invite_epoch_recipient_once');
            $t->index(['recipient_account_id','state','id'],
                'team_invite_v2_inbox');
            $t->index(['team_id','id'],'team_invite_v2_roster');
        });
    }

    public function down():void
    {
        // Signed envelopes/consents are security evidence, even revoked ones.
        if(Schema::hasTable('team_invites_v2')
            &&DB::table('team_invites_v2')->exists())
            throw new \RuntimeException('pb3.team_invites_v2.rollback_forbidden');
        Schema::dropIfExists('team_invites_v2');
    }
};
