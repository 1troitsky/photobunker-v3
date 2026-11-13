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


## Push trust preflight (not a push implementation)

The PWA entry `apps/web/src/main.ts` explicitly does NOT register a Service Worker, and `apps/web/vite.config.ts` sets `VitePWA({injectRegister:false,registerType:'prompt'})`. Enabling real push before approving signed-release/Service Worker trust would silently bypass a deliberate P0 security boundary. Accordingly, the UI push toggle remains **disabled** and there is NO VAPID registration, subscription storage, worker or delivery claim.

The new server-side pure `App\\Events\\PushWakePayload` is a forward-compatible **fail-closed payload contract only**: its only byte-exact body is `{"v":1,"action":"check-inbox"}`. It contains no event, subject, account, recipient, device, media, invitation, location, read marker or key metadata. Only an authenticated client can later fetch the durable inbox under existing identity proof and ACL. The test rejects extra JSON keys, event identifiers, alternate actions, schema versions and reordered serialization, and checks the same fixed body across event types. This class is not wired to any transport and cannot be used to infer delivery or authorization.

To implement push in a future independently claimed step: approve signed service-worker release verification and security update mechanism; add user-gesture permission, account/device authenticated push subscription lifecycle, VAPID secrets in protected environment, unsubscribe on logout/key rotation/revoke/emergency PIN, delivery retries/expiry/remote wake without PII, payload and callback audits, Safari iOS installed PWA + Android device tests, failure/replay/abuse limits and no silent worker activation. Server ACK remains encrypted-local-commit delivery status, never push or read receipt.

## Hardening automated acceptance — exact SHA `fae52e19`

All four workflows completed **PASS** on `fae52e196ee40f8898c4e29afad5d75b15fb1439`:
- Foundation `43483933213`, Security `43483933620`, UX `43483933556`: PASS.
- Isolated PostgreSQL 18/Garage 2.5 run [43483933703](https://github.com/1troitsky/photobunker-v3/actions/runs/43483933703), job `132087280352`: **86/86 Chromium PASS (4.7m)**.

These checks include the previously hardened encrypted preferences loading (tampered preferences cannot hide inbox) and filtered Mark All (hidden events remain unread). This is the newest fully accepted **automated** Notifications code prior to the push wake contract addition. The `PushWakePayload` code HEAD `4f53143cece4a330a83039347585505718a8d1f3` completed Foundation/Security/UX PASS but its PostgreSQL/Garage run is still in progress at writing; do not use older green results for that code.


## Internal-only push device subscription registry preflight — not active push

A new migration `2026_11_13_000004_create_notification_push_subscriptions_v1.php` and `App\\Events\\PushDeviceSubscriptionRegistry` provide **internal-only** server-side subscription staging. There is deliberately **no browser route, no registration UI, no Service Worker, no VAPID sender, and no outbound request**. Device registration remains gated by the earlier signed-release and physical-device requirements.

Security invariants implemented and tested:
- Each row belongs to an existing `identity_accounts` account and `identity_devices` device, with canonical **account → device** transactional lock order.
- Revoked devices or inactive accounts cannot be registered/re-enabled or marked delivery-eligible.
- Push endpoint, P-256 ECDH browser key and auth secret are stored together as Laravel authenticated-encrypted ciphertext; the only indexed endpoint data is its SHA-256 hash. Stored ciphertext is checked before declaring eligibility.
- Registrations replace existing device secrets atomically with monotonic generation numbers; disabling is idempotent. An endpoint cannot be reassigned to another device/account.
- Strict allowlist of known HTTPS Web Push provider hosts (no internal IP, HTTP, arbitrary port, userinfo, fragment or extra fields); this is defense-in-depth only, **not** approval to make outbound requests. A future sender MUST separately enforce egress restrictions and DNS/IP validation.
- PHPUnit tests cover encryption at rest, tampering, revoked-device fence, endpoint uniqueness across accounts, invalid/SSRF addresses, and absence of `/notifications/v1/push-subscriptions` routes.

The registry is a **staging data model**, not a proof of actual push capability, user consent, browser permission, trust in the worker, or notification delivery. It must not be used until explicit signed Service Worker approval and E2E/mobile acceptance. Most recent code HEAD for this addition before documentation: `b65226ee54a48b6e0cb637363505dc987f0df602`; CI status checked separately.


## 13 November CI blockers and registry retry/purge hardening

### Verified CI failures — NOT an accepted PR

- Draft #296 code SHA `b65226ee54a48b6e0cb637363505dc987f0df602`, isolated PostgreSQL/Garage run [43485865252](https://github.com/1troitsky/photobunker-v3/actions/runs/43485865252): **84/86 Chromium PASS, 2 FAIL**. `p1-assignment-media.spec.ts` hit a 240 s test timeout; `p2-browser-contributor-photo-submission.spec.ts` did not find `assignment-media-submission`. Both are outside new push registry files. Root causes NOT established; traces must be reviewed by their owners. Foundation, security and UX passed on this SHA.
- Documentation SHA `21779343e6dd9945faa9808ff2ca630137f4a749`, storage run [43485985994](https://github.com/1troitsky/photobunker-v3/actions/runs/43485985994): **84/86 PASS, 2 FAIL**, different tests: `p2-browser-camera-gps-consent-race.spec.ts` did not find generated assignment code and `p2-browser-multi-import.spec.ts` did not find the folder. No foreign tests edited to suppress failures.
- Later code SHA `bb63ca52405ebceb676b483a89f8e20497cae43a`: Foundation workflow [43488700563](https://github.com/1troitsky/photobunker-v3/actions/runs/43488700563) PHP 8.4/8.5 **FAIL before PHP tests** at `composer audit --locked`: newly published Laravel advisory `CVE-2026-128083` / `GHSA-63hm-g96r-2m2q`, affecting Laravel 13 below 13.40.0; severity **low** per Composer but enforced security floor blocks CI. Frontend passed. Dedicated [Issue #297](https://github.com/1troitsky/photobunker-v3/issues/297) created; **do not bypass audit, silently upgrade Laravel inside #198, or claim PHP acceptance**.

### Internal-only registry improvements awaiting full CI

On `bb63ca52405ebceb676b483a89f8e20497cae43a`, the internal registry now treats exact active subscription re-registration as a Lost-ACK replay: it keeps generation and the original encrypted ciphertext. Actual endpoint or credentials change advances generation. New `purgeRevoked(accountId,deviceId)` deletes retained encrypted push credentials only after the verified account's device has `revoked_at`, using account→device transactional lock order; it cannot purge active or foreign devices. **The future identity lifecycle has NOT been wired to invoke this method**. It does not enable remote sending, Service Worker, browser permission, VAPID, or any public registration route. New feature tests cover exact retry, rotation, revocation-only purge, tampered ciphertext and cross-account rejection.

Full #198 stays IN PROGRESS. Never merge or change main without the owner's explicit approval.
