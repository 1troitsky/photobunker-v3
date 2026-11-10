<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::table('assignment_records_v1',function(Blueprint $t):void{
            $t->longText('latest_policy_contract')->nullable();
            $t->text('latest_policy_signature')->nullable();
        });
        Schema::create('assignment_policy_events_v1',function(Blueprint $t):void{
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('assignment_id')->constrained('assignment_records_v1');
            $t->unsignedInteger('from_revision');
            $t->unsignedInteger('to_revision');
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->unsignedBigInteger('occurred_at_ms');
            $t->timestampTz('created_at');
            $t->unique(['assignment_id','to_revision'],'assignment_policy_unique_revision');
            $t->index(['assignment_id','occurred_at_ms']);
        });
    }

    public function down():void
    {
        Schema::dropIfExists('assignment_policy_events_v1');
        Schema::table('assignment_records_v1',function(Blueprint $t):void{
            $t->dropColumn(['latest_policy_contract','latest_policy_signature']);
        });
    }
};
