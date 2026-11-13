# PB3 P2 #198 — real-browser Notifications acceptance (13 November 2026)

**Repository:** `1troitsky/photobunker-v3`  
**Draft PR:** [#296](https://github.com/1troitsky/photobunker-v3/pull/296)  
**Working branch:** `feat/p2-198-notification-projection-20261113`  
**Code HEAD of this audit:** `791827ecca405b075df8ecc0eb43a60672eb4e2d`  
**Base main:** `6565a0fe852882ea5fc26e493df81affed687eee`  
**Integration:** NOT AUTHORIZED; no merge/deployment; main unchanged.

## Scope and acceptance criteria

- Browser entry `/notifications`, encrypted AES-GCM local inbox and All/Unread/read/mark-all controls.
- Account/device-verified metadata-only server feed; safe replay of dropped ACK after local encryption.
- Current ACL check at every click; no targetId, sensitive text or media grants from cached notification.
- Signed first-account creation event, real A→B Key-Only recovery (distinct browser contexts), and third unrelated anonymous account.
- Revoking device B must cause its future server feed to return 401 while existing encrypted local records remain locally usable.
- Warm offline after boot is supported; **cold offline Service Worker bootstrap is NOT accepted**.

## Evidence added in Draft #296

| Scenario | Automated evidence | Acceptance at this snapshot |
| --- | --- | --- |
| Identity and account/device projection, revoke/ACL, lost ACK, gap admission | Real Laravel/PHPUnit on Postgres-compatible migrations; feature and unit coverage | PHP 8.4/8.5: PASS on previous CODE SHA `7cd98343`; latest code SHA needs its own PASS |
| Local AES-GCM event save before client ACK, corrupted payload and session handoff | `apps/web/src/features/notifications/application/server-event-sync.test.ts` / `local-inbox.test.ts` | Vitest and TS/build: PASS on `7cd98343`; latest code SHA pending |
| Offline UI, All/Unread, read and mark-all, target click ACL and identity swap | Mounted `apps/web/src/views/NotificationsView.test.ts` | PASS on `7cd98343`; latest code SHA pending |
| **Real Chromium A→B** registered account, encrypted event ID at rest, lost ACK, durable local read, warm offline, second-device recovery, revoked-device 401, outsider-account separation | **New** `tests/e2e/p2-settings-notifications.spec.ts`, matched by existing `tests/playwright.config.ts` and picked up by PostgreSQL 18/Garage 2.5 storage workflow | **NOT TESTED on exact HEAD yet** until workflow has completed; source code in PR is not evidence of execution |
| iOS Safari / Android physical device | No physical hardware evidence | NOT TESTED |
| Notification push, cross-device read state, remote encrypted inbox, push without metadata leaks | Not implemented | NOT IMPLEMENTED |
| Verified backup success producer | No verified snapshot/restore proof (only admission and cooldown) | BLOCKED; never synthesize `BackupVerified` |
| TTL deletion notice | Retryable outbox with retention-deadline semantics, not physical S3-deleted assertion | PHPUnit evidence exists; operator-gated cleanup remains OFF in production |

## Required CI evidence

Latest code HEAD `791827ecca405b075df8ecc0eb43a60672eb4e2d`. All four workflows (Foundation, Security, UX, isolated PG/Garage) were **IN PROGRESS** on first check. Prior `7cd98343`: Foundation 3/3 jobs, Security and UX **PASS**; PG/Garage **IN PROGRESS**. Never reuse a previous commit's PASS for exact-head acceptance. Inspect `p2-settings-notifications.spec.ts` result and Playwright traces on any failure.

## Release and safety gate

Do NOT merge PR #296 or mark issue #198 ready until the actual Playwright/PG/Garage run finishes and errors are resolved, and the product owner explicitly authorizes a merge. Local notification ACK is a device-scoped delivery cursor, **not a read receipt**; the UI marks read only in encrypted local storage. After a recipient invite is revoked or expired, server target validation rejects old cached local notification click attempts. No change to Matrix, Camera, or other PR branches.
