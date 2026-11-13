# P1 #192 — versioned UTC monthly Assignment creation quotas & durable metering

**Date:** 2026-11-12. **State:** Product Draft / exact-head CI PENDING.  
**Base:** verified [Product #275](https://github.com/1troitsky/photobunker-v3/pull/275) @ `54442de1a72ee937abc2da74c84a3dd66ef14dd3`, **4/4 CI PASS**, real isolated PG18/Garage S3 stop/restart and Chromium 78/78; PHP8.4/8.5 234/234, Vitest418. Inherits approved decimal bytes/catalog and #273 GC. **No main merge.**
**Issue:** [#192](https://github.com/1troitsky/photobunker-v3/issues/192), scope/claim logged.

## Confirmed product flaw

`MonthlyCreationQuota::usage()` always used Free's static 3 assignments/month, independent of verified `EntitlementLedger::current`; thus paid Go/Pro/Unlimited rights did not function. The old count queried live `assignment_records_v1`. Physical deletion of an old assignment would refund its creation to the same-month quota despite ts.md §8.1 explicitly stating that **a created assignment consumes this month's quota even after deletion**. The API already correctly locks the same account row for concurrent signed creates and ACK-loss replay; that foundation is retained.

## Product implementation

1. New `assignment_creation_meter_v1` table with only opaque `assignment_id`, `owner_account_id`, `operation_id` and authoritative `created_at` UTC, primary+unique keys and owner/month index. **No FK to deletable `assignment_records_v1`**, so a retention tombstone/GC cannot reset usage. FK to account survives, no ciphertext/metadata, title, GPS, Recovery Key or private text. Append-only: migration `down()` refuses to erase billing evidence.
2. New forward-only migration backfills all **still-existing historical** assignments from canonical server `created_at` with a single SQL `INSERT SELECT` (no plaintext ingestion or altered assignment IDs). Important limitation: assignments already physically deleted **before** migration cannot be reconstructed from DB rows; log as historical unknown, not zero usage guarantee.
3. Under original `identity_accounts.lockForUpdate` transaction, `AssignmentV1Controller::create()` first returns idempotent unchanged ACK for an existing signed contract, otherwise rejects previously spent assignmentId/operationId in immutable meter **even after physical deletion** (410), checks effective monthly plan quota, and then inserts the signed assignment **and** meter atomically. A single server UTC `CarbonImmutable` instant governs both admission month and `created_at`, preventing month rollover race.
4. `MonthlyCreationQuota::usage()` obtains verified immutable entitlement snapshot: Free **3**, Go **30**, Pro **100**, Unlimited **null** (no product count cap), Unlimited+ **null**. New requests on grace/expired fall back to Free; no existing assignment deletion or timestamp extension. The signed startsAt never sets the billing period; account ID comes from session.
5. `AccountUsage::measure()` now uses the same append-only meter for authenticated billing read-only numbers; gone/archived assignments stay charged for their creation month. Operational request throttling is separate and remains active (429), not confused with tariff limits (403). No client planId, payment mutation or fabricated signed content.

## Test acceptance (no previous assertions weakened)

- Existing signed `AssignmentV1Test` Free3, quota exhaustion, repeated *identical* signed create ACK, unauthorized cross-account month query, real 429 operational throttling, server UTC period remain enabled. Their UTC backdate fixture now proves live assignment row mutation **cannot reset** the meter; only an explicitly older *meter test fixture* affects the historical period.
- New signed Go journey creates **4 assignments** after trusted settlement despite old Free cap3; confirms 30→26 remaining, physically deletes one assignment, confirms usage stays 4, original already-deleted signed operation rejects 410, grace reverts to Free3 with all meter rows retained.
- New `AssignmentCreationMeterTest` checks **five approved plan limits** and remaining semantics incl null unlimited, UTC month/account segregation, immutable historical backfill on fresh simulated upgrade, cleanup no quota refund, prohibited schema rollback, paid Pro→grace Free with 5 used and no destruction.
- `BillingV1Test` demonstrates authenticated billing read-only monthly creations are from meter and remain charged after a deleted assignment.
- Required full CI: PHP8.4/8.5 PHPUnit, all Vitest/TS/build, Security/UX, **real PostgreSQL18/Garage + all 78 Chromium E2E**, including AES-GCM 65MiB lost ACK, GPS, Matrix QA boundaries. No changed CI selectors/retries/skips.
 
## Honest residual risk / not claimed

- **Parallel two-connection PostgreSQL last-slot race** remains an independent live fault-matrix gate; account-row serialization follows existing code but mere unit tests are not a physical concurrency proof.
- This change does not activate external paid settlement/provider callbacks or grant paid entitlements via UI.
- Backfill cannot resurrect already physically destroyed historical rows; retention owner decides durable period for meter and retention strategy later. No automatic purge/rollback of meter.
- Plan-specific encrypted FILE TTL/grace/public share expiry is **Issue #203**, not bundled into monthly creation quota. Backup unique-byte ref accounting, BYO S3, Matrix, native iOS/Android NOT TESTED.
- Status after exact-head 4/4 PASS: #192 may move to **review** for combined file-count/bytes/monthly creation enforcement, but still open pending retention #203 and independent acceptance. PR Draft; do not merge into main.
