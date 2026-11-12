<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Only opaque provider/asset identifiers and retry state. Never store
 * ciphertext, request bodies, object keys, auth tokens or private metadata.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::create('storage_provider_health',static function(Blueprint $t):void{
            $t->string('provider',48)->primary();
            $t->string('state',16)->default('closed');
            $t->unsignedInteger('failures')->default(0);
            $t->timestampTz('open_until')->nullable();
            $t->timestampTz('probe_lease_until')->nullable();
            $t->timestampTz('last_success_at')->nullable();
            $t->timestampTz('last_failure_at')->nullable();
            $t->timestampsTz();
        });
        Schema::create('storage_retry_tickets',static function(Blueprint $t):void{
            $t->string('kind',16);
            $t->uuid('asset_id');
            $t->unsignedInteger('attempts')->default(0);
            $t->string('disposition',24)->default('pending');
            $t->timestampTz('next_attempt_at');
            $t->timestampTz('lease_until')->nullable();
            $t->timestampsTz();
            $t->primary(['kind','asset_id']);
            $t->index(['next_attempt_at','lease_until']);
        });
    }

    public function down():void
    {
        Schema::dropIfExists('storage_retry_tickets');
        Schema::dropIfExists('storage_provider_health');
    }
};
