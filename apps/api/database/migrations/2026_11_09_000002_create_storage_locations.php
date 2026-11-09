<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('storage_locations', static function(Blueprint $table):void {
            $table->uuid('id')->primary();
            $table->foreignUuid('asset_id')->constrained('photo_objects');
            $table->string('provider',48);
            $table->string('object_key',220);
            $table->char('sha256',64);
            $table->unsignedBigInteger('bytes');
            $table->string('state',24)->default('reserved');
            $table->timestampsTz();
            $table->unique(['provider','object_key']);
            $table->index(['asset_id','state']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storage_locations');
    }
};
