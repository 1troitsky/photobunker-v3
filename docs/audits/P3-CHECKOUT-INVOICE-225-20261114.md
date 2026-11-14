# PB3 #225 — Web3 Checkout isolated quote policy (2026-11-14)

Status: **PARTIAL / PRE-SETTLEMENT ONLY**. No payment provider, live blockchain settlement, invoice database, endpoint, subscription activation, or UI is implemented here. This file is a QA boundary, NOT full payment acceptance.

## Scope and source

- Base: main@6565a0fe852882ea5fc26e493df81affed687eee (PR #293 integrated).
- Requirement: ts.md §§8–9, 21.1–21.4, 25.15. All five plans, 1/6/12-month periods, immutable quote, replay/idempotency, server authorization and independent proof of actual settlement.
- Exclusive new module: apps/api/app/Billing/Checkout/InvoiceLifecycle.php. Exclusive new negative tests: apps/api/tests/Feature/Billing/CheckoutInvoiceLifecycleTest.php.
- No modifications of entitlement or quota ledger, existing Billing routes/controllers, composer.lock, Identity, session, Storage, S3, Matrix, web app, or other agents' claimed files.
- Cross-lane reads: #226 grace/downgrade Draft #310; #297 Laravel security Draft #298; active #220 PIN, #221 Panic, #231 Backup, #198 Notifications, #206 Camera, #232 S3, #230 PWA.

## Safety model of the implemented slice

1. Only server-side PlanCatalog calculates price in integer USD cents; quote contains copied plan ID/version and definition SHA-256, 1/6/12-month price, base price and discount. Free cannot be purchased.
2. Quote binds caller-verified account UUID, server-issued invoice UUID and an account-scoped SHA-256 of an idempotency key. This hash is a correlation key, **not an atomic uniqueness guarantee**; durable enforcement must be added in PostgreSQL.
3. Quote has explicit quoted / unverified state; validity is 15 minutes from authoritative server time, with exact UTC formatting.
4. Canonical SHA-256 quoteDigest is **not** a signature or payment attestation. Comparing with a separately trusted server-stored digest detects modification. Never trust both quote and digest received from a browser.
5. A pure verification guard rejects foreign account, mismatched stored digest, altered/extra keys, invalid amount, forged phase and proof markers, malformed expiry and expired quote. A pure decision guard permits only cancellation before expiry or expiration after the deadline. It explicitly rejects pending, confirmed and fake provider callbacks.
6. **No database write, network call, provider wiring, wallet secrets, ledger advance or paid rights.** Neither returned quote nor a hash can activate payment. No commercial payment UI should expose this as functional.

## Tests and evidence

- New test class exercises all 4 paid tariffs × 3 allowed periods against existing owner-approved catalog, snapshot binding, invalid Free/period/identity/idempotency, account-scoped fingerprints, changed amount/discount/currency/catalog/plan/phase/digest, injected wallet field, UTC boundary and blocked forged settlement.
- Exact-head tests/CI: **NOT TESTED at file creation**; subsequent GitHub run links and PASS/FAIL belong in PR conversation. Do not claim any suite passed before evidence.
- Local container reports PHP 8.4.24, **below required 8.4.27**. It is not a valid security-floor test environment. The remote workflow must enforce patched PHP.
- Existing main locked Composer audit is reported failing on #297 Laravel CVE; this branch does not bypass Composer Audit or change a foreign security branch. The default foundation workflow is expected to fail before PHPUnit until the patched lock from #297 is integrated. Security floor's independent syntax/config checks may still provide evidence.

## Blocked for real product acceptance

- **OPEN:** provider/network/tokens/fees/tax/refunds/proration/renewal options per ts.md §9.
- PostgreSQL immutable invoices with tenant-scoped unique idempotency, locked state transitions and verified historical price rows.
- Provider adapter and server-signed/verified callback or chain confirmation, transaction identity, address/token/amount/chain validation; partial/overpayment, late settlement, retries, duplicate/cross-account and chargeback policies.
- Only verified settlement may atomically advance EntitlementLedger and insert audited event.
- Billing API, guarded history cursor and frontend checkout; real provider sandbox and paid E2E cross-device acceptance.
- Because above is not implemented, Issue #225 remains **IN PROGRESS**, not review for full Web3 checkout; no release gate is accepted.

No merge or main changes are requested or performed.
