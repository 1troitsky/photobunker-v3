# P3 #224 — Versioned server PlanDefinition and entitlement ledger

**Source:** owner priority ts.md §8, §22.1, §25.14. **Parent:** Product+UX Draft #187 exact 7a309508cc140897ae6dd75f8d473a89c7296be2, not main.

## Implemented

- Preserve ALL existing plans.php tariff values: Free 0, Go $15, Pro $30, Unlimited $50, Unlimited+ $100 monthly; current 6/12-month pricing, 3/30/100/unlimited monthly assignments, 50/250/2000/unlimited live media, 1/30/200/500 GB or 1 TB, 14/30/90/unlimited retention and 15/30/60/90 grace days. Only catalog effective_at metadata is new (2026-11-09T00:00:00Z), matching existing version pb3-2026-11-09.
- Immutable value PlanDefinition: schema/version/effective-at/currency, USD prices in cents, period prices, count/storage/backup limits, storage {amount,unit,byteCeiling:null,unitPolicy:OPEN_GB_VS_GIB}, entitlement features. Every plan offers Matrix E2EE; only Unlimited+ may carry byoS3 or ownMatrixHomeserver.
- GET /billing/v1/plans: public read-only canonical definitions with definitionSha256; no personal details.
- GET /billing/v1/me: only authenticated ready PB3 account+live device. First access creates Free bootstrap, under Identity-account database row lock. Read returns immutable revisioned definition, server UTC active/grace/expired and effective flags (paid-only features disabled immediately on paid expiry) plus account-scoped read-only observed usage.
- Append-only billing_entitlement_snapshots_v1 and billing_entitlement_heads_v1; revision CAS, previous hash chain and event hash idempotency. A change never overwrites a historical definition, even if next config release changes prices.
- Internal-only EntitlementLedger::advanceTrusted() requires an event SHA-256 identifier and source class for previously externally VERIFIED settlement or MFA-audited operator grant. This primitive DOES NOT verify provider/admin evidence, and is deliberately NOT exposed via any public billing mutation route.

## Critical boundaries

1. Billing currently provides a read-only definitions and entitlement truth table, NOT complete paid quota enforcement. Existing Free-mode MediaFile/Photo/Assignment checks remain untouched. Actual server admission and atomic reservation: #192/#200/#203. A future paid snapshot is not a current bypass of the Free write caps.
2. AccountUsage measurements are read-only and non-atomic: UTC month assignment count, live logical Photo+MediaFile count and recorded ciphertext bytes. Not a durable physical S3/BYO deduplicated accounting receipt and NOT an atomic quota reservation.
3. GB-vs-GiB and BYO byte attribution remain OPEN under ts.md. Publish exact {amount,unit}, byteCeiling:null, not fabricated byte limits.
4. Grace and expiry preserve the old immutable snapshot while the read-only effective privileges fall back to Free. This does NOT delete ciphertext or determine the complete grace/downgrade read/retention semantics (#203/#226).
5. NO payment, DePay invoice, blockchain settlement, admin MFA action or user POST to activate a plan. #225/#227/#228 must supply verified real trusted evidence before a paid transition can be legitimately invoked.
6. Snapshot hashes provide consistency/lineage checks; they are NOT independently signed receipts against a database administrator rewriting all rows.
7. No Vue prices or mock counters were added.

## Verification plan

11 PHP Feature cases: all owner prices/privileges, public/owner-only API, unauthorized/forged calls, Free bootstrap once, cross-tenant and revoked-device isolation, UTC grace/expiry, revision CAS and exact Lost-ACK replay, immutable downgrade and historical price, actual account-scoped counters, unsafe sources/periods denied, corrupt snapshot fail-closed and irreversible history rollback.

**Still NOT TESTED / separate gates:** real DePay settlement, MFA-approved admin grant, concurrent paid reservation and quota admission, exact physical S3 unit policy, native devices, complete P1–P4 integration. No merge/deploy; exact-head CI required.
