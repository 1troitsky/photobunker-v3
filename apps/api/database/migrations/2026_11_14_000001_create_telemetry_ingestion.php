<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('telemetry_event_receipts', static function (Blueprint $table): void {
            $table->char('event_token', 64)->primary();
            $table->char('fingerprint', 64);
            $table->timestampTz('received_at');
            $table->index('received_at');
        });

        Schema::create('telemetry_counters', static function (Blueprint $table): void {
            $table->string('metric', 48);
            $table->string('period_kind', 8);
            $table->string('period_key', 10);
            $table->unsignedBigInteger('total')->default(0);
            $table->primary(['metric', 'period_kind', 'period_key'], 'telemetry_counter_pk');
        });

        Schema::create('telemetry_active_tokens', static function (Blueprint $table): void {
            $table->string('period_kind', 8);
            $table->string('period_key', 10);
            $table->char('actor_token', 64);
            $table->primary(['period_kind', 'period_key', 'actor_token'], 'telemetry_actor_pk');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('telemetry_active_tokens');
        Schema::dropIfExists('telemetry_counters');
        Schema::dropIfExists('telemetry_event_receipts');
    }
};
