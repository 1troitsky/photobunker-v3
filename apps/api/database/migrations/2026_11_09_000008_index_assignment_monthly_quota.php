<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::table('assignment_records_v1', function(Blueprint $table):void{
            $table->index(['owner_account_id','created_at'],
                'assignment_owner_creation_month');
        });
    }

    public function down():void
    {
        Schema::table('assignment_records_v1', function(Blueprint $table):void{
            $table->dropIndex('assignment_owner_creation_month');
        });
    }
};
