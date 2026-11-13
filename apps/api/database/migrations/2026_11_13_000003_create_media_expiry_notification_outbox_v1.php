<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::create('media_expiry_notification_outbox_v1',static function(Blueprint $table):void{
            // Outbox survives media physical deletion; no cascade FK to media.
            $table->uuid('media_id')->primary();
            $table->uuid('account_id');
            $table->unsignedBigInteger('expired_at_ms');
            $table->timestampTz('created_at');
            $table->timestampTz('published_at')->nullable();
            $table->index(['published_at','created_at'],'media_expiry_notice_pending_idx');
        });
    }

    public function down():void
    {
        throw new RuntimeException('pb3.media_expiry_notices.rollback_forbidden');
    }
};
