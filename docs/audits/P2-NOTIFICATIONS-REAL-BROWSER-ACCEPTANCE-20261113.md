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


## Device-local quiet hours — separate acceptance checkpoint (2026-11-13)

- **Code SHA:** `dad6f1f7a2d92c1f5d33bef00c565c8fdaaf76ea`, no change to Service Worker, backend push, composer files, main or other agent branches.
- Encrypted local `NotificationPreferences` has schema v2 with strict `quietEnabled`, `quietStart` and `quietEnd` minute fields. Valid old authenticated-encrypted v1 preferences migrate in memory to v2 defaults; saved category choices are preserved. Malformed v1/v2 shapes or invalid time ranges fail closed.
- Quiet hours suppress **only ordinary local unread indicator dots**, never event feed ingestion, read flags, target ACL, server ACK, UI rows, security notice visibility, security indicator dots or OS push. Device local time, including midnight wrapping, is used; UI refreshes on focus and once a minute. The OS push toggle remains disabled.
- Security regression coverage: overlapping / overnight clock boundaries, 22:00 start inclusive and 08:00 end exclusive, mandatory security dot even if badges disabled, strict invalid minute bounds, encrypted v1 migration and mounted settings save. This is NOT a claim of actual push DND.
- On this exact SHA: Foundation **frontend** `43491498753` PASS (Vitest **487/487**, 86 test files, TS/build PASS), Security `43491498614` PASS, UX `43491498589` PASS. Laravel PHP 8.4/8.5 Foundation **FAIL pre-test at Composer Audit** on unrelated known CVE-2026-128083 / Issue #297, the other agent's scope. PostgreSQL/Garage/Chromium run `43491498644` was **IN PROGRESS** at this documentation checkpoint; do not promote to real-browser accepted without final job result.


## Quiet-hours browser-acceptance extension and UX save-state guard

- Code SHA `00815b6fb9aa23f8ef5ee7894fde71643703ee83`: extends the **real Chromium** `p2-settings-notifications.spec.ts` flow (real Key-Only registration and server AccountCreated) to enable overnight quiet hours 22:00–08:00, persist, reload, and assert AES-GCM IndexedDB ciphertext does not contain the toggle keys or local schedule. The pre-existing real server security notice stays rendered and its unread dot stays visible even while generic badges are disabled. It is not real mobile OS push/DND acceptance.
- A settings UI correction ensures changing quiet-hour enabled state clears a stale “Сохранено” indication; a mounted Vue regression test covers it.
- Prior isolated code SHA `dad6f1f7` had 487/487 Vitest PASS and Security/UX PASS, but PHP 8.4/8.5 still FAIL at the separately claimed Laravel CVE #297, and its PG/Garage job was in progress when last checked. **The new E2E source must not be marked PASS until exact-head Chromium CI finishes.**
- #297 is being handled in a separate [Draft PR #298](https://github.com/1troitsky/photobunker-v3/pull/298); #230 Signed PWA in [Draft PR #299](https://github.com/1troitsky/photobunker-v3/pull/299). No composer/Service Worker files, foreign branches or main touched in #296.

## Quiet-hours account-switch race regression (2026-11-13)

