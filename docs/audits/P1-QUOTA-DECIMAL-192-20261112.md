# P1 #192 — decimal storage quotas, historical immutable snapshots, signed admission

**Issue:** [#192](https://github.com/1troitsky/photobunker-v3/issues/192).  
**Base:** [Product Draft #274](https://github.com/1troitsky/photobunker-v3/pull/274) exact verified `734487d022acbc43a8dc8f9d49c73d5b9e543178` (4/4 GH workflows PASS, 78/78 Chromium; PHP8.4/8.5 230/230; Vitest418). `main` untouched.  
**State:** Product Draft; final new-head CI PENDING.  
**Source decision:** Product owner approved **decimal GB=10^9 and TB=10^12 bytes** after #274. Decision captured in `docs/adr/2026-11-12-decimal-gb-tb-entitlements.md`; this later explicit owner decision supersedes the former OPEN_GB_VS_GIB note in `ts.md` **only for the storage unit interpretation**.

## What was implemented (production, not UI)

- Catalog bumped from `pb3-2026-11-09` to `pb3-2026-11-12`, approved `DECIMAL_GB_TB_V1`. Original five tariff prices/counts/features unchanged. PlanDefinition now derives and publishes **integer exact ciphertext byte ceilings** of 1e9, 30e9, 200e9, 500e9, 1e12; checked for positive amount, valid unit, overflow and version-policy mismatch.
- Append-only billing ledger verifies each old/new snapshot with **its originally committed policy**, recalculates canonical definition JSON and row hash, and keeps previous-hash history. No destructive migration, silent reinterpretation of an OPEN old snapshot, public paid activation route, or new trust in client tariff values.
- Shared server `QuotaAdmission` applies account-row locked Photo+MediaFile signed reserve against effective verified snapshot. `OPEN_GB_VS_GIB` historic accounts stay on previous conservative 1e9 guard until verified entitlement transition. New `DECIMAL_GB_TB_V1` Free uses min(1e9, existing stricter Free technical guard); new active paid plans use their approved **30e9/200e9/500e9/1e12** ceiling (not old 1e9 bootstrap). No `null` unlimited byte fallthrough. Overflow-safe `used > ceiling - newCipherBytes`, pending+active included; identical signed lost ACK returns pre-existing reservation without second charge.
- Public Billing plan definition and authenticated `/billing/v1/me` show exact `byteCeiling`, `unitPolicy`, quota source and read-only server measurement. No extra frontend authority, payment integration, physical deletion or TTL change.

## Required exact-head proofs

1. PHPUnit PHP 8.4 & 8.5: updated existing immutable plan catalog contract tests for **legitimately changed** version/units, no disabled original assertions; five decimal byte limits, Free operator stricter override, 30GB exact boundary with combined Photo+Media, all-five file counts, grace/downgrade keeps existing bytes, cross-account usage separation.
2. Newly added historic snapshot lifecycle: construct old `pb3-2026-11-09` Free + trusted paid old OPEN while config still old, upgrade published catalogue to decimal (without touching DB hashes), verify old snapshot and 1e9 guard remain, then separately trusted revision obtains new 200GB limit. Tamper/mismatch/overflow fail closed. Billing API rejects frontend fake paid plan and forged query quota.
3. Entire strict PHP/TypeScript/Vitest/build, Security/UX guard, real isolated PG18/Garage physical outage/restart, AES-GCM browser E2E and signed assignment acceptance on **exact new head**. Full 4/4 PASS required for PR-level ready-to-review.

## Unresolved acceptance and non-goals

**NOT YET delivered / Issue #192 stays open:** Monthly assignment creation quota enforcement, P1/P2 per-plan retention/TTL (#203), real simultaneous 50th/51st reserve on separate PostgreSQL connections, comprehensive paid reauthorization across all paths including backup refs and external S3; physical mobile devices; verified settlement webhooks/production operator transition. No automatic deletion on downgrade/grace. Status cannot be upgraded to full release because byte-enforcement tests alone pass.

**No merge**, no modifications to `main`, parent #274, Matrix, UX, and other active PRs. Report exact final SHA and workflow IDs after CI.
