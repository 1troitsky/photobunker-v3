# PB3 P2 — #338 Notifications safe isolated integration (CHAT-R)
Date: 2026-11-14. Status: DRAFT / INTEGRATION QA PENDING.

Base: `main@8ed66c438d090efd218efa80b027f0b2f854db4b` (tree `7f2026e3818cae77712d23433475369606f901b0`).
Source read-only Draft [#296](https://github.com/1troitsky/photobunker-v3/pull/296), exact source HEAD `e49fbb29df9204778c55b092ed303da8fcc00b8b` (tree `7243c0b6b152623f8d1df3af1db6b80be964ec14`); original #198/#216 remain OPEN and source branch untouched.

## Byte-exact provenance
18 source paths retain their exact Git blob identity on the **patched** current main tree; the sole focused PushWakePayloadTest.php is adapted to the current strict EventEnvelope allowlist with **new negative tests that prove all four unintegrated source producer event types fail closed**; NO history replay of the diverged #296 source (189 ahead/27 behind), no source Composer.lock, global progress, runtime entrypoints or old security fixes. Only source-modified existing files are `apps/web/src/features/notifications/application/local-inbox.ts` and its focused test, within the allowed notifications subtree. All other source files are ADDED.

## Isolated, unactivated capabilities
- Tenant-account-row-serialized durable event ledger, bounded out-of-order admission and global per-account delivery sequence; source does NOT itself prove producer signing/ACL, so producers must remain protected.
- Server-side NotificationProjection maps minimal metadata and requires a CURRENT account-bound ACL callback for navigable targets; non-navigable security/retention kinds cannot expose target IDs.
- PushWakePayload is strictly identical opaque `{"v":1,"action":"check-inbox"}` regardless of event kind; internal PushDeviceSubscriptionRegistry encrypts provider endpoint+credentials and denies revoked/cross-account devices. No Web Push send, public endpoint, permission prompt or Service Worker.
- Three new schema-only notification migrations: event/stream/delivery, device ACK and internal encrypted subscription registry. Migration rollback deliberately throws to avoid silent loss of security notices.
- Browser Local-First encrypted inbox, deterministic sync after AES-GCM persistence, strict account/session fencing; standalone Notifications and Preferences Vue views with tests. Views are **not** mounted via App/router/Dock in this slice.

## Explicitly excluded: integration blockers
Original [PR #296](https://github.com/1troitsky/photobunker-v3/pull/296) also modifies common `App.vue`, `router.ts`, `main.ts`, `apps/api/routes/web.php`, `IdentityController`, `Team/Assignment/Media` producers, `MediaMaintain`, shared Dock/vite/E2E, and progress; these were intentionally **NOT** imported because other branches/claims and security compatibility must be reconciled separately. Original `NotificationEventsController` and its route-dependent tests were also excluded; no server HTTP /notifications/v1 route is active. Media-expiry source outbox migration is not imported without real MediaLifecycle/TTL owner signoff.
Therefore complete A/B server-signed event delivery, durable ACK HTTP, fresh ACL safe target navigation, offline-to-online/Revoked-Device cross-device replay, actual TTL worker, physical iOS/Android OS Push and permission transitions are **BLOCKED/NOT TESTED**, not PASS.

## Verification required (new EXACT head)
- GitHub Actions PHP8.4/8.5 PHPUnit and Composer audit, Vue/Vitest/TypeScript/build, Security/UX, real PostgreSQL18/Garage/Chromium existing suites. Do not claim positive status until runs complete; later record run URLs and precise HEAD in Issue #338 and journal #302.
- Negative coverage in source tests includes replay/conflict, unauthorized projection, invalid push wake, malformed/rotated/cross-account endpoint, encrypted local rows and identity switch; these alone do not certify live notification vertical or actual push.
- No production migration, deployment, merge or service activation authorized; an owner migration/data-retention plan remains necessary before merge.

Ref: [#338](https://github.com/1troitsky/photobunker-v3/issues/338) · [#337](https://github.com/1troitsky/photobunker-v3/issues/337) · [#198](https://github.com/1troitsky/photobunker-v3/issues/198)

## Exact-HEAD CI defect and narrowly scoped reconciliation (2026-11-14)

Initial commit `5f1b45591490e165a6891bf5a0d603edc770baa2` Foundation [run 43577394657](https://github.com/1troitsky/photobunker-v3/actions/runs/43577394657) PHP8.4+PHP8.5 each failed ONE test (`PushWakePayloadTest::test_every_event_type_has_exactly_the_same_non_sensitive_wake_body`) because imported source fixture references future `AssignmentInvitationCreated`/`TeamEpochInvitationCreated` not present in accepted main's strict `EventEnvelope::SUBJECTS`. The initial frontend passed, Security [43577394651](https://github.com/1troitsky/photobunker-v3/actions/runs/43577394651) and UX [43577394685](https://github.com/1troitsky/photobunker-v3/actions/runs/43577394685) passed. No tests were skipped or deleted. This commit changes ONLY the previously claimed focused test + this audit. Test still asserts opaque wake body across six presently authorized event types and independently asserts FOUR future source producer types are rejected (`events.invalid_envelope`). The shared EventEnvelope was NOT changed; full notification producer event support and routed E2E remain BLOCKED. New HEAD CI must pass separately before moving to review.
