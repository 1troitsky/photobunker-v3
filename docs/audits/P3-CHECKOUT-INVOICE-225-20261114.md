# PB3 #225 — isolated durable Web3 Checkout QUOTED state (2026-11-14)

Status: **PARTIAL / IN PROGRESS — NO LIVE PAYMENT OR PROVIDER SETTLEMENT**. This is an internal protected server/DB primitive, not a public checkout route, working wallet, accepted customer payment or paid subscription.

## Sources and exact scope

- Normative: `ts.md` §§8–9, 21.1, 21.4, 25.15; `AGENTS.md`; main SHA `6565a0fe852882ea5fc26e493df81affed687eee`.
- Own branch: `feat/p3-225-invoice-state-20261114`, Draft PR #316. Last tested **product + workflow HEAD** `1ef0224bf30063054cb3b9af666ea5a5184a2a00` (this report update is documentation-only).
- Exclusive 7 changed paths:
  - `apps/api/app/Billing/Checkout/InvoiceLifecycle.php`
  - `apps/api/app/Billing/Checkout/DurableQuoteAdmission.php`
  - `apps/api/database/migrations/2026_11_14_000225_create_checkout_quotes_v1.php`
  - `apps/api/tests/Feature/Billing/CheckoutInvoiceLifecycleTest.php`
  - `apps/api/tests/Feature/Billing/DurableQuoteAdmissionTest.php`
  - `.github/workflows/p3-checkout-225.yml`
  - `docs/audits/P3-CHECKOUT-INVOICE-225-20261114.md`
- Other agents: #297 PR #298 Composer-only (READ-ONLY parent), #226 PR #310 Grace, #220 PIN, #221 Panic, #231 Backup, #229 Telemetry, #198 Notifications, #206 Camera, #230 Signed PWA and #232 BYO storage untouched. No shared Billing controller/route/entitlement changes and no merge/main/deploy.

## Actual behavior

1. `InvoiceLifecycle` receives account identity from **trusted server caller only**. A new server-issued UUID and selected plan/1-6-12 month period produce a 15-minute canonical UTC quote with immutable published plan catalog version and definition SHA-256, integral USD cents and discount. Free cannot be invoiced.
2. Scope and key: `idempotencyKeySha256` binds a nonsecret request token to the trusted account. Raw key never enters the quote JSON. In `checkout_quotes_v1`, unique(account_id, key hash) and an actual account `SELECT ... FOR UPDATE` serialize same-account PostgreSQL requests. **Simultaneous separate PHP OS-process contention has NOT yet been independently fault-tested.**
3. Internal `DurableQuoteAdmission::reserve` rejects unready/absent accounts. Same account + same idempotency key + same plan/period gives the original persisted quote, even after expiry; plan/period change on same key is a conflict. Two accounts using same request token have different stored invoices and cannot fetch/close each other's records.
4. Quote is permanently in the `quoted / unverified` pre-settlement phase; durable status is `quoted → cancelled | expired` only. Cancellation/expiry is locked and idempotent. Any `pending`, `confirmed`, `paid`, fake callback or refund action is rejected. The quote never invokes `EntitlementLedger::advanceTrusted`.
5. On read/close/replay the service verifies the stored quote digest, exact JSON fields, account, invoice UUID, key digest, plan/period and immutable expiry against separate DB columns. The SHA-256 digest is **not an HMAC, independent external audit anchor or payment receipt**. A privileged database attacker who rewrites both hash and data could evade these consistency checks; future settlement MUST use separately verified provider transaction evidence, append-only audit and production DB permissions.
6. No live API/controller, client-visible checkout state, payment provider credentials, order submission, payment callback, blockchain verification or subscription activation has been introduced.

## Reproducible security-first validation

- Because unmerged `main` still pins vulnerable Laravel v13.39.0 (#297, CVE-2026-128083), the ordinary Foundation jobs FAIL at strict Composer Audit **before PHPUnit**; that failure is retained and never suppressed. The branch never changes `apps/api/composer.lock`.
- Dedicated `p3-checkout-225.yml` makes a *read-only* separate checkout of vetted #297 PR #298 exact commit `60407676c7cb9bdb649f5017cf9450aff25eedab`, copies ONLY its patched Laravel v13.42.0 lock into a **disposable CI working tree**, enforces PHP runtime floor, strict Composer validate and `composer audit --locked` (0 advisories). Neither that lock nor PR #298 is modified/merged. The product code is still checked out at the own SHA.
- [Independent scoped workflow 43540911217](https://github.com/1troitsky/photobunker-v3/actions/runs/43540911217) on exact product SHA `1ef0224bf30063054cb3b9af666ea5a5184a2a00`: **3/3 jobs PASS**. Patched PHP8.4.27 PHPUnit **263/263** (3839 assertions); patched PHP8.5 PHPUnit **263/263** (3839 assertions); PostgreSQL18  **18/18 Checkout tests** (178 assertions), real schema migrated. No real wallet or provider involved.
- Crucial PG test correction: repository `phpunit.xml` otherwise forces SQLite. This scoped workflow makes a disposable `phpunit.postgres.checkout.xml` forcing `pgsql` and `pb3_checkout_225`, without editing committed shared config. Job logs show PostgreSQL18 and the checkout migration, PHP8.4.27, 18 tests PASS; previous job before this correction was NOT counted as a PG PHPUnit acceptance.
- Other exact SHA workflows: [Security 43540911088](https://github.com/1troitsky/photobunker-v3/actions/runs/43540911088) PASS; [UX guard 43540911081](https://github.com/1troitsky/photobunker-v3/actions/runs/43540911081) PASS; [Foundation 43540911102](https://github.com/1troitsky/photobunker-v3/actions/runs/43540911102) PHP **FAIL inherited #297**; [PG/Garage/Chromium 43540911187](https://github.com/1troitsky/photobunker-v3/actions/runs/43540911187) **IN PROGRESS** at last check, not claimed PASS.
- Physical iOS/Android, production provider settlement, independent two-process invoice race, real webhook replay and real price-paid activation: **NOT TESTED**.

## Blocking gates before real Checkout release

1. Owner must settle the OPEN provider, network and tokens, provider address and callback verification, tax/refunds/fees/renewal/proration policy in `ts.md` §9.
2. Real tenant-authenticated `billing/v1` invoice API + CSRF/origin/session/signed intent, bounded cursor history; evidence-backed provider adapter. No server APIs for paid status until this is secure.
3. Durable provider invoice/settlement chain + token + address + amount + confirmation + replay verification, partial/overpay/late/cancel/reorg/refund safety, real independent provider attestation and incident handling.
4. Atomic append-only verified event and revisioned entitlement advance only after actual verified settlement. No synthetic paid grants.
5. Real two-process PostgreSQL conflict/lock observation and E2E callback, offline, repeat, delayed settlement and mobile checkout on a combined accepted candidate.
6. Integrate audited #297 security patch through a separately authorized merge before declaring release.

Issue #225 remains **IN PROGRESS**. This deliverable is a genuinely persisted but **unwired and unpaid** internal layer. No merge/deploy/main modification performed.
