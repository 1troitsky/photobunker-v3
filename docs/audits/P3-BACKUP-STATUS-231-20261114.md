# PB3 #231 — owner-only advisory backup lease/cooldown status · 2026-11-14

**Coordination:** CHAT-F, [START #6867749452](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6867749452), [CLAIM #6867757341](https://github.com/1troitsky/photobunker-v3/issues/231#issuecomment-6867757341).
**Scope:** PARTIAL P3 #231 safe, read-only technical status, not complete backup start.

## Context and reason for independent slice

Existing #189 / PR #246 introduced real `BackupAdmission` with PostgreSQL row locks, unique active lease, worker heartbeat and one accepted start per hour; this class was already in remote main `6565a0fe852882ea5fc26e493df81affed687eee`. Yet no P3 worker/snapshot engine is attached. Exposing `POST /backup/v1/start`, `confirmStart`, `finish` or a supposed completed backup without a durable encrypted manifest and verified worker receipt would create a false success state. Thus this PR **does not accept or start backups**.

Current foreign #198 Draft PR #296 claims and modifies `apps/api/routes/web.php` and Notifications UI/router. No shared file touched. Instead one narrow Laravel bootstrap route registration points to a separate backup-only file under the existing session `web` middleware. #219 Recovery Vault, #223 DMS, #220 PIN, #226 Grace, #297 security and #296 Notifications are read-only dependencies with independent ownership.

## Exact owned paths

- NEW `apps/api/app/OperationalLimits/BackupRateStatus.php`: strictly read-only projection of the existing server admission table, real PG `clock_timestamp()` and UTC `asOfAt`; precedence of an unexpired reserved/started lease and last `accepted_at` cooldown; take the **later** of two deadlines so 900-second lease does not silently override 3,600-second protection; operational configured floor cannot drop below 3,600 seconds. Counts of active leases or final backup status are NEVER inferred from client data. Response explicitly marks itself `advisory_only_not_backup_eligibility_or_verified_backup`. No disclosure of operation ID, lease ID, account ID, IP, backup contents, encrypted keys or credentials.
- NEW `apps/api/app/Http/Controllers/BackupLimitsStatusController.php`: `PhotoSync::actor()` authenticates current Laravel Identity v2 session/account/device, ready and not revoked, no client account selector; no-store. GET only.
- NEW `apps/api/routes/backup.php`: authenticated `GET /backup/v1/limits` only; no client POST.
- NARROW `apps/api/bootstrap/app.php`: Laravel `withRouting(... then: ...)` to register the separate route with `web` middleware, not editing foreign `routes/web.php`.
- NEW `apps/api/tests/Feature/OperationalLimits/BackupLimitsStatusTest.php`: actual Laravel GET/session and true database-backed `BackupAdmission` operations, Free/Unlimited+ technical floor, reserved/started/failed/stale lease cases, two accounts, revoked/foreign/expired identity sessions, no fake backups/POST, privacy and no DB mutation on read.
- NEW `.github/workflows/p3-backup-status-231.yml`: scoped independent PHP 8.4/8.5 full PHPUnit/Composer locked audit, disposable real PostgreSQL18 feature suite, full frontend TypeScript/build/Vitest regression and no POST route gate.
- THIS QA report `docs/audits/P3-BACKUP-STATUS-231-20261114.md`.

Own stacked security baseline is independent read-only #297 [Draft PR #298](https://github.com/1troitsky/photobunker-v3/pull/298) SHA `60407676c7cb9bdb649f5017cf9450aff25eedab`, needed for inherited Laravel advisory fixed by that separate agent. Main untouched.

## Safety boundaries

The GET response is **advisory only**. Atomic `BackupAdmission::reserve()` + `confirmStart()` **must be used by a future durable backup worker**; the browser cannot use these internals, cannot infer that a backup has been generated and never receives worker lease tokens. `retryAfterSeconds` is a display field about current technical timing, **NOT a real HTTP 429 Retry-After**; there is no writable HTTP start route yet to reject with 429. This is not a bypass of product backup quotas or proof of verified Recovery Vault snapshot.

## Acceptance and remaining blockers

- Code exact HEAD and CI: PENDING.
- Verify on real PG18: sessions, cross-account device ACL, readonly GET, started/failed rate status, UTC and no restart bypass.
- NOT TESTED by this scope: backup creation, encryption/manifest SHA, durable S3 upload, accepted worker, actual client Retry-After on denied POST, progress UI, stuck worker recovery, real secondary S3, physical iOS/Android and full end-to-end client after reload. These remain mandatory for #231/#218 completion.
- This Issue must remain **in-progress / PARTIAL** even with all CI PASS; no merge into main without owner permission. Original #189 uses DB row locks to guarantee atomic starts; this GET cannot and does not claim to offer atomic admission.
