<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up():void {
        Schema::create('photo_records',function(Blueprint $t){
            $t->uuid('id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->foreignUuid('device_id')->constrained('identity_devices');
            $t->uuid('operation_id');
            $t->string('state',20)->default('pending'); // pending|active|deleting
            $t->unsignedBigInteger('expires_at'); // trusted UTC milliseconds
            $t->char('contract_hash',64);
            $t->uuid('metadata_asset_id')->nullable();
            $t->unsignedInteger('metadata_revision')->default(1);
            $t->longText('contract_json');
            $t->text('signature');
            $t->json('receipt')->nullable();
            $t->unsignedInteger('cleanup_attempts')->default(0);
            $t->timestampTz('cleanup_next_at')->nullable();
            $t->timestampsTz();
            $t->unique(['account_id','operation_id']);
            $t->index(['state','expires_at','id']);
            $t->index(['account_id','state','expires_at','id']);
            $t->index(['state','cleanup_next_at','id']);
        });
        Schema::create('photo_objects',function(Blueprint $t){
            $t->uuid('id')->primary();
            $t->foreignUuid('photo_id')->constrained('photo_records');
            $t->string('kind',20);$t->unsignedInteger('revision');
            $t->unsignedBigInteger('bytes');$t->char('sha256',64);
            $t->longText('manifest_json');$t->string('object_key',220)->unique();
            $t->string('state',20)->default('pending'); // pending|uploading|verified|active
            $t->timestampsTz();$t->index(['photo_id','state']);
            $t->index(['state','updated_at','id']);
        });
        Schema::create('photo_tombstones',function(Blueprint $t){
            $t->uuid('photo_id')->primary();
            $t->uuid('account_id')->index();
            $t->uuid('operation_id');$t->string('reason',20);
            $t->json('object_keys')->nullable(); // transient opaque keys for late-write reconciliation
            $t->timestampTz('cleanup_until')->nullable()->index();
            $t->timestampTz('created_at');
        });
    }
    public function down():void{
        Schema::dropIfExists('photo_tombstones');Schema::dropIfExists('photo_objects');Schema::dropIfExists('photo_records');
    }
};
