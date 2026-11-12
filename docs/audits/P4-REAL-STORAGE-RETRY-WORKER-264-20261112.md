# P4 #264 — real Garage integration QA of new StorageRetryLedger (2026-11-12)

**QA-only candidate. No production API/worker/crypto policy changes.** This standalone Draft descendant targets [#269](https://github.com/1troitsky/photobunker-v3/pull/269) @ `1e06b553454258c5317157f76270c4aa66cd913a`, already 4/4 PASS. The original #266 worker and #259 outage harness are untouched. `main` and all source PRs remain unmodified.

## Why this matters

The 77/77 Chromium plus real Garage stop/start in #269 validates the old P4 Lifecycle path, *not* a genuine retry executed by the newly introduced `StorageRetryLedger` after the S3 server has recovered. Treating both as one proof would falsely mark production fault recovery as accepted. This QA extends the **existing** disposable Garage experiment to cover the new worker under the real PostgreSQL 18 / Garage 2.5 setup.

## Strict disposable safety

The existing shell/PHP guards require `GITHUB_ACTIONS=true`, `APP_ENV=testing`, `PB3_ISOLATED_STORAGE_SMOKE=1`, `DB_CONNECTION=pgsql`, `DB_HOST=127.0.0.1`, `DB_DATABASE=pb3_ci_p0`, `S3_ENDPOINT=http://127.0.0.1:3900`, `S3_BUCKET=pb3-ci-p0`, a specifically named running Docker container and a distinct `RUNNER_TEMP` fixture. No production host, customer content, key material or real user can be addressed by this path.

## Three independent PHP processes (real S3, no fake adapter)

1. **Prepare:** construct a second synthetic encrypted photo/asset with its parent still `pending` and child `uploading`; invoke the **production `StorageManager::writeAsset`** on real Garage; assert a durable `storage_retry_tickets` ticket was created before the PUT, while no receipt was falsely acknowledged. Preserve a SHA-256 in a private runner-local fixture.
2. **Garage stopped:** the pre-existing shell stops the disposable Garage container while PostgreSQL remains live; keep all old Lifecycle assertions unchanged. Additionally call the production `pb3:storage-reconcile --batch=5` Artisan command in this second PHP process, require `disposition=retry` and unchanged pending parent/uploading asset/reserved location.
3. **Garage restarted:** after physical Docker restart, a third PHP process verifies the exact previously written S3 bytes/SHA-256. Require the retry backoff ticket still be pending if queried prematurely, then deterministically advance the test clock past both 30s retry and provider circuit cooldown. Invoke `pb3:storage-reconcile --batch=5`; require verified asset and location, retired retry ticket, unchanged parent pending (no forged signed finalize receipt), and idempotence of a second command.

All existing tests and their negative assertions stay. New conditions are additive; no bypass/retry weakening, no service stop beyond the existing disposable Garage fault matrix. The server never stores plaintext or credentials in tickets, logs only metadata.

## Mandatory evidence

Exact-head full GitHub Actions: PHP 8.4/8.5 PHPUnit, TS/build/Vitest, Security/UX, real PG18/Garage outage and **77/77 or more Chromium**; log explicitly needs `P4 Garage NEW-WORKER S3-DOWN PASS` and `P4 Garage NEW-WORKER RECOVERY PASS` in the same real storage workflow. If the first attempt fails, retain its run and fix the test or proven product defect only in this QA branch without weakening assertions.

No claim of real process-kill during the PUT itself, native mobile acceptance, BYO/replicated S3, Matrix, owner approval or release readiness. A test using synthetic lost-ACK state does not emulate killing the PHP runtime in the middle of the actual TCP response. These remain separate scope as appropriate.

**Status: CI PENDING at document creation.**
