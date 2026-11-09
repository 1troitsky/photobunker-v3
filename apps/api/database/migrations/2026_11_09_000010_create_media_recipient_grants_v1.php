<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::create('media_recipient_grants_v1',static function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('media_id')->constrained('media_files_v1');
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->foreignUuid('recipient_account_id')->constrained('identity_accounts');
            $t->char('recipient_key_digest',64);
            $t->char('media_contract_hash',64);
            $t->unsignedBigInteger('expires_at');
            $t->string('state',12)->default('active');
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('account_signature');
            $t->timestampTz('revoked_at')->nullable();
            $t->timestampsTz();
            $t->index(['recipient_account_id','state','expires_at','id'],'media_grant_recipient_page');
            $t->index(['owner_account_id','state','expires_at'],'media_grant_owner_active');
            $t->index(['media_id','state','expires_at'],'media_grant_media_access');
        });
    }
    public function down():void
    {
        Schema::dropIfExists('media_recipient_grants_v1');
    }
};
