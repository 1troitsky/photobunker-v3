<?php
declare(strict_types=1);

namespace Tests\Feature\Billing;

use App\Billing\Checkout\InvoiceLifecycle;
use App\Plans\PlanCatalog;
use Carbon\CarbonImmutable;
use RuntimeException;
use Tests\TestCase;

/**
 * #225: PRE-SETTLEMENT contract only. These tests must never advance
 * EntitlementLedger or simulate a successful blockchain payment.
 */
final class CheckoutInvoiceLifecycleTest extends TestCase
{
    private const ACCOUNT = '11111111-1111-4111-8111-111111111111';
    private const OTHER = '22222222-2222-4222-8222-222222222222';
    private const INVOICE = '33333333-3333-4333-8333-333333333333';
    private const KEY = 'unique-request-token-0001';

    private function clock(): CarbonImmutable
    {
        return CarbonImmutable::parse('2026-11-14T12:00:00Z');
    }

    private function policy(): InvoiceLifecycle
    {
        return new InvoiceLifecycle($this->app->make(PlanCatalog::class));
    }

    /** @return array<string, mixed> */
    private function quote(string $plan = 'go', int $months = 6): array
    {
        return $this->policy()->quote(
            self::ACCOUNT, self::INVOICE, self::KEY, $plan, $months, $this->clock());
    }

    /** @param array<string, mixed> $quote */
    private function assertRejected(array $quote, string $digest, string $account): void
    {
        try {
            InvoiceLifecycle::assertStoredQuote($quote, $digest, $account, $this->clock());
            $this->fail('Untrusted quote should be rejected');
        } catch (RuntimeException $e) {
            $this->assertStringStartsWith('checkout.', $e->getMessage());
        }
    }

    public function test_five_plan_period_prices_are_taken_only_from_trusted_catalog(): void
    {
        $expected = [
            'go' => [1 => 1500, 6 => 8100, 12 => 15300],
            'pro' => [1 => 3000, 6 => 15300, 12 => 28800],
            'unlimited' => [1 => 5000, 6 => 24000, 12 => 42000],
            'unlimited_plus' => [1 => 10000, 6 => 48000, 12 => 84000],
        ];
        foreach ($expected as $plan => $periods) {
            foreach ($periods as $months => $cents) {
                $quote = $this->quote($plan, $months);
                $this->assertSame('quoted', $quote['phase']);
                $this->assertSame('unverified', $quote['proofState']);
                $this->assertSame('USD', $quote['currency']);
                $this->assertSame($cents, $quote['amountCents']);
                $this->assertSame($plan, $quote['planId']);
                $this->assertSame('pb3-2026-11-12', $quote['catalogVersion']);
                $this->assertSame(64, strlen($quote['definitionSha256']));
                $this->assertSame($quote['basePriceCents'] - $cents, $quote['discountCents']);
                InvoiceLifecycle::assertStoredQuote(
                    $quote, $quote['quoteDigest'], self::ACCOUNT, $this->clock());
            }
        }
        $this->assertSame('2026-11-14T12:15:00Z', $this->quote()['expiresAt']);
    }

    public function test_free_plan_and_invalid_period_cannot_be_purchased(): void
    {
        foreach ([['free', 1], ['go', 2], ['go', 0], ['go', 13]] as [$plan, $months]) {
            try {
                $this->quote($plan, $months);
                $this->fail('Invalid plan/period should fail');
            } catch (RuntimeException $e) {
                $this->assertSame('checkout.invalid_order', $e->getMessage());
            }
        }
    }

    public function test_unknown_plan_fails_closed(): void
    {
        $this->expectException(RuntimeException::class);
        $this->quote('partner_special', 1);
    }

