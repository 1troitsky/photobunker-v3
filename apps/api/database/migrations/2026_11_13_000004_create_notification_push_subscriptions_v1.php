<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('notification_push_subscriptions_v1', static function (Blueprint $t): void {
            $t->foreignUuid('device_id')->primary()->constrained('identity_devices');
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            // Stable opaque index for collision detection. The actual URL,
            // browser public key, and auth secret MUST remain encrypted.
            $t->char('endpoint_hash', 64)->unique();
            $t->text('subscription_ciphertext');
            $t->unsignedInteger('generation')->default(1);
            $t->timestampTz('created_at');
            $t->timestampTz('updated_at');
            $t->timestampTz('disabled_at')->nullable();
            $t->index(['account_id', 'disabled_at'], 'notif_push_account_active_idx');
        });
    }

    public function down(): void
    {
        // Stale browser subscriptions cannot be reactivated by rollback.
        throw new RuntimeException('pb3.notification_push_subscriptions.rollback_forbidden');
    }
};
