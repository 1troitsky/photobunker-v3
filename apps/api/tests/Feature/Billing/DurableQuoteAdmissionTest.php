<?php
declare(strict_types=1);

namespace Tests\Feature\Billing;

use App\Billing\Checkout\DurableQuoteAdmission;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * #225: true DB-backed PRE-SETTLEMENT quote isolation and retry tests.
 * No payment callback or entitlement activation is simulated.
 */
final class DurableQuoteAdmissionTest extends TestCase
{
    use RefreshDatabase;

    private const KEY = 'client-request-idempotency-000001';

    /** @var array<string,string> */
    private array $accounts = [];

    protected function setUp(): void
    {
        parent::setUp();
        foreach (['alice', 'bob', 'unready'] as $name) {
            $id = (string)Str::uuid();
            DB::table('identity_accounts')->insert([
                'id' => $id,
                'operation_id' => (string)Str::uuid(),
                'prepare_hash' => str_repeat('a', 64),
                'status' => $name === 'unready' ? 'pending' : 'ready',
                'reserved_until' => now()->addDay(),
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $this->accounts[$name] = $id;
        }
    }

    private function at(): CarbonImmutable
    {
        return CarbonImmutable::parse('2026-11-14T12:00:00Z');
    }

    private function store(): DurableQuoteAdmission
    {
        return $this->app->make(DurableQuoteAdmission::class);
    }

    /** @return array<string,mixed> */
    private function reserve(
        string $user = 'alice',
        string $key = self::KEY,
        string $plan = 'go',
        int $months = 6,
        ?CarbonImmutable $at = null,
    ): array {
        return $this->store()->reserve(
            $this->accounts[$user], $key, $plan, $months, $at ?? $this->at());
    }

    /** @param callable():mixed $action */
    private function rejects(callable $action, string $expected): void
    {
        try {
            $action();
            $this->fail('Expected an explicit checkout denial');
        } catch (RuntimeException $e) {
            $this->assertSame($expected, $e->getMessage());
        }
    }

    public function test_server_owned_quote_survives_reload_and_has_no_payment_effect(): void
    {
        $quote = $this->reserve();
        $this->assertSame('quoted', $quote['phase']);
        $this->assertSame('unverified', $quote['proofState']);
        $this->assertSame(8100, $quote['amountCents']);
        $this->assertDatabaseCount('checkout_quotes_v1', 1);
        $loaded = $this->store()->read(
            $this->accounts['alice'], $quote['invoiceId'], $this->at());
        $this->assertSame('quoted', $loaded['state']);
        $this->assertSame($quote, $loaded['quote']);
        $this->assertSame('quoted', DB::table('checkout_quotes_v1')
            ->where('invoice_id', $quote['invoiceId'])->value('state'));
        $this->assertSame(0, DB::table('billing_entitlement_snapshots_v1')->count());
        $this->assertSame(0, DB::table('billing_entitlement_heads_v1')->count());
        $this->assertStringNotContainsString(self::KEY, (string)DB::table('checkout_quotes_v1')
            ->where('invoice_id', $quote['invoiceId'])->value('quote_json'));
    }

    public function test_idempotent_retry_reuses_the_same_original_quote_including_after_expiry(): void
    {
        $first = $this->reserve();
        $second = $this->reserve();
        $expiredRetry = $this->reserve(at: $this->at()->addHours(1));
        $this->assertSame($first, $second);
        $this->assertSame($first, $expiredRetry);
        $this->assertDatabaseCount('checkout_quotes_v1', 1);
    }

    public function test_reused_key_different_order_is_conflict_without_second_invoice(): void
    {
        $this->reserve();
        $this->rejects(fn () => $this->reserve(plan: 'pro'), 'checkout.idempotency_conflict');
        $this->rejects(fn () => $this->reserve(months: 12), 'checkout.idempotency_conflict');
        $this->assertDatabaseCount('checkout_quotes_v1', 1);
    }

    public function test_same_idempotency_key_in_two_accounts_has_separate_invoices(): void
    {
        $alice = $this->reserve('alice');
        $bob = $this->reserve('bob');
        $this->assertNotSame($alice['invoiceId'], $bob['invoiceId']);
        $this->assertNotSame($alice['quoteDigest'], $bob['quoteDigest']);
        $this->assertNotSame($alice['idempotencyKeySha256'], $bob['idempotencyKeySha256']);
        $this->assertDatabaseCount('checkout_quotes_v1', 2);
        $this->rejects(
            fn () => $this->store()->read($this->accounts['bob'], $alice['invoiceId'], $this->at()),
            'checkout.invoice_unavailable');
        $this->rejects(
            fn () => $this->store()->close($this->accounts['bob'], $alice['invoiceId'], 'cancel', $this->at()),
            'checkout.invoice_unavailable');
    }

    public function test_not_ready_or_unknown_identity_cannot_make_invoice(): void
    {
        $this->rejects(fn () => $this->reserve('unready'), 'checkout.identity_unavailable');
        $this->rejects(fn () => $this->store()->reserve(
            (string)Str::uuid(), self::KEY, 'go', 1, $this->at()), 'checkout.identity_unavailable');
        $this->assertDatabaseCount('checkout_quotes_v1', 0);
    }

    public function test_cancel_persists_once_and_does_not_resurrect_or_pay(): void
    {
        $quote = $this->reserve();
        $id = $quote['invoiceId'];
        $store = $this->store();
        $this->assertSame('cancelled',
            $store->close($this->accounts['alice'], $id, 'cancel', $this->at()));
        $this->assertSame('cancelled',
            $store->close($this->accounts['alice'], $id, 'cancel', $this->at()->addMinute()));
        $this->assertSame('cancelled',
            $store->read($this->accounts['alice'], $id, $this->at())['state']);
        $this->rejects(
            fn () => $store->close($this->accounts['alice'], $id, 'expire', $this->at()->addMinutes(20)),
            'checkout.invoice_finalized');
        $this->assertSame($quote, $this->reserve());
        $this->assertDatabaseCount('checkout_quotes_v1', 1);
        $this->assertSame(0, DB::table('billing_entitlement_heads_v1')->count());
    }

    public function test_expiry_is_exact_and_only_authentic_transition_can_close(): void
    {
        $quote = $this->reserve();
        $id = $quote['invoiceId'];
        $store = $this->store();
        $this->rejects(
            fn () => $store->close($this->accounts['alice'], $id, 'expire',
                $this->at()->addSeconds(899)), 'checkout.settlement_not_verified');
        $this->assertSame('quoted', $store->read(
            $this->accounts['alice'], $id, $this->at()->addSeconds(900))['state']);
        $this->assertSame('expired',
            $store->close($this->accounts['alice'], $id, 'expire', $this->at()->addSeconds(900)));
        $this->assertSame('expired',
            $store->close($this->accounts['alice'], $id, 'expire', $this->at()->addHours(2)));
        $this->rejects(
            fn () => $store->close($this->accounts['alice'], $id, 'cancel',
                $this->at()->addHours(2)), 'checkout.invoice_finalized');
    }

    public function test_fake_pending_confirmed_provider_receipts_never_write_database(): void
    {
        $quote = $this->reserve();
        foreach (['pending', 'confirmed', 'settlement_callback', 'refund', 'paid'] as $action) {
            $this->rejects(fn () => $this->store()->close(
                $this->accounts['alice'], $quote['invoiceId'], $action, $this->at()
            ), 'checkout.settlement_not_verified');
        }
        $this->assertSame('quoted', DB::table('checkout_quotes_v1')
            ->where('invoice_id', $quote['invoiceId'])->value('state'));
        $this->assertSame(0, DB::table('billing_entitlement_heads_v1')->count());
    }

    public function test_integrity_enforcement_detects_tampered_quote_or_independent_index(): void
    {
        $quote = $this->reserve();
        $id = $quote['invoiceId'];
        DB::table('checkout_quotes_v1')->where('invoice_id', $id)
            ->update(['quote_digest' => str_repeat('f', 64)]);
        $this->rejects(
            fn () => $this->store()->read($this->accounts['alice'], $id, $this->at()),
            'checkout.quote_tampered');

        DB::table('checkout_quotes_v1')->where('invoice_id', $id)
            ->update(['quote_digest' => $quote['quoteDigest'], 'requested_plan_id' => 'pro']);
        $this->rejects(
            fn () => $this->store()->read($this->accounts['alice'], $id, $this->at()),
            'checkout.quote_row_mismatch');

        DB::table('checkout_quotes_v1')->where('invoice_id', $id)
            ->update(['requested_plan_id' => 'go', 'state' => 'confirmed']);
        $this->rejects(
            fn () => $this->store()->read($this->accounts['alice'], $id, $this->at()),
            'checkout.invalid_state');
    }

    public function test_closed_quotes_do_not_allow_fake_state_or_deleted_evidence(): void
    {
        $quote = $this->reserve();
        $this->store()->close($this->accounts['alice'], $quote['invoiceId'], 'cancel', $this->at());
        DB::table('checkout_quotes_v1')->where('invoice_id', $quote['invoiceId'])
            ->update(['closed_at' => null]);
        $this->rejects(
            fn () => $this->store()->read($this->accounts['alice'], $quote['invoiceId'], $this->at()),
            'checkout.invalid_state');
    }
}
