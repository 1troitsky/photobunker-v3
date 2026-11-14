<?php
declare(strict_types=1);

namespace App\Billing\Checkout;

use App\Plans\PlanCatalog;
use Carbon\CarbonImmutable;
use RuntimeException;

/**
 * #225: server-priced immutable PRE-SETTLEMENT quote policy.
 *
 * This class does NOT receive payment credentials or verify blockchain
 * settlement. Its SHA-256 digest detects changes only when compared with
 * a digest held separately in trusted server storage; it is NOT a MAC,
 * provider receipt, signature, transaction lock or proof of payment.
 *
 * No route, DB write, entitlement advance or "confirmed" transition exists.
 */
final class InvoiceLifecycle
{
    private const DOMAIN = 'pb3.billing.checkout.quote.v1';
    private const TTL_SECONDS = 900;

    public function __construct(private readonly PlanCatalog $plans) {}

    /** @return array<string, mixed> */
    public function quote(
        string $trustedAccountId,
        string $serverInvoiceId,
        string $idempotencyKey,
        string $planId,
        int $months,
        CarbonImmutable $serverNow,
    ): array {
        self::uuid($trustedAccountId);
        self::uuid($serverInvoiceId);
        if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/D', $idempotencyKey)) {
            throw new RuntimeException('checkout.invalid_idempotency_key');
        }
        if (!in_array($months, [1, 6, 12], true) || $planId === 'free') {
            throw new RuntimeException('checkout.invalid_order');
        }

        // The amount is NEVER taken from the request, provider redirect,
        // user-supplied invoice JSON or an old frontend tariff table.
        $plan = $this->plans->get($planId);
        $monthly = $plan->value['monthlyPriceCents'];
        $periods = $plan->value['periodPricesCents'];
        $amount = $periods[$months] ?? null;
        if (!is_int($monthly) || $monthly <= 0
            || !is_int($amount) || $amount <= 0
            || $monthly > intdiv(PHP_INT_MAX, $months)
            || $amount > $monthly * $months) {
            throw new RuntimeException('checkout.invalid_catalog_price');
        }

        $now = $serverNow->utc()->startOfSecond();
        $base = $monthly * $months;
        $payload = [
            'schemaVersion' => 1,
            'domain' => self::DOMAIN,
            'phase' => 'quoted',
            'proofState' => 'unverified',
            'invoiceId' => $serverInvoiceId,
            'accountId' => $trustedAccountId,
            'idempotencyKeySha256' => hash('sha256',
                "pb3.billing.checkout.idempotency.v1\n".$trustedAccountId."\n".$idempotencyKey),
            'planId' => $plan->id,
            'catalogVersion' => $plan->version,
            'definitionSha256' => $plan->sha256,
            'months' => $months,
            'currency' => 'USD',
            'basePriceCents' => $base,
            'discountCents' => $base - $amount,
            'amountCents' => $amount,
            'issuedAt' => self::utc($now),
            'expiresAt' => self::utc($now->addSeconds(self::TTL_SECONDS)),
        ];

