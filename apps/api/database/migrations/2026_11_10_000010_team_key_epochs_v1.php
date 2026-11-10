<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::create('team_key_epochs_v1',static function(Blueprint $t):void{
            $t->foreignUuid('team_id')->constrained('team_records_v1');
            $t->unsignedInteger('epoch');
            $t->uuid('operation_id')->unique();
            $t->unsignedInteger('membership_revision');
            $t->char('previous_epoch_hash',64);
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->unsignedInteger('recipient_count');
            $t->timestampsTz();
            $t->primary(['team_id','epoch'],'team_key_epoch_identity');
        });
        Schema::create('team_epoch_grants_v1',static function(Blueprint $t):void{
            $t->foreignUuid('team_id')->constrained('team_records_v1');
            $t->unsignedInteger('epoch');
            $t->foreignUuid('recipient_account_id')->constrained('identity_accounts');
            $t->string('role',20);
            $t->char('recipient_key_digest',64);
            $t->longText('envelope_json');
            $t->timestampsTz();
            $t->primary(['team_id','epoch','recipient_account_id'],
                'team_epoch_recipient_identity');
            $t->index(['recipient_account_id','team_id','epoch'],
                'team_epoch_member_lookup');
        });
    }

    public function down():void
    {
        // Dropping epoch evidence would remove the only secure way to read
        // surviving Team DEKs. Fail closed even if grants have been revoked.
        if((Schema::hasTable('team_key_epochs_v1')
                &&DB::table('team_key_epochs_v1')->exists())
            ||(Schema::hasTable('team_epoch_grants_v1')
                &&DB::table('team_epoch_grants_v1')->exists())
            ||(Schema::hasColumn('team_records_v1','key_epoch')
                &&DB::table('team_records_v1')->where('key_epoch','>',1)->exists())){
            throw new \RuntimeException('pb3.team_epochs.rollback_forbidden');
        }
        Schema::dropIfExists('team_epoch_grants_v1');
        Schema::dropIfExists('team_key_epochs_v1');
    }
};