- **Exact code SHA**: `39ec639a12f11742d9607fc55a53bae322ddcc31`. Mounted Vue regression simulates an asynchronous encrypted preferences save followed by an identity switch; an old device/account's save acknowledgement cannot appear in the new account and cannot overwrite its local draft. Existing validation of encrypted v1→v2 preferences, midnight quiet-hours and mandatory security visibility remains.
- **Verified Foundation frontend**: [GitHub Actions run 43493490994](https://github.com/1troitsky/photobunker-v3/actions/runs/43493490994): **489/489 Vitest PASS (86 files), TypeScript and Vite build PASS**. Security [43493492709](https://github.com/1troitsky/photobunker-v3/actions/runs/43493492709) PASS, UX [43493490813](https://github.com/1troitsky/photobunker-v3/actions/runs/43493490813) PASS.
- PHP 8.4 and PHP 8.5 Foundation jobs both **FAIL before PHPUnit** because this branch still locks Laravel 13.39.0, which Composer Audit rejects for `CVE-2026-128083`. Independent agent owns [Issue #297 / Draft #298](https://github.com/1troitsky/photobunker-v3/pull/298); no changes to that lockfile in this branch.
- Isolated PostgreSQL18/Garage2.5/Chromium on this **exact code SHA**: [run 43493490811](https://github.com/1troitsky/photobunker-v3/actions/runs/43493490811), **IN PROGRESS** at this checkpoint. An E2E source addition is not itself proof of passed browser execution. Existing A→B browser acceptance on the earlier code remains historically valid but must not be promoted to this head.
- Separate Signed PWA #230 agent owns [Draft #299](https://github.com/1troitsky/photobunker-v3/pull/299). No Service Worker activation, real push transport, verified backup producer or physical iOS/Android acceptance is included.

## Exact-head Chromium failure and security-dot assertion correction

- Code `00815b6fb9aa23f8ef5ee7894fde71643703ee83`: [PG18/Garage Chromium run 43492530388](https://github.com/1troitsky/photobunker-v3/actions/runs/43492530388): **85/86 PASS, 1 FAIL** after 6.6m. `tests/e2e/p2-settings-notifications.spec.ts:203` incorrectly expected `.notification-dot.isread` count `1`. Actual `0` is **correct**: generic badges are off, but security notices and security unread dot stay prominent; the old assertion predated security exemption. One notice in encrypted local inbox was still observed, not lost.
- Docs-only SHA `3e9bbde5ce06e68eb2dcc93ee0e035fe17c7681e`: [run 43492658283](https://github.com/1troitsky/photobunker-v3/actions/runs/43492658283) replicated **85/86 PASS, same 1 FAIL**; not a distinct product defect.
- **Corrected test-only code SHA** `72cfc9cd0667556cf9fff76c6bf95e12260724b0`: assert exactly one visible unread indicator and **zero dimmed** indicators, reflecting mandatory security UI. No product, server delivery, authorization, read status or push transport changed for this fix. New exact-head PostgreSQL/Garage/Chromium CI must pass before claiming 86/86.
- Prior SHA `39ec639a` has real frontend **489/489 PASS**, Security and UX PASS. PHP jobs continue to FAIL Composer Audit due Laravel 13.39.0 security advisory independently claimed in #297 / Draft #298. Never suppress Composer audit or change main in this PR.

## Device switch during two concurrent encrypted settings saves — follow-up

- Exact code SHA `e5361097faacbbf957684eb5e2fc940a8e4727f6`: the Settings view now releases a pending **previous account** save spinner immediately on identity change so that the new account can edit and persist its own encrypted preferences. The old promise's `finally` is fenced by both the original identity-scope and initialization token; it cannot re-enable controls during a new account's still-pending save. Existing stale-success guard remains.
- Mounted Vue regression creates **two deferred saves across an account switch**, resolves the old account's write first, proves the second account remains locked until its *own* save resolves, and checks that success appears only for the new account. No backend authentication, server ACK, privacy data or PWA worker changed.
- Security-dot E2E assertion from exact `72cfc9cd` remains correct (security dot visible). Exact-head CI for the new code SHA was **queued/running** at report time, not accepted. Previous Chromium `85/86` is explicit historical evidence only. PHP Composer Audit CVE remediation belongs to #297 / PR #298. #230 Signed PWA remains PR #299.

## Corrected security-dot E2E accepted, independent account-switch hardening

- Exact corrected code SHA `72cfc9cd0667556cf9fff76c6bf95e12260724b0`: isolated PostgreSQL 18/Garage 2.5 [run 43494010214](https://github.com/1troitsky/photobunker-v3/actions/runs/43494010214), job `132122229681`: **86/86 real Chromium PASS (4.6m)**. This validates the corrected mandatory security unread dot in the real encrypted quiet-hours browser scenario, including real Key-Only auth, reload and AES-GCM storage readback. Security [43494010231](https://github.com/1troitsky/photobunker-v3/actions/runs/43494010231) PASS, UX [43494010222](https://github.com/1troitsky/photobunker-v3/actions/runs/43494010222) PASS. PHP Foundation remains FAIL exclusively at Composer audit on separate CVE #297, not an accepted full 4/4 gate.
- Later code SHA `e5361097faacbbf957684eb5e2fc940a8e4727f6` fixes concurrent old/new-account encrypted preferences saves, with mounted Vue race test. Exact SHA Foundation/frontend [43494717800](https://github.com/1troitsky/photobunker-v3/actions/runs/43494717800): **490/490 Vitest PASS (86 files), TypeScript/Vite build PASS**. Security `43494718093` PASS, UX `43494717677` PASS. PHP8.4/8.5 FAIL pre-test Composer Audit; PG18/Garage/Chromium `43494717824` **IN PROGRESS** at reporting time. Thus browser acceptance 86/86 belongs precisely to `72cfc9cd`, NOT yet to `e5361097`.


## DeviceRevoked → encrypted push subscription removal (2026-11-14)

- **Prior branch code SHA:** `f4714548e3838720f885b8f936f64f3fc8ee98f3`. PostgreSQL18/Garage2.5/real Chromium [run 43495124550](https://github.com/1troitsky/photobunker-v3/actions/runs/43495124550): **86/86 PASS (5.7m)**, Security/UX PASS. Do not confuse that result with subsequent server code.
- **New implementation code SHA:** `90487aa6802e626e9bfeb20e801ce25b5e83df65`. `IdentityController::revoke` now calls the existing `PushDeviceSubscriptionRegistry::purgeRevoked` in the same DB transaction as durable device revocation and generic `DeviceRevoked` event admission. The registry verifies revoked state and owner first. Credentials and hashed endpoint indexes for the affected device are removed; other tenants/devices stay intact. No push sender, browser subscription registration, VAPID, Service Worker, user-visible new action or main merge is introduced.
- `DeviceRevokedNotificationTest` now exercises the **real authenticated HTTP revoke route** with three real encrypted subscription entries, proves only revoked device credentials are erased, and separately covers cross-tenant/invalid-Origin attempts, self-revoke, and event-stream revision-collision path. This test code has been added but **PHPUnit has NOT RUN on this SHA**.
- **Exact-code CI:** Security [43502465333](https://github.com/1troitsky/photobunker-v3/actions/runs/43502465333) PASS, UX [43502465316](https://github.com/1troitsky/photobunker-v3/actions/runs/43502465316) PASS; Foundation frontend [43502465160](https://github.com/1troitsky/photobunker-v3/actions/runs/43502465160) 490/490 Vitest PASS /86 files and Vite build PASS. Foundation PHP8.4/8.5 **FAIL before PHP tests** because current branch locks the vulnerable Laravel dependency (CVE-2026-128083). Remediation is separately staged in #297 / Draft PR #298, not silently copied into #198. Real PG18/Garage/Chromium [43502465163](https://github.com/1troitsky/photobunker-v3/actions/runs/43502465163) **IN PROGRESS** at this checkpoint.
- Next acceptance gate: PHP8.4/8.5 feature suite after an authorized dependency reconciliation, plus exact final branch E2E and independent review. The registry does **not** itself deliver push, and the full #198 remains `in-progress`.
