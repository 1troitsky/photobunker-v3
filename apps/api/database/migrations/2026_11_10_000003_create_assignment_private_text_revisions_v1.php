<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::table('assignment_records_v1',function(Blueprint $t):void{
            $t->unsignedInteger('private_revision')->default(1);
            $t->longText('latest_private_contract')->nullable();
            $t->text('latest_private_signature')->nullable();
        });
        Schema::create('assignment_private_events_v1',function(Blueprint $t):void{
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('assignment_id')->constrained('assignment_records_v1');
            $t->unsignedInteger('from_revision');
            $t->unsignedInteger('to_revision');
            $t->char('contract_hash',64);
            $t->longText('contract_json'); // owner-signed ciphertext only
            $t->text('owner_signature');
            $t->string('cipher_iv',16); // 12 random bytes encoded base64url
            $t->unsignedBigInteger('occurred_at_ms');
            $t->timestampTz('created_at');
            $t->unique(['assignment_id','to_revision'],'assignment_private_revision_unique');
            $t->unique(['assignment_id','cipher_iv'],'assignment_private_nonce_unique');
            $t->index(['assignment_id','from_revision']);
        });
    }

    public function down():void
    {
        Schema::dropIfExists('assignment_private_events_v1');
        Schema::table('assignment_records_v1',function(Blueprint $t):void{
            $t->dropColumn(['private_revision','latest_private_contract','latest_private_signature']);
        });
    }
};
