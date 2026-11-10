<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('account_exchange_keys', function (Blueprint $t): void {
            $t->foreignUuid('account_id')->primary()->constrained('identity_accounts');
            $t->text('descriptor');
            $t->text('account_signature');
            $t->json('sealed_private');
            $t->char('descriptor_hash',64);
            $t->timestampsTz();
        });
        Schema::create('photo_access_grants', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('photo_id')->constrained('photo_records')->cascadeOnDelete();
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->foreignUuid('recipient_account_id')->constrained('identity_accounts');
            $t->char('recipient_key_digest',64);
            $t->unsignedBigInteger('expires_at');
            $t->string('state',12)->default('active');
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('account_signature');
            $t->timestampTz('revoked_at')->nullable();
            $t->timestampsTz();
            $t->index(['recipient_account_id','state','expires_at','id'],'grant_recipient_page');
            $t->index(['photo_id','state','expires_at'],'grant_photo_access');
        });
    }

    public function down(): void {
        Schema::dropIfExists('photo_access_grants');
        Schema::dropIfExists('account_exchange_keys');
    }
};