    public function test_account_invoice_and_idempotency_inputs_are_strictly_validated(): void
    {
        $policy = $this->policy();
        foreach ([
            ['account', self::INVOICE, self::KEY],
            [self::ACCOUNT, 'user-supplied-number', self::KEY],
            [self::ACCOUNT, self::INVOICE, 'short'],
            [self::ACCOUNT, self::INVOICE, str_repeat('x', 129)],
        ] as [$account, $invoice, $key]) {
            try {
                $policy->quote($account, $invoice, $key, 'go', 1, $this->clock());
                $this->fail('Invalid identity or request must fail');
            } catch (RuntimeException $e) {
                $this->assertStringStartsWith('checkout.', $e->getMessage());
            }
        }
    }

    public function test_quote_digest_is_not_payment_proof_and_snapshot_tamper_is_denied(): void
    {
        $original = $this->quote();
        foreach ([
            ['amountCents', 1],
            ['discountCents', 1],
            ['phase', 'confirmed'],
            ['proofState', 'provider_verified'],
            ['planId', 'unlimited_plus'],
            ['currency', 'EUR'],
            ['idempotencyKeySha256', str_repeat('0', 64)],
            ['expiresAt', '2030-01-01T00:00:00Z'],
        ] as [$field, $value]) {
            $tampered = $original;
            $tampered[$field] = $value;
            $this->assertRejected($tampered, $original['quoteDigest'], self::ACCOUNT);
        }
        $additional = $original;
        $additional['walletPrivateKey'] = 'must-never-be-present';
        $this->assertRejected($additional, $original['quoteDigest'], self::ACCOUNT);
        $this->assertRejected($original, str_repeat('f', 64), self::ACCOUNT);
        $this->assertRejected($original, $original['quoteDigest'], self::OTHER);
    }

    public function test_idempotency_fingerprint_is_account_scoped_but_not_durable_deduplication(): void
    {
        $policy = $this->policy();
        $first = $this->quote();
        $differentInvoice = $policy->quote(
            self::ACCOUNT,
            '44444444-4444-4444-8444-444444444444',
            self::KEY, 'go', 6, $this->clock());
        $differentAccount = $policy->quote(
            self::OTHER, self::INVOICE, self::KEY, 'go', 6, $this->clock());
        $this->assertSame($first['idempotencyKeySha256'], $differentInvoice['idempotencyKeySha256']);
        $this->assertNotSame($first['quoteDigest'], $differentInvoice['quoteDigest']);
        $this->assertNotSame($first['idempotencyKeySha256'], $differentAccount['idempotencyKeySha256']);
        $this->assertArrayNotHasKey('verifiedSettlement', $first);
    }

    public function test_exact_expiration_boundary_and_safe_cancellation_only(): void
    {
        $quote = $this->quote();
        $digest = $quote['quoteDigest'];
        InvoiceLifecycle::assertStoredQuote(
            $quote, $digest, self::ACCOUNT, $this->clock()->addSeconds(899));
        $this->assertSame('cancelled', InvoiceLifecycle::safePreSettlementDecision(
            $quote, $digest, self::ACCOUNT, 'cancel', $this->clock()));
        $this->assertSame('expired', InvoiceLifecycle::safePreSettlementDecision(
            $quote, $digest, self::ACCOUNT, 'expire', $this->clock()->addSeconds(900)));
        try {
            InvoiceLifecycle::assertStoredQuote(
                $quote, $digest, self::ACCOUNT, $this->clock()->addSeconds(900));
            $this->fail('Expiry boundary should reject');
        } catch (RuntimeException $e) {
            $this->assertSame('checkout.quote_expired', $e->getMessage());
        }
    }

    public function test_no_pending_or_confirmed_transition_without_provider_proof(): void
    {
        $quote = $this->quote();
        foreach (['pending', 'confirmed', 'settlement_callback', 'refund', 'cancelled'] as $action) {
            try {
                InvoiceLifecycle::safePreSettlementDecision(
                    $quote, $quote['quoteDigest'], self::ACCOUNT, $action, $this->clock());
                $this->fail('Payment or impossible transition must not be accepted');
            } catch (RuntimeException $e) {
                $this->assertSame('checkout.settlement_not_verified', $e->getMessage());
            }
        }
        $this->assertSame('quoted', $quote['phase']);
    }
}
