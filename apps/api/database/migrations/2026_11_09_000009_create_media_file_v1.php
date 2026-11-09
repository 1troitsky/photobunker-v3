<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Independent media/v1 namespace. Keep photos/v1 and its FK/keys unchanged.
 * A physical media chunk has exactly one logical owner and one initial S3
 * placement, extendible later to several independent replicas.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::create('media_files_v1', static function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->foreignUuid('device_id')->constrained('identity_devices');
            $t->uuid('operation_id');
            $t->string('media_type',8);
            $t->string('state',20)->default('pending');
            $t->unsignedBigInteger('expires_at');
            $t->unsignedBigInteger('plain_bytes');
            $t->unsignedBigInteger('cipher_bytes');
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('signature');
            $t->json('receipt')->nullable();
            $t->timestampTz('cleanup_next_at')->nullable();
            $t->timestampsTz();
            $t->unique(['account_id','operation_id'],'media_operation_unique');
            $t->index(['account_id','state','expires_at','id'],'media_account_cursor');
            $t->index(['state','expires_at','id'],'media_expiry_cursor');
        });
        Schema::create('media_chunks_v1',static function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('media_id')->constrained('media_files_v1');
            $t->unsignedInteger('chunk_index');
            $t->string('kind',12);
            $t->unsignedBigInteger('plain_bytes');
            $t->unsignedBigInteger('bytes');
            $t->char('sha256',64);
            $t->string('iv',24);
            $t->string('state',20)->default('pending');
            $t->timestampsTz();
            $t->unique(['media_id','chunk_index'],'media_chunk_index_unique');
            $t->index(['media_id','state']);
            $t->index(['state','updated_at','id']);
        });
        Schema::create('media_chunk_locations_v1',static function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('chunk_id')->constrained('media_chunks_v1');
            $t->string('provider',48);
            $t->string('object_key',220);
            $t->char('sha256',64);
            $t->unsignedBigInteger('bytes');
            $t->string('state',24)->default('reserved');
            $t->timestampsTz();
            $t->unique(['provider','object_key'],'media_object_key_unique');
            $t->index(['chunk_id','state']);
        });
        Schema::create('media_tombstones_v1',static function(Blueprint $t):void{
            $t->uuid('media_id')->primary();
            $t->uuid('account_id')->index();
            $t->uuid('operation_id');
            $t->json('object_keys');
            $t->timestampTz('next_sweep_at')->index();
            $t->timestampTz('created_at');
        });
    }
    public function down():void
    {
        Schema::dropIfExists('media_tombstones_v1');
        Schema::dropIfExists('media_chunk_locations_v1');
        Schema::dropIfExists('media_chunks_v1');
        Schema::dropIfExists('media_files_v1');
    }
};
