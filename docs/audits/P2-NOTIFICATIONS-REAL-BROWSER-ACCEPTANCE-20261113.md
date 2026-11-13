# PB3 P2 #198 — real-browser Notifications acceptance (13 November 2026)

**Repository:** `1troitsky/photobunker-v3`  
**Draft PR:** [#296](https://github.com/1troitsky/photobunker-v3/pull/296)  
**Working branch:** `feat/p2-198-notification-projection-20261113`  
**Last fully validated code HEAD:** `a17cdb3003e6f49cd78c9293818a77852229f330`  
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
| Identity and account/device projection, revoke/ACL, lost ACK, gap admission | Real Laravel/PHPUnit on Postgres-compatible migrations; feature and unit coverage | **PASS** on validated code HEAD `a17cdb30` (Laravel 8.4/8.5; Foundation workflow `43479184949`) |
| Local AES-GCM event save before client ACK, corrupted payload and session handoff | `apps/web/src/features/notifications/application/server-event-sync.test.ts` / `local-inbox.test.ts` | **PASS** on validated code HEAD `a17cdb30` (Foundation `43479184949`) |
| Offline UI, All/Unread, read and mark-all, target click ACL and identity swap | Mounted `apps/web/src/views/NotificationsView.test.ts` | **PASS** on validated code HEAD `a17cdb30` (mounted Vitest and TS/build) |
| **Real Chromium A→B** registered account, encrypted event ID at rest, lost ACK, durable local read, warm offline, second-device recovery, revoked-device 401, outsider-account separation | **New** `tests/e2e/p2-settings-notifications.spec.ts`, matched by existing `tests/playwright.config.ts` and picked up by PostgreSQL 18/Garage 2.5 storage workflow | **PASS** on exact code SHA `a17cdb30`: real PostgreSQL/Garage workflow `43479184659`, job `132070889897` **85/85 Chromium PASS (4.8 min)**; includes this scenario |
| iOS Safari / Android physical device | No physical hardware evidence | NOT TESTED |
| Notification push, cross-device read state, remote encrypted inbox, push without metadata leaks | Not implemented | NOT IMPLEMENTED |
| Verified backup success producer | No verified snapshot/restore proof (only admission and cooldown) | BLOCKED; never synthesize `BackupVerified` |
| TTL deletion notice | Retryable outbox with retention-deadline semantics, not physical S3-deleted assertion | PHPUnit evidence exists; operator-gated cleanup remains OFF in production |

## Exact-head automated acceptance evidence

- **Validated code HEAD:** `a17cdb3003e6f49cd78c9293818a77852229f330`.
- Foundation / Laravel 8.4, 8.5 and Vue/Vitest/TypeScript/build: **PASS**, GitHub Actions run [43479184949](https://github.com/1troitsky/photobunker-v3/actions/runs/43479184949).
- Security floor/contract: **PASS**, run [43479184686](https://github.com/1troitsky/photobunker-v3/actions/runs/43479184686).
- UX lane scope guard: **PASS**, run [43479184704](https://github.com/1troitsky/photobunker-v3/actions/runs/43479184704).
- Isolated PostgreSQL 18 + Garage 2.5 + **real Chromium 85/85 PASS (4.8m)**, run [43479184659](https://github.com/1troitsky/photobunker-v3/actions/runs/43479184659), job `132070889897`. This run includes the new real Key-Only A→B Notifications test.
- Earlier failed run [43477663084](https://github.com/1troitsky/photobunker-v3/actions/runs/43477663084) had **84/85 PASS**; the one Notifications test attempted sync immediately after page reload while account was deliberately local/offline pending login proof. The test was corrected through the actual `reauthenticate()` flow; no production auth guard was weakened.
- The exact-head browser acceptance covers the documented **automated** scope only. A green CI does not establish push, native Safari/Android, backup restore or remote E2EE inbox acceptance.

## Release and safety gate

Do NOT merge PR #296 or mark issue #198 ready until all remaining P2 issue acceptance gates are resolved and the product owner explicitly authorizes a merge. Local notification ACK is a device-scoped delivery cursor, **not a read receipt**; the UI marks read only in encrypted local storage. After a recipient invite is revoked or expired, server target validation rejects old cached local notification click attempts. No change to Matrix, Camera, or other PR branches.


## Encrypted display settings acceptance — follow-up code SHA

**Exact code SHA** `01f2d5a3462f65b93abf23daa648dc0cb361fb29` — all four workflows **PASS**:
- [Foundation / PHP 8.4 + 8.5 / frontend](https://github.com/1troitsky/photobunker-v3/actions/runs/43482531707).
- [Security](https://github.com/1troitsky/photobunker-v3/actions/runs/43482531702).
- [UX](https://github.com/1troitsky/photobunker-v3/actions/runs/43482531730).
- [PostgreSQL 18/Garage 2.5/real Chromium](https://github.com/1troitsky/photobunker-v3/actions/runs/43482531723), job `132082388790`, **86/86 Chromium PASS (6.2m)**. Includes the new real browser notification settings test after login, reload and encrypted IndexedDB readback.

The display settings scope: opt-in local visibility for invitation/deadline/expiry/system and badge marks, mandatory security notifications visible, AES-GCM per-account IndexedDB storage; push remains disabled. The complete database event and delivery cursor is never filtered by client display settings.

**Subsequent hardening — NOT YET ACCEPTED:** Starting with `321e7abe` and through code HEAD `fd224c1aea1e737a6014b831beb96aa902a663e4`, separate bugfixes ensure tampered preferences cannot hide the independently decrypted notification list, and mark-all excludes hidden categories. These commits introduce new tests and require **their own exact-head** frontend and Chromium CI; do not extend the `01f2d5a3` 86/86 PASS claim to them.
