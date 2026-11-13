# PB3 P3 — #223 Dead Man's Switch signed server countdown (non-destructive)

Date: 2026-11-14. Agent: CHAT-C. State: **PARTIAL / in-progress**, NOT a production switch.

## Coordination, provenance and ownership

- Owner [Issue #223](https://github.com/1troitsky/photobunker-v3/issues/223), [CLAIM](https://github.com/1troitsky/photobunker-v3/issues/223#issuecomment-6865223587), [CI addendum](https://github.com/1troitsky/photobunker-v3/issues/223#issuecomment-6865319683). [#302 live journal START](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6865218274).
- Base: **unmerged, independently security-reviewed #297 Draft #298** `60407676c7cb9bdb649f5017cf9450aff25eedab` (Laravel 13.42.0 / CVE-2026-128083 fixed, 4/4 upstream CI PASS), not vulnerable `main@6565a0fe852882ea5fc26e493df81affed687eee`. Own Draft PR #307 targets `security/297-laravel-13-audit-20261113` for correct narrow diff. No changes to security branch or main.
- Checked AGENTS.md, ts.md §6.4–6.5, #223, #302, current main/PRs, identity_accounts/identity_devices schema, signing `App\Identity\Protocol` and backup admission lock. Other lanes #198/#296 (CHAT-A), #211/#301 (CHAT-B), #206 (CHAT-D), own #219/#305/#210/#304/#232/#303, #297/#298 and #230/#299 untouched.
- Exclusive changed paths: NEW `apps/api/app/DeadMan/DeadManSwitch.php`, NEW `apps/api/database/migrations/2026_11_14_000001_create_dead_man_switch_v1.php`, NEW `apps/api/tests/Feature/DeadMan/DeadManSwitchTest.php`, NEW `.github/workflows/p3-deadman-switch-223.yml`, this audit. No shared routes, CI, identity code, existing migration or TS_PROGRESS_TABLE edits.

## Actual implemented server domain (not mock UI)

- A versioned, exact-field, domain-separated P-256 signed operation using an **unrevoked identity_devices signing_spki** on a **ready identity_accounts** row. Payload contains accountId, deviceId, operationId, kind, expectedRevision, version 1 and period (Off/4/6/12/24 months). No client-supplied time, deadline, or arbitrary additional field. Signature and issuer checked inside account `FOR UPDATE` transaction. Session/CSRF adapter is **not implemented** and must authenticate caller independently before calling this service.
- Persistent `dead_man_switches_v1` per account: versioned state disabled/armed/warning/expired_review, revision, server-confirmed activity timestamp, warning and deadline, and timestamps. Actual PostgreSQL server time `clock_timestamp()` is read **after** taking the account lock. UTC calendar month calculation uses no overflow.
- Persistent append-only `dead_man_operations_v1` by global operationId, account+device, SHA-256 digest of signed canonical payload, action, resulting revision/state/deadline and accepted timestamp. Exact retries are idempotent; conflicting reused operationId, stale revision or different account/issuer are denied. A revoked device cannot replay an old accepted operation as a fresh authenticated action.
- `sweepDue()` is callable by a future scheduler: due warning state, then `expired_review` at/after deadline, idempotent and account-lock serialized against check-in/configure. A genuine signed check-in can rearm before irreversible action (none is implemented). A disabled switch never expires.
- `warning` is a **durable due state**, **not a notification delivery confirmation**. `expired_review` is a **non-destructive marker**, NOT Panic, GC, cloud deletion, device revoke or Recovery Vault policy. There is zero code capable of deleting media, changing backup vault, sending push or starting a destructive task from the switch.

## Exact-head CI evidence

**Exact code/tests HEAD:** `2877eb4362af76b75aac7cbb6ef3524e8b9f4d5e`.

[Dedicated PR Actions 43511131736](https://github.com/1troitsky/photobunker-v3/actions/runs/43511131736): **3/3 PASS** on security-patched Laravel tree.
- PHP 8.4.27: real Laravel Feature PHPUnit **19 tests, 275 assertions, 1 PG-only skipped**; 18 SQLite cases executed; new PHP files lint clean; `composer audit --locked` **0 advisories**.
- PHP 8.5.12: same **19 tests, 275 assertions, 1 PG-only skipped**; 18 SQLite cases executed; new PHP files lint clean; locked audit **0 advisories**.
- Disposable real PostgreSQL 18.7 + PHP 8.4.27: migrations PASS, targeted server-clock/signature/warning/expiration test **1/1 PASS, 17 assertions**, without in-memory SQLite.
- [P0 Security run 43511131944](https://github.com/1troitsky/photobunker-v3/actions/runs/43511131944) PASS. [UX lane guard 43511131779](https://github.com/1troitsky/photobunker-v3/actions/runs/43511131779) PASS.
- Negative evidence preserved: first PG run [43510940283](https://github.com/1troitsky/photobunker-v3/actions/runs/43510940283) **2/3 PASS, PG FAIL** at an over-strict subsecond comparison (`DeadManSwitchTest.php:375`) because the persisted timestamp rounded to whole-second precision; test adjusted with an explicit ±1-second precision allowance **without changing product code, skipping tests or falsifying server time**. Later run 43511131736 3/3 PASS on exact code HEAD.

**Workflow caveat:** existing `p0-02-foundation.yml` / `p0-02-storage.yml` do **not** run on PRs targeting `security/297-...`, hence a new dedicated workflow performs actual Laravel PHPUnit and separate disposable PG18. A 3/3 dedicated PASS does NOT equal the broad frontend/Chromium/Garage/Matrix full suite on this branch.

## Blockers / NOT TESTED

- Full #223 requires an authenticated same-origin HTTP session/CSRF adapter and trusted signed operation submission UI; no new routes added. No real scheduled cron/worker registered; invocation of `sweepDue()` is currently an internal service contract. A durable warning flag is NOT a delivered email/push/alert.
- **OPEN owner decision** in ts.md §6.4: whether DMS expiry ultimately destroys or preserves Recovery Vault. No destructive end-stage code should run without explicit decision, verified Panic separation and independent security review. No irreversible delete is implemented anywhere in this diff.
- Notification delivery/acknowledgements, durable external scheduling, cross-process PG18 lock contention, power loss/retry, device revocation racing with check-in, multi-device actual authenticated browser/PWA tests, native iOS Safari/Android, and full end-to-end server UI tests: **NOT TESTED**. Tests include sequential idempotency and one genuine PG18 wall-clock lifecycle, **not** multi-process concurrency acceptance.
- No changes to live S3, backup, billing entitlement, Matrix crypto, Panic, key hierarchy, E2EE metadata or local outbox. No real notification or deletion is claimed.

**Verdict:** real persistent signed server-side timer/scheduler *domain* + isolated real Laravel/PG18 acceptance PASS. Issue #223 remains **in-progress** until HTTP/UI/worker, warning delivery, owner policy decision and independent destructive security acceptance. No merge/deployment/main changes.
