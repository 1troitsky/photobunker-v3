<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::table('assignment_records_v1',static function(Blueprint $table):void{
            $table->unsignedInteger('schedule_revision')->default(1);
            $table->longText('latest_schedule_contract')->nullable();
            $table->text('latest_schedule_signature')->nullable();
        });
        Schema::create('assignment_schedule_events_v1',static function(Blueprint $table):void{
            $table->uuid('operation_id')->primary();
            $table->foreignUuid('assignment_id')->constrained('assignment_records_v1');
            $table->unsignedInteger('from_revision');
            $table->unsignedInteger('to_revision');
            $table->char('contract_hash',64);
            $table->longText('contract_json');
            $table->text('owner_signature');
            $table->unsignedBigInteger('occurred_at_ms');
            $table->timestampTz('created_at');
            $table->unique(['assignment_id','to_revision']);
        });
    }

    public function down():void
    {
        Schema::dropIfExists('assignment_schedule_events_v1');
        Schema::table('assignment_records_v1',static function(Blueprint $table):void{
            $table->dropColumn([
                'schedule_revision','latest_schedule_contract','latest_schedule_signature',
            ]);
        });
    }
};
