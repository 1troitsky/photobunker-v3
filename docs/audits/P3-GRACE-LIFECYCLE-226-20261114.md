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

**No** new payment/DePay activation (#225), operator MFA (#227), physical deletion/grace GC (#203/#193), account suspension/frozen policy, full payments/renewal/history UI, S3 fault-injection, actual time-elapsed mobile tests or production credentials. No routes, migrations, config/plans.php, Photo/Media/StorageManager/Camera, or shared TS_PROGRESS_TABLE modifications. The only new frontend is an explicitly read-only grace status panel in the existing Settings screen; no paid mutation, price or quota constants are introduced. Full #226 remains **IN PROGRESS / PARTIAL**. In particular, this is a server read-only lifecycle slice, **not** completed renewal/downgrade/GC acceptance.

## Exact-head evidence · 2026-11-14 Asia/Tbilisi

**Verified code/workflow SHA:** `41eac5dc8902052be4dd01a770211f90ebcbf2d8`, directly descended from security #298 HEAD `60407676c7cb9bdb649f5017cf9450aff25eedab`. Before final evidence-only documentation edit, this was the exact PR/code HEAD; compare against the parent yields exactly 5 owned paths.

- [Own scoped CI 43523849742](https://github.com/1troitsky/photobunker-v3/actions/runs/43523849742): **4/4 jobs PASS**. PHP 8.4 and 8.5 each **252/252 PHPUnit, 3782 assertions**, Composer validate+audit locked PASS, patched PHP runtime floor PASS, production/test PHP syntax PASS. Independent **real disposable PostgreSQL 18: 7/7 GraceLifecycleTest, 121 assertions PASS** (PHPUnit explicitly uses PG env rather than forcing SQLite). Frontend TypeScript + Vite build + **449/449 Vitest (83 files) PASS**.
- [Security floor 43523850908](https://github.com/1troitsky/photobunker-v3/actions/runs/43523850908): **PASS** on the same exact SHA.
- [UX scope guard 43523850342](https://github.com/1troitsky/photobunker-v3/actions/runs/43523850342): **PASS** on the same exact SHA.
- Existing P0-02 Foundation/Storage workflows target PR bases main/p0/p1/p2/integration and did NOT run on this security-branch stack. Own narrow CI supplies PHP/frontend+PG coverage, but **Garage E2E / Chromium full suite / iOS Safari / Android PWA: NOT TESTED on this PR SHA**. Earlier #287 evidence is historical, not newly run.
- The last change to this audit is documentation-only and does not alter the verified product/CI code at SHA above. Any later CI must be reported at its own exact HEAD.
- Assistant's local PHP 8.4.24 is below mandatory 8.4.27; **not** treated as production acceptance.

**Result: PARTIAL / IN PROGRESS** for #226. This is a verified server read-only grace lifecycle projection, **not** approval of paid renewal, actual payment settlement, frozen/suspended account, physical deletion/grace GC, comprehensive Garage fault handling or native-device acceptance. No merge, deploy or destructive action.


## Stage 2 — authenticated Settings grace readout, 2026-11-14

**Own CLAIM addendum:** [#226 comment 6867185851](https://github.com/1troitsky/photobunker-v3/issues/226#issuecomment-6867185851). This is a further PARTIAL vertical slice of the same Issue/branch/Draft, not a new Issue, new PR or foreign-code change.

**New exclusive paths**:
- `apps/web/src/features/billing/application/grace-client.ts` + `grace-client.test.ts`
- `apps/web/src/features/billing/ui/GraceStatusPanel.vue` + `GraceStatusPanel.test.ts`
- NARROW modification `apps/web/src/views/AccountView.vue` (only import and render panel when a local identity session exists).
- Updates to this OWN QA report, and PR/Issue comments. All earlier own code/CI files remain unchanged.

**Runtime behavior:** The Account Settings screen now shows a small read-only **Тариф и сроки** panel. It requests only `GET /billing/v1/me` using the existing same-origin session cookies. It displays server plan, status (Free/active/grace/expired/pending), UTC deadline and last server timestamp only when the server has supplied a self-consistent `entitlement` and `lifecycle` pair. Client checks both authenticated server structures' schema, revision, hash marker, status, UTC dates, grace bounds, rights, effective Free fallback and exact deadline arithmetic. These checks are **defensive consistency, not a digital signature or a substitute for the Laravel session**. UI never sends a client-selected plan, account ID, price or expiry, and never caches/persists tariff status. Offline identity, network/auth error, logout, account/device change and late async HTTP responses must not display stale paid rights. Refresh is explicit. On grace and expiry, UI explains that new writes use current Free limits while previously signed assets obey their own immutable TTL plus ACL; the view cannot itself grant or erase media.

**New frontend tests:** real Vue component mounts plus client/parser tests cover server Free/active/grace/expired states, malformed dates, forged paid privileges, wrong revision/plan, inconsistent expired clocks, cross-account and device races, logout/offline, stale HTTP, transient error, refresh and local absence of payment deadlines. No synthetic local payment activation is treated as verified merchant settlement.

**Prior failing CI preserved, not suppressed:** earlier incremental code SHAs `c8bd7593`, `14db044f`, `fb4e4cdf`, `c102466a` exposed TypeScript Vitest tuple callback typing failure at `grace-client.test.ts:109`. The only correction was to accept the complete `it.each` row signature in its own new test, no test assertion removed or weakened. No backend errors were identified in those runs.

**Stage 2 verified code SHA:** `1fb4e4c65ace6670f2aa0cd0f75c639feb46c446`. [Scoped GHA 43525180055](https://github.com/1troitsky/photobunker-v3/actions/runs/43525180055) and [43525186674](https://github.com/1troitsky/photobunker-v3/actions/runs/43525186674): BOTH **4/4 jobs PASS** on that exact SHA. PHP 8.4 and 8.5 full PHPUnit **252/252 each, 3782 assertions each**, locked Composer Audit PASS; genuine PG18 **7/7**, 121 assertions; TypeScript/build and frontend **481/481 Vitest (85 files) PASS**. [P0 Security 43525186551](https://github.com/1troitsky/photobunker-v3/actions/runs/43525186551) PASS and [UX 43525186485](https://github.com/1troitsky/photobunker-v3/actions/runs/43525186485) PASS on the same code HEAD.

**NOT TESTED ON THIS BRANCH:** production payment finality, actual elapsed wall clock settlement/grace, full PostgreSQL/Garage/Chromium browser vertical, physical iOS/Android, account suspend/frozen enforcement, destructive GC or expiry-to-deletion. Vue mounted unit tests do **not** replace physical/mobile acceptance. Existing P0 Foundation and Storage workflows do not trigger for the security-base P3 PR, so the OWN scoped CI verifies PHP, PG18 and web; it does not prove real Garage/Chromium for this new readout. Original #226 remains **IN PROGRESS / PARTIAL**, do not mark full user lifecycle or paid checkout accepted.


### CI interpretation for first audit-only SHA and independent QA gap

**Audit-only HEAD** `9ddb9aa171e12dc57fc84a1ab16169a9a4faac8b` (no product code/test/workflow changes after `1fb4e4c65`):
- [Run 43525442010](https://github.com/1troitsky/photobunker-v3/actions/runs/43525442010) **3/4 jobs PASS, frontend FAIL (480/481 Vitest)**. TypeScript/build, PHP8.4/8.5 252/252 and PG18 7/7 PASS. The **sole** failure was existing, untouched `apps/web/src/features/identity/infrastructure/crypto.test.ts:46`: `openRecovery` unexpectedly succeeded when test replaced Base64URL ciphertext last two characters with `AA`. Since those bytes may already match or decode identically, the mutation is not guaranteed. This does **NOT** establish AEAD bypass; see new [independent QA Issue #311](https://github.com/1troitsky/photobunker-v3/issues/311), analogous to existing Folder Sync Issue #309.
- [Run 43525451177](https://github.com/1troitsky/photobunker-v3/actions/runs/43525451177) on **the same exact SHA**, without code/test change: **4/4 PASS** including all 481 Vitest. [Security 43525451306](https://github.com/1troitsky/photobunker-v3/actions/runs/43525451306) PASS; [UX 43525451229](https://github.com/1troitsky/photobunker-v3/actions/runs/43525451229) PASS.
- No foreign test or crypto primitive was modified or skipped to force green. #311 carries reproducible original FAIL and separate QA remediation criteria. Any future independent #311 test change requires separate CLAIM, not an implicit edit under #226.

**Overall #226 remains PARTIAL/IN PROGRESS**. Both stage-2 code SHA runs previously PASS; latest audit-only SHA has **one PASS and one intermittent unrelated Identity-test FAIL** and is reported as such, not flattened to all-green acceptance.
