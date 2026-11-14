# P3 #229 — privacy-safe telemetry durable ingestion: isolated acceptance (2026-11-14)

## Ownership and ancestry
- Agent: CHAT-I, live journal [START](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6869246542), exclusive [CLAIM](https://github.com/1troitsky/photobunker-v3/issues/229#issuecomment-6869270202).
- Own [Draft PR #317](https://github.com/1troitsky/photobunker-v3/pull/317), branch `feat/p3-229-telemetry-db-20261114`.
- Base is READ-ONLY #297 security patch [Draft #298](https://github.com/1troitsky/photobunker-v3/pull/298) SHA `60407676c7cb9bdb649f5017cf9450aff25eedab`, parent main `6565a0fe852882ea5fc26e493df81affed687eee`. This avoids inherited unpatched Composer CVE; **do not merge #298 or this PR automatically**.
- Product source commit `e6d076b60965725c60f21e432ee1448f665a19b8`; corrected CI-only HEAD before this doc: `cf70cec516ac0f65893b02b7d0123b33f017ce5d`.
- Exactly five new owned implementation/test/CI paths before this doc, no shared routes/auth/Admin/Telemetry contract changed.

## Implemented and VERIFIED narrow slice
- Internal `DatabaseTelemetrySink` implements existing `TelemetrySink` #195 contract (already present in main) for **trusted server-only** `TelemetryRecord`, with an atomic receipt + day/week/month counter + distinct-actor write.
- Per-account HMAC event receipt, SHA-256 fingerprint and per-period HMAC actor tokens; storage omits raw account ID, event ID, event timestamp, file/folder, GPS, IP, message content, key material and arbitrary metadata. Tokens are **pseudonymous, not anonymous**; HMAC secret protection and rotation remain open.
- Duplicate identical event receipt is not counted twice; same-token changed event becomes Conflict. Separate writer processes must not race lost updates. SQL failures throw rather than report success.
- Calendar periods are UTC day, ISO week-year, month. Manual `prune` removes receipt rows only after 8-day retry safety and actor tokens only after full period + 8 days. Caller-supplied clock >5min ahead of wall clock fails closed. Aggregate counters are intentionally retained until owner approves retention policy.
- New migration creates only `telemetry_event_receipts`, `telemetry_counters`, `telemetry_active_tokens`, with composite unique keys. No HTTP ingestion, background job, API metrics endpoint, dashboard or automatic data collection enabled.

## Evidence exact SHA and known failure
- Initial source `57d6dc778c188c5017ffd6c3a23871051e4e4ef8`: real PG18, two independent PHP CLI processes racing same HMAC token: **PASS**, [run 43540432910](https://github.com/1troitsky/photobunker-v3/actions/runs/43540432910). Security and UX PASS.
- `c5bcb7bfb503927db8d0ab3e5a29bf051e8e9015`: new isolated SQLite PHPUnit 3 tests/37 assertions PASS, real PG18 race PASS, security/UX PASS [run 43540533194](https://github.com/1troitsky/photobunker-v3/actions/runs/43540533194).
- Product `e6d076b60965725c60f21e432ee1448f665a19b8`: full-suite workflow **FAIL** in PHP8.4 and PHP8.5 because new CI job injected HTTP/PG environment into the existing app test bootstrap; 156 unrelated 403 responses, while targeted telemetry 3/37 PASS. [run 43540689144](https://github.com/1troitsky/photobunker-v3/actions/runs/43540689144). No foreign tests modified, failure preserved rather than masked.
- Corrected CI workflow-only HEAD `cf70cec516ac0f65893b02b7d0123b33f017ce5d`: [P3 PostgreSQL run 43540812952](https://github.com/1troitsky/photobunker-v3/actions/runs/43540812952) **PASS, 2/2 jobs**:
  - PHP **8.4.27**: targeted TelemetryDatabaseSinkTest **3/3, 37 assertions PASS**; full suite **248/248, 3698 assertions PASS**; true independent two-process PostgreSQL 18 receipt collision/dedup/atomic day-week-month counters **PASS**; Composer Audit **0 advisories**.
  - PHP **8.5.12**: same **3/3 targeted**, **248/248 full**, **3698 assertions**, real PG18 two-process race **PASS**, Composer Audit **0 advisories**.
  - [Security floor run 43540812993](https://github.com/1troitsky/photobunker-v3/actions/runs/43540812993) **PASS** and [UX scope run 43540813050](https://github.com/1troitsky/photobunker-v3/actions/runs/43540813050) **PASS**. Thus **3/3 workflows / 4/4 jobs PASS** for tested code + workflow exact HEAD, before this QA-document-only commit.
- Logged exceptions in full-suite negative Billing tests are intentional test vectors; total PHPUnit process exits PASS.

## Limitations / release gates
**NOT IMPLEMENTED / NOT TESTED:** production service hooks and consent/sampling, durable domain outbox delivery, real admin MFA/RBAC #227, safe export/API and dashboard from real source events, business source reconciliation, automatic retention scheduler, counter TTL / policy, HMAC key rotation, full metrics taxonomy, high-cardinality/outlier bounds, load beyond 2 workers, S3 outage relevance, real phones/iOS/Android, E2EE end-to-end analytics validation. The isolated safe kernel alone **does not complete Issue #229** or P3 and must not be presented as a working dashboard.

## Next safe step
Keep #229 `in-progress`, PR Draft, CLAIM active. On owner continuation: reread #302 and competing PR/claims and then either isolate server-authenticated event-source ingestion with source-level tests (without public HTTP/forged events), or take an independent free Issue if #227/admin dependencies prevent safe progress. **Never merge/deploy/modify main without owner permission.**


---

## 2026-11-14 additional #229 acceptance — verified assignment creation ledger → real durable telemetry

**Source/product SHA** `8d87f3010076821c7b1362dc51c2d9514fa599f9` (initial new source SHA `b6aec0d661d45d9304aeab4a070fdd8a04cc7788`).
**Ownership:** SAME CHAT-I / Issue #229 exclusive CLAIM with [addendum #6869457397](https://github.com/1troitsky/photobunker-v3/issues/229#issuecomment-6869457397), same branch/Draft [#317](https://github.com/1troitsky/photobunker-v3/pull/317) stacked on READ-ONLY security #298. The previous six owned paths remain; this step adds **exactly two new** source/test paths and updates **two own** existing integration/CI paths, plus this own QA document. No `web.php`, `AssignmentV1Controller`, `TelemetryCollector`, Events, Notification #198 or shared config/progress modified.

### Real source and privacy boundary
- New `apps/api/app/Telemetry/AssignmentCreationReplay.php` reads existing `assignment_creation_meter_v1` — a server-created, append-only account-locked quota ledger committed in the **same authenticated signed create transaction** as assignments, retained across assignment deletion. This is an actual authoritative source table, not sample JSON or UI metrics.
- Explicit opt-in **internal** `replayPage(serverNowMs, limit=1..200, after=private keyset)`: source account ID, server created-at, operationId and assignmentId are used transiently to construct only allowlisted `assignment.created` events, which existing `TelemetryCollector` HMACs before writing via the durable DB sink. No raw IDs or timestamps are persisted in telemetry.
- Bounded UTC 7-day replay window, 5-minute future tolerance, order-stable keyset pagination, same-event dedupe across restarts and simultaneous workers; malformed cursor and unexpected Collector rejection/conflict fail closed. Cursor includes sensitive source identifiers and **must remain backend-internal, never logged/exposed/exported**.
- Exact timestamp changes within the SAME UTC day produce `Duplicate` by deliberate coarse calendar fingerprint minimization; a cross-day alteration changes the fingerprint and produces a `Conflict`. This is not a tamper-evident ledger: full source-integrity verification remains out of scope.
- No background registration, automatic scheduler, web endpoint, telemetry collector middleware, production admin dashboard, consumption opt-in or production analytics activated.

### Exact-code CI evidence (both supported runtimes)
[Final source HEAD isolated PostgreSQL job 43541780044](https://github.com/1troitsky/photobunker-v3/actions/runs/43541780044) — **2/2 PHP jobs PASS**:
- PHP **8.4.27**: full PHPUnit **252/252 PASS, 3731 assertions**; isolated earlier DatabaseSink 3/3/37 PASS; Composer locked Audit **0 advisories**; migrations PASS.
- PHP **8.5.12**: full PHPUnit **252/252 PASS, 3731 assertions**; isolated earlier DatabaseSink 3/3/37 PASS; Composer locked Audit **0 advisories**; migrations PASS.
- Each ran BOTH true two-independent-PHP-process races over PostgreSQL 18: existing HMAC receipt insertion and NEW source-reconciliation on the actual `assignment_creation_meter_v1` row, with FK to `identity_accounts`; both **PASS**, resulting in exactly one aggregate each across UTC day/week/month and no extra actor tokens.
- [Security floor run 43541780109](https://github.com/1troitsky/photobunker-v3/actions/runs/43541780109): **PASS**. [UX lane run 43541780129](https://github.com/1troitsky/photobunker-v3/actions/runs/43541780129): **PASS**. Total **3/3 workflows, 4/4 jobs PASS** on source HEAD `8d87f301...`.
- Initial source SHA `b6aec0d...` [CI 43541668366](https://github.com/1troitsky/photobunker-v3/actions/runs/43541668366) **FAIL** a NEW negative test: it incorrectly expected a conflict when the source timestamp changed by one second in the same calendar day. Coarse `TelemetryRecord` intentionally omits exact timestamps, so its fingerprint is unchanged. Updated only our own negative test at `8d87f301...` to verify same-day Duplicate + cross-day Conflict. No weakening/changing foreign tests or application code; source replay itself unchanged.

### Remaining acceptance
`#229` **OPEN / IN PROGRESS**; [Draft #317](https://github.com/1troitsky/photobunker-v3/pull/317) unmerged. A verified SOURCE REPLAY is not automatic telemetry delivery, and it cannot replace **trusted authenticated producer hooks**, retry scheduler/durable producer outbox, event failure policies, high-cardinality/outlier protections, consent and sampling, approved retention of counters, HMAC key rotation, Admin MFA/RBAC #227, authorized read/export API, true dashboard, actual iOS/Android, product QA. No broad metric-coverage claims. Owner has not authorized any merge/deployment or destructive operation.

**Next owner-triggered step:** reread live #302, PRs, claims, then consider independent strictly server-internal background wiring/safe producer outbox with consent gates and source replay cursor discipline; otherwise take another free independent Issue. No background work after report.

---

## 2026-11-14 third acceptance — operator-only opt-in, fail-closed bounded reconciliation

**Owned product code HEAD:** `ca2c7e620e37d2ec441f1b7f70113e760c463f41` (parent `4b4ddad39f5a28019ce6b97c2973737f37029cba`). Same CHAT-I, Issue #229, [Draft #317](https://github.com/1troitsky/photobunker-v3/pull/317); [exclusive CLAIM addendum #6869613505](https://github.com/1troitsky/photobunker-v3/issues/229#issuecomment-6869613505). Parent security #298 is READ-ONLY; original main SHA `6565a0fe852882ea5fc26e493df81affed687eee` unchanged.

### Implemented, explicit safety boundaries
- NEW `apps/api/app/Telemetry/AssignmentReplayRunner.php`: bounded, internal-only 1–200 rows per page, 1–500 pages per invocation; never publishes or persists the source keyset cursor, only aggregate integer counts and a `complete` flag. Scans from the beginning of the accepted 7-day UTC window for each invocation to recover from crashes. Durable HMAC receipts prevent double counting. A capped scan returns `complete=false`; calling process must not report it as complete.
- NEW `apps/api/bin/telemetry-replay-assignments.php`: standalone CLI `--execute` ONLY, deliberately **not** registered with Laravel CLI scheduler, HTTP routing or any automatic hook. No action unless **both** `PB3_TELEMETRY_REPLAY_ENABLED=1` and `PB3_TELEMETRY_POLICY_APPROVED=1` are explicitly supplied, a distinct external HMAC secret of 32–4096 bytes is provided, app debug is false, and database driver is PostgreSQL. Invalid/extra arguments fail without executing. Page bounds are strictly parsed from operator-only environment, defaults 100×100. Failure prints only a generic static diagnostic, never raw IDs, cursor, SQL, stack trace or HMAC key. Incomplete scan exits 75; disabled exits 78; success exits 0.
- NEW `apps/api/tests/Feature/Telemetry/AssignmentReplayRunnerTest.php`: three tests prove cap reporting, idempotent re-scan after interruption, complete second scan, no raw identifiers in outputs, dual gates/DB driver/debug/secret-strength enforcement, and invalid bounds. Existing source/DB tests untouched.
- OWN CI workflow `.github/workflows/p3-telemetry-db-229.yml` extended with an **actual separate PHP CLI process** in disposable PG18 to prove no-policy default denial (status 78, no database changes) and a deliberate test-only enabled retry of the previously admitted genuine meter event (exactly one duplicate, zero accepted).

### Exact code SHA CI
- [PG18 #43542671350](https://github.com/1troitsky/photobunker-v3/actions/runs/43542671350): **2/2 jobs PASS**, PHP 8.4.27 **255/255 PHPUnit tests, 3762 assertions**, PHP 8.5.12 **255/255, 3762 assertions**; targeted sink 3 tests/37 assertions each; real two-process PG18 HMAC dedupe and source-ledger reconciliation **PASS**; actual CLI denied + enabled disposable replay **PASS**; Composer locked Audit **0 advisories**.
- [Security #43542671302](https://github.com/1troitsky/photobunker-v3/actions/runs/43542671302): **PASS**; [UX #43542671482](https://github.com/1troitsky/photobunker-v3/actions/runs/43542671482): **PASS**. Total **3/3 workflows, 4/4 jobs PASS** on exact `ca2c7e620e37d2ec441f1b7f70113e760c463f41`.

### Important: activation is not policy approval
The environment gate is merely an operator acknowledgement; **it is NOT real per-user consent management, actual legal approval, or proof of privacy-policy compliance**. Owner approval for retention, consent/sampling, secret rotation and authenticated admin access #227 is still **OPEN**. Do not enable on production user data just because the CLI supports execution. There is no cron/schedule binding, event hook, public endpoint or dashboard. Unbounded high-volume automated ingestion, persistent progress under sustained backlog, monitoring, source integrity and complete analytics remain NOT TESTED/NOT IMPLEMENTED. No deployment/merge/main changes permitted.


---

## 2026-11-14 fourth acceptance — internal real UTC aggregate reader (no admin API)

**Product code SHA** `8a3b78ee87efb021c625cc519e0972b480a57de3`. Own [#229 source/reader CLAIM addendum #6869732931](https://github.com/1troitsky/photobunker-v3/issues/229#issuecomment-6869732931), shared coordination [START #6869726332](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6869726332). This only adds two NEW owner files and modifies two existing owner test/CI files; no foreign #227 Admin, #198 Notifications, auth/bootstrap/routes, existing durable telemetry writer or production schedule changes.

### Internal implementation and privacy boundaries
- NEW `apps/api/app/Telemetry/InternalAggregateReader.php` verifies *real* persisted `telemetry_counters` with one bounded read-only SQL query per metric/window. Only strict allowlisted aggregate metric names, `day`/ISO `week`/`month`, exact canonical UTC `YYYY-MM-DD` / `YYYY-Www` / `YYYY-MM`, inclusive bounded windows (31 days / 13 weeks / 12 months). ISO rollover correctly treats 2025-12-31 as 2026-W01. Reject malformed periods, wildcard/injection attempts, incorrect ISO week 53, inverted/overwide windows and corrupt/negative/overflowed numeric aggregates.
- Output is only `metric`, `periodKind`, `from`, `to`, `sourceCoverage: not_proven`, `points: [{period,count}]`. **Missing periods remain absent, not invented as zero**. This read is NOT proof of complete source ingestion; no fake completeness claim.
- Does not access or return pseudonymous `telemetry_active_tokens`, `telemetry_event_receipts`, identity ledgers, metadata, plaintext, raw source operation/user IDs, HMAC key or GPS. The aggregate totals themselves can expose small-cohort activity: **not authorized for end-user exposure or admin export** until actual MFA/RBAC and privacy policy, k/outlier protection and retention decisions are approved.
- No controller, route, Blade/Vue/dashboard, session/permission handling, command or background task mounts this class. It is an inert internal reader intended for security-reviewed downstream Admin wiring. Existing default-OFF operator replay remains default OFF.

### Exact code SHA CI and real PostgreSQL evidence
- [PG18 workflow #43543449622](https://github.com/1troitsky/photobunker-v3/actions/runs/43543449622): 2/2 matrix PHP jobs PASS. PHP **8.4.27** full PHPUnit **258/258 tests, 3,795 assertions**; PHP **8.5.12** full PHPUnit **258/258 tests, 3,795 assertions**. New focused reader **3/3, 33 assertions** each; earlier sink focused **3/3, 37 assertions** each. Composer locked Audit **0 advisories**.
- Each PHP job on disposable PostgreSQL 18: independent two-PHP-process HMAC receipt race **PASS**; independent two-PHP-process genuine assignment ledger replay **PASS**; new explicit real database reads on actual `assignment.created` UTC day and ISO week counters **PASS**; unknown `backup.verified` empty source remains `[]`, reader marks `sourceCoverage: not_proven`; denied/explicitly enabled operator-only CLI **PASS**.
- [Security floor #43543449684](https://github.com/1troitsky/photobunker-v3/actions/runs/43543449684) PASS. [UX guard #43543449630](https://github.com/1troitsky/photobunker-v3/actions/runs/43543449630) PASS. **3/3 workflows, 4/4 jobs PASS on exact source SHA**. No failures to conceal at this phase.

### Product acceptance remains OPEN
`#229` is OPEN / in-progress, Draft [PR #317](https://github.com/1troitsky/photobunker-v3/pull/317) NOT merged. This is a DB-backed reader with genuine tested counters, **not an accepted/admin-authorized analytics API or live Dashboard**. No activation or production export. Blockers: owner-approved consent/opt-in/sampling/outlier policy, source coverage proofs, counter retention/key rotation, #227 real MFA/RBAC auth and access audit, stable secured API/UI, multi-metric production provenance, actual devices and operational review. No main or foreign work changed.
