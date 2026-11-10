<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::table('assignment_records_v1',function(Blueprint $t):void{
            // Creation remains immutable. The latest separately owner-signed
            // lifecycle command is verifiable by independently pinned clients.
            $t->longText('latest_state_contract')->nullable();
            $t->text('latest_state_signature')->nullable();
        });
        Schema::create('assignment_state_events_v1',function(Blueprint $t):void{
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('assignment_id')->constrained('assignment_records_v1');
            $t->unsignedInteger('from_revision');
            $t->unsignedInteger('to_revision');
            $t->string('state',16);
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->timestampTz('created_at');
            $t->unique(['assignment_id','to_revision'],'assignment_state_unique_revision');
        });
    }

    public function down():void
    {
        Schema::dropIfExists('assignment_state_events_v1');
        Schema::table('assignment_records_v1',function(Blueprint $t):void{
            $t->dropColumn(['latest_state_contract','latest_state_signature']);
        });
    }
};
