<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('backup_start_operations_v1', function (Blueprint $table): void {
            $table->uuid('operation_id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts');
            $table->uuid('lease_id')->unique();
            $table->string('state', 16); // reserved, started, completed, failed, canceled, expired
            $table->timestampTz('reserved_at');
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('lease_expires_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->index(['account_id', 'accepted_at'], 'backup_account_accepted_idx');
            $table->index(['state', 'lease_expires_at'], 'backup_stale_lease_idx');
        });

        // Physical last line of defense. Account-level FOR UPDATE serializes
        // reservations; this index prevents a second active operation even if
        // a future caller accidentally bypasses the admission service.
        // Supported by PostgreSQL 18 and SQLite for local unit tests.
        DB::statement("CREATE UNIQUE INDEX backup_one_active_per_account_idx
            ON backup_start_operations_v1(account_id)
            WHERE state IN ('reserved', 'started')");
    }

    public function down(): void
    {
        Schema::dropIfExists('backup_start_operations_v1');
    }
};
