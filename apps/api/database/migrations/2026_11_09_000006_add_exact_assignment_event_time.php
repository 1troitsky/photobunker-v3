<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::table('assignment_state_events_v1',function(Blueprint $t):void{
            // Laravel serializes DateTime SQL bindings to whole seconds.
            // Keep the authoritative server receipt boundary losslessly in ms.
            // NULL on pre-migration events is intentionally ambiguous within
            // that second; never invent a timestamp for old decisions.
            $t->bigInteger('occurred_at_ms')->nullable();
        });
    }

    public function down():void
    {
        Schema::table('assignment_state_events_v1',function(Blueprint $t):void{
            $t->dropColumn('occurred_at_ms');
        });
    }
};
