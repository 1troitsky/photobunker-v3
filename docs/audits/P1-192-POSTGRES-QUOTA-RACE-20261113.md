# P1 #192 / QA #279 — real PostgreSQL two-process quota admission races

**Date:** 2026-11-13. **Status:** Draft QA, full exact-head CI PENDING.
**Base:** accepted [#278](https://github.com/1troitsky/photobunker-v3/pull/278) @ bb68436f698935453102098e2b999e46bfa28040 (4/4 CI PASS). Main at da7327b8c9c440dae3dc864b3245b9f9f4ad14eb remains unchanged. Issue #192 is in-progress; separate QA-only claim [#279](https://github.com/1troitsky/photobunker-v3/issues/279).

## What the test actually proves

Production QuotaAdmission::admit() locks the same identity_accounts row before reading current EntitlementLedger and AccountUsage. Signed Photo and Media reservations use this shared admission service inside their transaction. AssignmentV1Controller::create also uses this account-row lock, then production MonthlyCreationQuota::usage() before inserting both the assignment and its immutable meter.

The existing tests exercised these services, but not simultaneous transactions across TWO genuinely separate PHP processes with separate PostgreSQL connections on the same last quota slot.

The new opt-in apps/api/tests/integration/p1-quota-postgres-race.php runs in the real isolated PostgreSQL 18 CI after migrations. Both child workers boot Laravel independently. Worker A holds the real account row lock after production admission, announces readiness, waits until B is about to enter its own transaction, then holds the lock another 700 ms before inserting the pending Photo, Media or Assignment+meter and committing. B must wait, observe committed usage and refuse 413 (Photo/Media) or 403 (Assignment). Elapsed time, durable final totals, distinct worker exit codes and both process outputs are checked.

Five scenarios:
1. Free 49/50 file count; distinct device rows, Photo A vs Media B: exactly one accepted, final 50 files and 256 reserved ciphertext bytes, B denied 413.
2. Verified Go 249/250 file count; Media A vs Photo B: one accepted, final 250 and 256 ciphertext bytes, B denied 413.
3. Verified Go 29,999,999,744/30,000,000,000 decimal bytes; Photo A vs Media B: 256 bytes added, final exactly 30e9, B denied 413.
4. Free 2/3 UTC monthly Assignment count: one atomic creation+meter, second denied 403.
5. Go 29/30 UTC monthly Assignment count: one atomic creation+meter, second denied 403.

Cross-account usage for a separate unrelated account must remain unchanged.

## Scope boundaries / honesty

All database objects are explicitly SYNTHETIC fixture metadata. The harness does not issue actual signed HTTP requests, perform E2EE, upload tens of GB to S3, settle payments, or authenticate two mobile sessions. The verified Go entitlement is an internal synthetic transition for disposable CI accounts only. It proves PostgreSQL account-row serialized admission and cross-protocol quota checks; production signed HTTP concurrency and physical-device reacceptance remain separate gates.

Fail-closed safety: GitHub Actions=true, PB3_ISOLATED_STORAGE_SMOKE=1, APP_ENV=testing, exact PostgreSQL database pb3_ci_p0 on 127.0.0.1, isolated Garage endpoint/bucket, cleanup OFF, migrated tables verified after Laravel boot. Never touch production or staging.

## Exact-head acceptance

Existing CI untouched except ONE required PostgreSQL test step appended before real S3 digest smoke in .github/workflows/p0-02-storage.yml. Require full PHP8.4/8.5 PHPUnit, TypeScript/build, all Vitest, security, UX, PG18/Garage outage/recovery and all 78+ Chromium tests, plus five independent races. No skips/retries/weakening. Preserve initial failed runs and only report PASS for exact immutable HEAD.

Do not merge to main. Issue #192 still needs higher-layer signed HTTP concurrency, real billing settlement and #203 retention; #254 Browser cursor, physical devices and Matrix remain separate.