        return [...$payload, 'quoteDigest' => self::digest($payload)];
    }

    /**
     * Only call with a separately trusted stored digest and authenticated
     * account identity. Never accept both quote and digest from the client.
     *
     * @param array<string, mixed> $quote
     */
    public static function assertStoredQuote(
        array $quote,
        string $storedDigest,
        string $trustedAccountId,
        CarbonImmutable $serverNow,
        bool $requireNotExpired = true,
    ): void {
        self::uuid($trustedAccountId);
        $fields = [
            'schemaVersion', 'domain', 'phase', 'proofState', 'invoiceId',
            'accountId', 'idempotencyKeySha256', 'planId', 'catalogVersion',
            'definitionSha256', 'months', 'currency', 'basePriceCents',
            'discountCents', 'amountCents', 'issuedAt', 'expiresAt', 'quoteDigest',
        ];
        if (array_keys($quote) !== $fields
            || ($quote['schemaVersion'] ?? null) !== 1
            || ($quote['domain'] ?? null) !== self::DOMAIN
            || ($quote['phase'] ?? null) !== 'quoted'
            || ($quote['proofState'] ?? null) !== 'unverified'
            || ($quote['accountId'] ?? null) !== $trustedAccountId
            || !is_string($quote['invoiceId'] ?? null)
            || !is_string($quote['planId'] ?? null)
            || !in_array($quote['months'] ?? null, [1, 6, 12], true)
            || ($quote['currency'] ?? null) !== 'USD'
            || !is_string($quote['catalogVersion'] ?? null)
            || !preg_match('/^pb3-\d{4}-\d{2}-\d{2}$/D', $quote['catalogVersion'])
            || !self::sha256($quote['definitionSha256'] ?? null)
            || !self::sha256($quote['idempotencyKeySha256'] ?? null)
            || !is_int($quote['basePriceCents'] ?? null)
            || !is_int($quote['discountCents'] ?? null)
            || !is_int($quote['amountCents'] ?? null)
            || $quote['amountCents'] <= 0
            || $quote['discountCents'] < 0
            || $quote['basePriceCents'] < $quote['amountCents']
            || $quote['basePriceCents'] - $quote['discountCents'] !== $quote['amountCents']
            || !self::sha256($storedDigest)
            || !self::sha256($quote['quoteDigest'] ?? null)) {
            throw new RuntimeException('checkout.quote_untrusted');
        }
        self::uuid($quote['invoiceId']);
        $payload = $quote;
        unset($payload['quoteDigest']);
        if (!hash_equals($storedDigest, $quote['quoteDigest'])
            || !hash_equals($storedDigest, self::digest($payload))) {
            throw new RuntimeException('checkout.quote_tampered');
        }

        $issued = self::parseUtc($quote['issuedAt'] ?? null);
        $expires = self::parseUtc($quote['expiresAt'] ?? null);
        if ($expires->getTimestamp() - $issued->getTimestamp() !== self::TTL_SECONDS) {
            throw new RuntimeException('checkout.quote_invalid_expiry');
        }
        if ($requireNotExpired && $serverNow->utc()->greaterThanOrEqualTo($expires)) {
            throw new RuntimeException('checkout.quote_expired');
        }
    }

    /**
     * No provider authority exists yet, so only safe terminal decisions are
     * expressible. "pending" and "confirmed" MUST be introduced behind real
     * provider admission, durable idempotency and settlement proof.
     *
     * @param array<string, mixed> $storedQuote
     */
    public static function safePreSettlementDecision(
        array $storedQuote,
        string $storedDigest,
        string $trustedAccountId,
        string $action,
        CarbonImmutable $serverNow,
    ): string {
        self::assertStoredQuote($storedQuote, $storedDigest,
            $trustedAccountId, $serverNow, false);
        $expires = self::parseUtc($storedQuote['expiresAt']);
        if ($action === 'expire' && $serverNow->utc()->greaterThanOrEqualTo($expires)) {
            return 'expired';
        }
        if ($action === 'cancel' && $serverNow->utc()->lessThan($expires)) {
            return 'cancelled';
        }
        throw new RuntimeException('checkout.settlement_not_verified');
    }

    private static function uuid(string $value): void
    {
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D', $value)) {
            throw new RuntimeException('checkout.invalid_identity');
        }
    }

    private static function sha256(mixed $value): bool
    {
        return is_string($value) && preg_match('/^[0-9a-f]{64}$/D', $value) === 1;
    }

    private static function parseUtc(mixed $value): CarbonImmutable
    {
        if (!is_string($value)
            || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/D', $value)) {
            throw new RuntimeException('checkout.quote_invalid_time');
        }
        try {
            $parsed = CarbonImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', $value, 'UTC');
        } catch (\Throwable) {
            throw new RuntimeException('checkout.quote_invalid_time');
        }
        if (!$parsed || self::utc($parsed) !== $value) {
            throw new RuntimeException('checkout.quote_invalid_time');
        }
        return $parsed;
    }

    private static function utc(CarbonImmutable $date): string
    {
        return $date->utc()->format('Y-m-d\TH:i:s\Z');
    }

    /** @param array<string, mixed> $payload */
    private static function digest(array $payload): string
    {
        return hash('sha256', json_encode($payload,
            JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }
}
