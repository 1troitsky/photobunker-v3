<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * #225: deliberately inert QUOTED invoice ledger. No provider settlement,
 * paid state, live payment credentials, or entitlement FK is introduced.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('checkout_quotes_v1', function (Blueprint $table): void {
            $table->uuid('invoice_id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts');
            $table->char('idempotency_key_sha256', 64);
            $table->string('requested_plan_id', 24);
            $table->unsignedSmallInteger('period_months');
            $table->char('quote_digest', 64);
            $table->text('quote_json');
            $table->string('state', 16); // Only quoted, cancelled, expired.
            $table->timestampTz('issued_at');
            $table->timestampTz('expires_at');
            $table->timestampTz('closed_at')->nullable();
            $table->timestampTz('created_at');
            $table->timestampTz('updated_at');
            $table->unique(
                ['account_id', 'idempotency_key_sha256'],
                'checkout_account_idempotency_unique'
            );
            $table->index(['account_id', 'state', 'expires_at'], 'checkout_account_state_expiry_idx');
        });
    }

    public function down(): void
    {
        // Even pre-settlement invoice requests become financial audit evidence.
        // Never silently erase them through a production rollback.
        throw new RuntimeException('checkout.ledger_rollback_forbidden');
    }
};
