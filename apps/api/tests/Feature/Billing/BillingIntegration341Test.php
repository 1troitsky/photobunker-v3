<?php
declare(strict_types=1);

namespace Tests\Feature\Billing;

use App\Billing\Checkout\DurableQuoteAdmission;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Integration #341: quoted/unverified checkout must never create paid rights,
 * bypass backup admission, or claim merchant settlement.
 */
final class BillingIntegration341Test extends TestCase
{
    use RefreshDatabase;

    public function test_quote_keeps_entitlement_free_and_backup_read_only(): void
    {
        $account = (string) Str::uuid();
        $device = (string) Str::uuid();
        DB::table('identity_accounts')->insert([
            'id' => $account,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'reserved_until' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('identity_devices')->insert([
            'id' => $device,
            'account_id' => $account,
            'signing_spki' => 'integration-341-test-spki',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->withSession([
            'identity_account' => $account,
            'identity_device' => $device,
            'identity_issued' => time(),
        ]);

        $quote = app(DurableQuoteAdmission::class)->reserve(
            $account,
            'integration-341-idempotent-request',
            'unlimited_plus',
            1,
            CarbonImmutable::now('UTC'),
        );
        $this->assertSame('quoted', $quote['phase']);
        $this->assertSame('unverified', $quote['proofState']);
        $this->assertDatabaseHas('checkout_quotes_v1', [
            'account_id' => $account,
            'state' => 'quoted',
        ]);

        $this->getJson('/billing/v1/me')->assertOk()
            ->assertJsonPath('entitlement.effectivePlanId', 'free')
            ->assertJsonPath('lifecycle.effectivePlanId', 'free')
            ->assertJsonPath('lifecycle.paidPrivilegesActive', false)
            ->assertJsonPath('lifecycle.existingMediaPolicy', 'immutable_signed_ttl_and_current_acl');

        $this->getJson('/backup/v1/limits')->assertOk()
            ->assertJsonPath('technicalGate', 'clear')
            ->assertJsonPath('scope', 'advisory_only_not_backup_eligibility_or_verified_backup');
        $this->postJson('/backup/v1/start', ['planId' => 'unlimited_plus'])->assertNotFound();
        $this->postJson('/billing/v1/settlement', ['invoiceId' => $quote['invoiceId']])->assertNotFound();

        $this->assertDatabaseCount('backup_start_operations_v1', 0);
        $this->assertDatabaseCount('checkout_quotes_v1', 1);
        $this->assertDatabaseCount('billing_entitlement_snapshots_v1', 1);
    }
}
