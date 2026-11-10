<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::table('team_records_v1',static function(Blueprint $t):void{
            $t->unsignedInteger('membership_revision')->default(1);
            $t->unsignedInteger('key_epoch')->default(1);
            $t->boolean('rotation_required')->default(false);
        });
        Schema::create('team_membership_events_v1',static function(Blueprint $t):void{
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('team_id')->constrained('team_records_v1');
            $t->foreignUuid('target_account_id')->constrained('identity_accounts');
            $t->uuid('invite_id');
            $t->string('action',24);
            $t->string('previous_role',20);
            $t->string('next_role',20)->nullable();
            $t->unsignedInteger('from_revision');
            $t->unsignedInteger('to_revision');
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->timestampsTz();
            $t->unique(['team_id','to_revision'],'team_membership_revision_once');
            $t->index(['team_id','operation_id'],'team_membership_audit');
        });
    }

    public function down():void
    {
        // Fail closed before removing any revision, ACL or quarantine fields.
        // This alone is not a live production migration lock: stop writers first.
        if((Schema::hasTable('team_membership_events_v1')
                &&DB::table('team_membership_events_v1')->exists())
            ||(Schema::hasColumn('team_records_v1','rotation_required')
                &&DB::table('team_records_v1')->where('rotation_required',true)->exists())
            ||(Schema::hasColumn('team_records_v1','membership_revision')
                &&DB::table('team_records_v1')->where('membership_revision','>',1)->exists())){
            throw new \RuntimeException('pb3.team_membership.rollback_forbidden');
        }
        Schema::dropIfExists('team_membership_events_v1');
        Schema::table('team_records_v1',static function(Blueprint $t):void{
            $t->dropColumn(['membership_revision','key_epoch','rotation_required']);
        });
    }
};
