<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        // These records are owner-signed PRIVATE PREVIEW LIMITS, not grants.
        Schema::create('assignment_preview_ceilings_v1',static function(Blueprint $t):void{
            $t->foreignUuid('assignment_id')->primary()
                ->constrained('assignment_records_v1');
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->char('root_policy_hash',64);
            $t->unsignedSmallInteger('revision');
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->unsignedBigInteger('expires_at_ms');
            $t->timestampsTz();
        });
        Schema::create('assignment_preview_ceiling_events_v1',static function(Blueprint $t):void{
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('assignment_id')->constrained('assignment_records_v1');
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->unsignedSmallInteger('from_revision');
            $t->unsignedSmallInteger('to_revision');
            $t->char('previous_policy_hash',64);
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->timestampTz('created_at');
            $t->unique(['assignment_id','to_revision'],'assignment_preview_event_revision');
        });
    }

    public function down():void
    {
        // Never silently discard a live signature chain or forget an
        // assignment's limits during an accidental deployment rollback.
        if(DB::table('assignment_preview_ceilings_v1')->exists()
            ||DB::table('assignment_preview_ceiling_events_v1')->exists())
            throw new RuntimeException('pb3.assignment_preview.rollback_forbidden');
        Schema::dropIfExists('assignment_preview_ceiling_events_v1');
        Schema::dropIfExists('assignment_preview_ceilings_v1');
    }
};
