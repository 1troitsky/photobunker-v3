# PB3 P3 #226 — Grace/downgrade server lifecycle read model (2026-11-14)

**Owner/CLAIM:** CHAT-F · [Issue #226](https://github.com/1troitsky/photobunker-v3/issues/226#issuecomment-6866975224) · [shared START](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6866933745).

## Baselines and scope

- Verified unchanged remote `main`: `6565a0fe852882ea5fc26e493df81affed687eee`.
- Own branch: `feat/p3-226-grace-lifecycle-20261114`, from immutable security #297 Draft PR #298 code HEAD `60407676c7cb9bdb649f5017cf9450aff25eedab`. Draft PR **stacks on #298**, not an approval or a merge. This avoids ignoring the inherited Composer vulnerability on unpatched `main`.
- Already integrated on `main`: `EntitlementLedger` (immutable versioned trusted rights; Free fallback in grace/expired), `RetentionAdmission` (new signed TTL only), `QuotaAdmission` (current Free quotas after paid lapse). All remain unchanged here.
- Exact owned paths:
  - NEW `apps/api/app/Billing/GraceLifecycle.php`
  - NARROW update `apps/api/app/Http/Controllers/BillingV1Controller.php`
  - NEW `apps/api/tests/Feature/Billing/GraceLifecycleTest.php`
  - THIS QA audit file.

## Implemented contract (PARTIAL)

`GET /billing/v1/me`, with existing authenticated identity-account and live device guard, now returns `lifecycle` alongside existing `entitlement` and `usage`, using **one server UTC instant** for both. The new projector accepts only a verified internal entitlement result (not caller-provided plan, clock or deadline); validates revision, snapshot marker, plan, canonical timestamps, grace duration/expiry relationship, status, effective rights and paid privileges; inconsistent states fail closed.

`lifecycle` fields: `schemaVersion`, `asOfAt`, `revision`, `planId`, `status`, `effectivePlanId`, `paidPrivilegesActive`, `graceDays`, `planEndsAt`, `graceEndsAt`, `nextDeadlineAt`, `secondsUntilNextDeadline`, `graceActive`, `paidRightsDowngraded`, and explicit descriptive policies for new writes and existing signed assets.

Grace is **not a paid-rights extension**: only signed/verified active paid snapshots unlock paid capabilities; grace/expired uses current Free rights and server quota admission. No subscription-read operation rewrites existing immutable per-asset signed `expires_at`, and billing expiry alone does not authorize deletion. Existing file/assignment TTL, identity ACL/revocation and independent GC policy still apply. Free has **no invented payment grace**.

### Negative and actual-DB tests

New `GraceLifecycleTest` covers:
1. Genuine authenticated Free bootstrap: no paid grace or deadline, no plan forging.
2. Go/Pro/Unlimited/Unlimited+ exact 15/30/60/90-day paid grace and Free effective rights.
3. Exact active→grace and grace→expired boundaries using identical server timestamp.
4. Trusted test-fixture renewal in grace: new revision only, immutable previous snapshot.
5. Existing synthetic Photo row still at original expiry after read-only grace endpoint access.
6. Unauthorized and cross-account query cannot disclose another user's paid grace.
7. Inconsistent status/privilege/deadline/canonical timestamp/snapshot metadata rejected.

These tests exercise Laravel session, real DB tables and production code; **settlement proof is an explicit fixture** and does not validate external payment finality. Existing #287 real encrypted Garage downgrade tests are separate evidence, not rerun/rewritten in this PR.

## Safety boundaries / remaining acceptance

**No** new payment/DePay activation (#225), operator MFA (#227), physical deletion/grace GC (#203/#193), account suspension/frozen policy, billing UX, S3 fault-injection, actual time-elapsed mobile tests or production credentials. No routes, migrations, config/plans.php, Photo/Media/StorageManager/Camera, frontend, or shared TS_PROGRESS_TABLE modifications. Full #226 remains **IN PROGRESS / PARTIAL**. In particular, this is a server read-only lifecycle slice, **not** completed renewal/downgrade/GC acceptance.

## Exact-head evidence · 2026-11-14 Asia/Tbilisi

**Verified code/workflow SHA:** `41eac5dc8902052be4dd01a770211f90ebcbf2d8`, directly descended from security #298 HEAD `60407676c7cb9bdb649f5017cf9450aff25eedab`. Before final evidence-only documentation edit, this was the exact PR/code HEAD; compare against the parent yields exactly 5 owned paths.

- [Own scoped CI 43523849742](https://github.com/1troitsky/photobunker-v3/actions/runs/43523849742): **4/4 jobs PASS**. PHP 8.4 and 8.5 each **252/252 PHPUnit, 3782 assertions**, Composer validate+audit locked PASS, patched PHP runtime floor PASS, production/test PHP syntax PASS. Independent **real disposable PostgreSQL 18: 7/7 GraceLifecycleTest, 121 assertions PASS** (PHPUnit explicitly uses PG env rather than forcing SQLite). Frontend TypeScript + Vite build + **449/449 Vitest (83 files) PASS**.
- [Security floor 43523850908](https://github.com/1troitsky/photobunker-v3/actions/runs/43523850908): **PASS** on the same exact SHA.
- [UX scope guard 43523850342](https://github.com/1troitsky/photobunker-v3/actions/runs/43523850342): **PASS** on the same exact SHA.
- Existing P0-02 Foundation/Storage workflows target PR bases main/p0/p1/p2/integration and did NOT run on this security-branch stack. Own narrow CI supplies PHP/frontend+PG coverage, but **Garage E2E / Chromium full suite / iOS Safari / Android PWA: NOT TESTED on this PR SHA**. Earlier #287 evidence is historical, not newly run.
- The last change to this audit is documentation-only and does not alter the verified product/CI code at SHA above. Any later CI must be reported at its own exact HEAD.
- Assistant's local PHP 8.4.24 is below mandatory 8.4.27; **not** treated as production acceptance.

**Result: PARTIAL / IN PROGRESS** for #226. This is a verified server read-only grace lifecycle projection, **not** approval of paid renewal, actual payment settlement, frozen/suspended account, physical deletion/grace GC, comprehensive Garage fault handling or native-device acceptance. No merge, deploy or destructive action.
