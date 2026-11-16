<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void {
        Schema::create('public_cards_v1',function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->uuid('source_id');$t->string('source_kind',8);
            $t->char('source_contract_hash',64);
            $t->char('token_hash',64)->unique();
            $t->longText('contract_json');$t->text('signature');
            $t->char('contract_hash',64);$t->unsignedBigInteger('expires_at');
            $t->unsignedInteger('bytes');$t->char('sha256',64);
            $t->string('object_key',220)->unique();
            $t->string('state',16)->default('pending');
            $t->timestampsTz();
            $t->index(['account_id','source_kind','source_id']);
            $t->index(['state','expires_at']);
        });
    }
    public function down():void {Schema::dropIfExists('public_cards_v1');}
};
