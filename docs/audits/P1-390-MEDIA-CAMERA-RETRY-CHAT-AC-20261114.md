# P1 #390 — MediaFile Camera retry without Browser

**2026-11-14 · CHAT-AC · QA stage:** implementation proposed, CI NOT TESTED until a real exact-HEAD Actions result.  
**Accepted immutable base:** `main@8ed66c438d090efd218efa80b027f0b2f854db4b`  
**Issue:** [#390](https://github.com/1troitsky/photobunker-v3/issues/390)  
**Branch:** `p1/390-media-camera-retry-chat-ac-20261114` · Draft PR pending at initial write.

## Original source-derived defect

The accepted `media-outbox.ts` deliberately persists HTTP 503 as `state=retry`, but its `flushMediaOutbox()` loops only once and has no timer. Its `attachMediaOutboxLifecycle()` registers online/visibility listeners only when `MediaImportPanel.vue` is mounted; the Camera writes MediaFile chunks directly without mounting it. The global `main.ts` mounts photo/grant/assignment background lifecycle but not MediaFile. Therefore a Camera user staying on the same visible route after a transient 503 can remain stuck until a future visibility/online/manual sync event. This is a **source-derived risk**; real P1 QA must reproduce the runtime behavior before claiming a complete fix.

## Scope / source edits

1. NEW `apps/web/src/features/media/application/media-retry-coordinator.ts` — one app-wide session-scoped coordinator. On attach/login, online/visibility and bounded timer, read only authenticated account local rows; flush only queued/retry entries with existing signed MediaFile implementation; exponential retry delays 5–120 seconds, idle check 15 seconds; one scheduled timer; no forced reauthentication, no service worker or OS background promise. Abort further attempts on revoked/locked/offline session.
2. NEW `apps/web/src/features/media/application/media-retry-coordinator.test.ts` — bounded delay, retry without browser events, no network on offline/locked device, disposer behavior.
3. MODIFIED `apps/web/src/main.ts` — global lifecycle registration independent of Camera/Browser route, no change to Identity/CaptureView/MediaImportPanel.
4. NEW `tests/e2e/p1-media-camera-autoretry-390.spec.ts` — actual /camera + real key-only registration, IndexedDB AES-GCM offline WAV, original Garage PUT sent to actual backend but first HTTP ACK withheld via transport-only 503, preserve retry state, then no manual sync/navigation/online/visibility event; verify automatic signed finalize, SHA-256 and independent AES-GCM cloud readback on same user/device.
5. THIS QA evidence file.

## Security and non-claims

- No plaintext media, filename, GPS or key logging; crypto/ACL/upload protocol, lease response classification, StorageManager and server records unchanged.
- Existing `MediaImportPanel` can retain its lifecycle; `flushMediaOutbox` is already an in-module singleton, so concurrent callers share one pending operation.
- A revoked/locked/offline session is not artificially promoted online; account switching is checked at each step by the existing outbox.
- In-app timer **cannot deliver while an OS has suspended/evicted the PWA**, and a browser's `navigator.onLine` is not proof that Garage is reachable.
- Native iOS Safari, Android PWA, OS memory eviction, persistent timer after tab termination, genuine hardware microphone/camera, real host process SIGKILL, whole-app P1–P4 gate: **NOT TESTED**.
- Historical #200/#272 65MiB and lost ACK plus #202 server durability remain separate; this child tests only missing automatic client reattempt.

## Verification matrix (update from real actions only)

| Check | Status |
| --- | --- |
| TypeScript / Vite production build | NOT TESTED |
| Unit/Vitest including coordinator | NOT TESTED |
| PHP8.4/8.5 / Composer security audit | NOT TESTED |
| Security workflow | NOT TESTED |
| UX workflow | NOT TESTED |
| PostgreSQL18/Garage/Chromium existing suites | NOT TESTED |
| New actual Camera 503 → automatic retry → signed Garage readback | NOT TESTED |
| Real Safari/iOS and Android physical device | NOT TESTED |

**Important:** do not mark Issue #390 review or claim full PASS until exact frozen PR HEAD actions actually complete, failing job traces are reviewed and independent scope is documented. Never merge without owner authorization.
