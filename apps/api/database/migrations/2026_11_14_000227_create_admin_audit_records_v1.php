<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // One pinned row is the transaction serialization point. It is NOT
        // an external tamper-evident anchor; a DB administrator can rewrite it.
        Schema::create('admin_audit_heads_v1', static function (Blueprint $table): void {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedBigInteger('revision');
            $table->char('last_digest', 64);
        });
        DB::table('admin_audit_heads_v1')->insert([
            'id' => 1, 'revision' => 0, 'last_digest' => str_repeat('0', 64),
        ]);

        Schema::create('admin_audit_records_v1', static function (Blueprint $table): void {
            $table->bigIncrements('sequence');
            $table->uuid('operation_id')->unique();
            $table->uuid('actor_id')->index();
            $table->string('action', 32);
            $table->string('target_type', 16);
            $table->string('target_reference', 64);
            $table->string('reason_code', 64);
            $table->unsignedBigInteger('issued_at_ms');
            $table->unsignedBigInteger('expires_at_ms')->nullable();
            $table->char('previous_digest', 64);
            $table->char('digest', 64);
            $table->text('event_json');
            $table->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_audit_records_v1');
        Schema::dropIfExists('admin_audit_heads_v1');
    }
};
