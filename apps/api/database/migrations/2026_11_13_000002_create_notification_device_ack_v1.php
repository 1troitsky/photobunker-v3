<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('notification_device_ack_v1', static function (Blueprint $table): void {
            $table->foreignUuid('device_id')->primary()->constrained('identity_devices');
            $table->foreignUuid('account_id')->constrained('identity_accounts');
            $table->unsignedBigInteger('ack_cursor')->default(0);
            $table->timestampTz('updated_at');
            $table->index(['account_id', 'ack_cursor'], 'notif_device_account_ack_idx');
        });
    }

    public function down(): void
    {
        // An acknowledged notification cursor is durable sync evidence.
        throw new RuntimeException('pb3.notification_device_ack.rollback_forbidden');
    }
};
