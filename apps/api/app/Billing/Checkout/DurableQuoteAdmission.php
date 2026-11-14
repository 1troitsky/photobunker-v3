<?php
declare(strict_types=1);

namespace App\Billing\Checkout;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Durable, isolated pre-settlement reservation and cancellation.
 *
 * This service is NOT exposed as an endpoint. Only a server-authenticated
 * identity boundary can provide trustedAccountId; no client account_id
 * controls access. A quote cannot be used as a paid settlement receipt.
 *
 * PostgreSQL: lock ready account row before lookup/insert/update, plus a
 * DB unique (account_id, idempotency key digest) as the final invariant.
 */
final class DurableQuoteAdmission
{
    public function __construct(private readonly InvoiceLifecycle $quotes) {}

    /** @return array<string, mixed> */
    public function reserve(
        string $trustedAccountId,
        string $idempotencyKey,
        string $planId,
        int $months,
        CarbonImmutable $serverNow,
    ): array {
        // Validate order before a DB lock, but only persist while verified
        // account row is ready. Server allocates the UUID (not the client).
        $candidate = $this->quotes->quote(
            $trustedAccountId, (string)Str::uuid(), $idempotencyKey,
            $planId, $months, $serverNow,
        );

        return DB::transaction(function () use (
            $trustedAccountId, $candidate, $serverNow
        ): array {
            self::lockReadyAccount($trustedAccountId);

            $existing = DB::table('checkout_quotes_v1')
                ->where('account_id', $trustedAccountId)
                ->where('idempotency_key_sha256', $candidate['idempotencyKeySha256'])
                ->first();

            if ($existing !== null) {
                $snapshot = self::decodeTrustedRow($existing, $trustedAccountId, $serverNow);
                // Same idempotency key cannot change the intended plan/period.
                if ($snapshot['planId'] !== $candidate['planId']
                    || $snapshot['months'] !== $candidate['months']) {
                    throw new RuntimeException('checkout.idempotency_conflict');
                }
                // Immutable quote replay even if expired or cancelled: do not
                // silently create a second invoice, charge, or paid entitlement.
                return $snapshot;
            }

            $timestamp = $serverNow->utc();
            DB::table('checkout_quotes_v1')->insert([
                'invoice_id' => $candidate['invoiceId'],
                'account_id' => $trustedAccountId,
                'idempotency_key_sha256' => $candidate['idempotencyKeySha256'],
                'requested_plan_id' => $candidate['planId'],
                'period_months' => $candidate['months'],
                'quote_digest' => $candidate['quoteDigest'],
                'quote_json' => json_encode($candidate, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                'state' => 'quoted',
                'issued_at' => CarbonImmutable::parse($candidate['issuedAt'], 'UTC'),
                'expires_at' => CarbonImmutable::parse($candidate['expiresAt'], 'UTC'),
                'closed_at' => null,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);

            return $candidate;
        }, 3);
    }

    /** @return array{state:string,quote:array<string,mixed>} */
    public function read(
        string $trustedAccountId,
        string $invoiceId,
        CarbonImmutable $serverNow,
    ): array {
        // This read does not change any database state.
        $account = DB::table('identity_accounts')
            ->where('id', $trustedAccountId)
            ->where('status', 'ready')->first();
        if ($account === null) {
            throw new RuntimeException('checkout.identity_unavailable');
        }
        $row = DB::table('checkout_quotes_v1')
            ->where('account_id', $trustedAccountId)
            ->where('invoice_id', $invoiceId)->first();
        if ($row === null) {
            throw new RuntimeException('checkout.invoice_unavailable');
        }
        return [
            'state' => self::trustedState($row),
            'quote' => self::decodeTrustedRow($row, $trustedAccountId, $serverNow),
        ];
    }

    /**
     * Only cancel or expire. No provider-verified payment or entitlement state
     * can be written by this class.
     */
    public function close(
        string $trustedAccountId,
        string $invoiceId,
        string $action,
        CarbonImmutable $serverNow,
    ): string {
        if (!in_array($action, ['cancel', 'expire'], true)) {
            throw new RuntimeException('checkout.settlement_not_verified');
        }

        return DB::transaction(function () use (
            $trustedAccountId, $invoiceId, $action, $serverNow
        ): string {
            self::lockReadyAccount($trustedAccountId);
            $row = DB::table('checkout_quotes_v1')
                ->where('account_id', $trustedAccountId)
                ->where('invoice_id', $invoiceId)
                ->lockForUpdate()->first();
            if ($row === null) {
                throw new RuntimeException('checkout.invoice_unavailable');
            }
            $state = self::trustedState($row);
            $snapshot = self::decodeTrustedRow($row, $trustedAccountId, $serverNow);

            if ($state !== 'quoted') {
                if (($state === 'cancelled' && $action === 'cancel')
                    || ($state === 'expired' && $action === 'expire')) {
                    return $state; // Idempotent terminal replay.
                }
                throw new RuntimeException('checkout.invoice_finalized');
            }

            $next = InvoiceLifecycle::safePreSettlementDecision(
                $snapshot, (string)$row->quote_digest, $trustedAccountId,
                $action, $serverNow,
            );

            $affected = DB::table('checkout_quotes_v1')
                ->where('account_id', $trustedAccountId)
                ->where('invoice_id', $invoiceId)
                ->where('state', 'quoted')
                ->update([
                    'state' => $next,
                    'closed_at' => $serverNow->utc(),
                    'updated_at' => $serverNow->utc(),
                ]);
            if ($affected !== 1) {
                throw new RuntimeException('checkout.concurrent_transition');
            }
            return $next;
        }, 3);
    }

    private static function lockReadyAccount(string $accountId): void
    {
        $account = DB::table('identity_accounts')
            ->where('id', $accountId)
            ->where('status', 'ready')
            ->lockForUpdate()->first();
        if ($account === null) {
            throw new RuntimeException('checkout.identity_unavailable');
        }
    }

    private static function trustedState(object $row): string
    {
        $state = (string)$row->state;
        if (!in_array($state, ['quoted', 'cancelled', 'expired'], true)) {
            throw new RuntimeException('checkout.invalid_state');
        }
        if (($state === 'quoted' && $row->closed_at !== null)
            || ($state !== 'quoted' && $row->closed_at === null)) {
            throw new RuntimeException('checkout.invalid_state');
        }
        return $state;
    }

    /** @return array<string, mixed> */
    private static function decodeTrustedRow(
        object $row,
        string $trustedAccountId,
        CarbonImmutable $serverNow,
    ): array {
        $state = self::trustedState($row);
        try {
            $quote = json_decode((string)$row->quote_json, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new RuntimeException('checkout.quote_tampered');
        }
        if (!is_array($quote)) {
            throw new RuntimeException('checkout.quote_tampered');
        }
        InvoiceLifecycle::assertStoredQuote(
            $quote, (string)$row->quote_digest, $trustedAccountId,
            $serverNow, false,
        );
        // Hash validity cannot replace cross-checking every independent DB
        // lookup/index key against the historical quote.
        if ($quote['invoiceId'] !== (string)$row->invoice_id
            || $quote['accountId'] !== (string)$row->account_id
            || $quote['idempotencyKeySha256'] !== (string)$row->idempotency_key_sha256
            || $quote['planId'] !== (string)$row->requested_plan_id
            || $quote['months'] !== (int)$row->period_months
            || !self::sameInstant($row->issued_at, $quote['issuedAt'])
            || !self::sameInstant($row->expires_at, $quote['expiresAt'])) {
            throw new RuntimeException('checkout.quote_row_mismatch');
        }
        // The terminal status is outside the immutable quote payload and
        // cannot be inferred from unsigned user-provided JSON.
        if ($state === 'quoted' && $serverNow->utc()->greaterThanOrEqualTo(
            CarbonImmutable::parse($quote['expiresAt'], 'UTC'))) {
            // Expiration is lazy and only an explicit authenticated close
            // updates durable state. Read/retry still returns the SAME quote.
        }
        return $quote;
    }

    private static function sameInstant(mixed $persisted, string $canonical): bool
    {
        try {
            return CarbonImmutable::parse((string)$persisted, 'UTC')->getTimestamp()
                === CarbonImmutable::parse($canonical, 'UTC')->getTimestamp();
        } catch (\Throwable) {
            return false;
        }
    }
}
