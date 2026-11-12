# P1 Issue #192 — shared atomic Photo/Media quota admission (policy-safe slice)

**Date:** 2026-11-12. **Status:** Product Draft / exact-head CI not yet completed.  
**Base:** verified [PR #273](https://github.com/1troitsky/photobunker-v3/pull/273) @ `4007da211b7eaad01eec01c9e72370afa7b956db`, with prior #267 versioned server Billing snapshots, #272 65MiB encrypted resumable and #273 GC safely inherited. `main` remains unchanged.  
**Claim/ownership:** preflight + `backlog→ready→in-progress` recorded in [Issue #192](https://github.com/1troitsky/photobunker-v3/issues/192). Own only `apps/api/app/Billing/QuotaAdmission.php`, `apps/api/app/Photo/Reservation.php`, `apps/api/app/Http/Controllers/MediaV1Controller.php`, new `tests/Feature/Billing/QuotaAdmissionTest.php` and this audit. Other agent branches/CI/UX untouched.

## Verified requirements versus unresolved commercial contract

**Owner-approved and already represented in immutable server snapshots:** file limits for Free=50, Go=250, Pro=2000, Unlimited and Unlimited+=null **unlimited product *count* only**. `EntitlementLedger::current` verifies the immutable definition/chain and applies Free effective privileges in grace, expired and pending states. No public endpoint can change a plan or create trusted settlement.

**Still OPEN, deliberately NOT implemented:** the plan catalog says `storage_unit_policy=OPEN_GB_VS_GIB`, each `limits.storage.byteCeiling=null`. No approval establishes decimal GB/TB versus binary GiB/TiB. The existing production technical ciphertext guard is **exactly 1,000,000,000 bytes** under `photo_sync.bootstrap_free_byte_cap`. This slice **preserves that guard for every plan**, even paid verified accounts. It is not an approved Go=30GB/Pro=200GB/etc entitlement; it is a conservative engineering safeguard. The endpoint `/billing/v1/me` and immutable snapshots retain `byteCeiling=null`, unit OPEN, no invented numeric paid entitlement. Actual paid retention (30/90/unlimited) and assignment creation limits are separate Issue #203/#192 work. Do not claim full paid plan enforcement or production acceptance.

## Production change

One shared `App\\Billing\\QuotaAdmission::admit(accountId,cipherBytes)` is now called *inside each signed reservation transaction* before Photo/v1 or MediaFile/v1 inserts:

1. Lock `identity_accounts` row for the current verified actor (**single serialization point across devices, both protocols**). Do not trust requested planId, frontend usage, storage estimates or client timestamps. Fail closed for non-ready or invalid immutable entitlement snapshot.
2. Load `EntitlementLedger::current` effective limits and exact `maxMediaFiles` from committed versioned definition. Count pending+active **both Photo/v1 and MediaFile/v1** via `AccountUsage::measure` **under same lock**; exclude expired or deleting. One newly reserved logical file consumes exactly one slot; retry with identical signed operation/contract returns the existing reservation BEFORE new admission. Never charge a second count on finalize/ACK replay.
3. Sum already reserved ciphertext bytes across all live Photo assets and MediaFile rows and add the *signed* new ciphertext length. Use overflow-safe subtraction against **unchanged** technical 1e9 guard. Return 413 for full file/byte budget, 422 for impossible 0-byte service request. Never treat null paid storage byteCeiling as unlimited physical storage.
4. Active paid snapshot expands *file count* only according to verified limits. Grace/expiry/downgrade to Free applies Free 50-file cap to future admission **without deleting, tombstoning or changing existing bytes**. No new Stripe, DePay, admin or payment routes; no photo/media ACL or crypto changes.
5. No new database counter table or deferred background request. Reservation and checks happen in existing ACID transaction and account lock so pending chunk/partial uploads count atomically. Physical GC and expiry remain independently operator-controlled.

## New PHPUnit proof

`QuotaAdmissionTest.php` uses real Laravel DB schema and immutable ledger; tests: fresh Free bootstrap once; exact cross-protocol bytes and pending counts with no double write; Free count 50 boundary and existing 1e9 byte technical guard; Free/Go/Pro/Unlimited/Unlimited+ **snapshot counts** with no unlimited-byte inference; Go active 250 and grace Free50 without purging legacy files; deleting/expired exclusion and two-account isolation; corrupt head definition fail closed. Existing MediaV1Test, PhotoSyncV1Test, BillingV1Test and full security/E2E run unchanged.

**Acceptance required:** complete PHP8.4/8.5 tests, Vitest/TS/build, real PostgreSQL18+Garage full Chromium including E2EE 65MiB and physical Garage outage, Security and UX guards at exact final commit. This branch does NOT claim production-real concurrent two-device 50th/51st reservation race acceptance or paid storage byte capacity. Those must be separately demonstrated after approved GB/GiB mapping and complete paid retention #203.

## Open before closing Issue #192

1. Owner decision on **GB vs GiB**, and whether TB means 10^12 or TiB 2^40; version catalog and each stored snapshot policy (never retrofit old snapshots silently).
2. Exact behavior for paid storage already above lower downgraded cap, grace, paused subscriptions, and non-destructive grandfathered media.
3. Server enforced all-five byte ceilings, all-five TTL and monthly Assignment creation quotas with two-device race, E2EE retry, expiry and no hidden frontend authority.
4. Final combined CI + physical iOS/Android and production billing/rollout acceptance. Until then, **Issue open**, this PR only a safe reviewed sub-slice. No merge/deploy/main change.
