# P1 #390 — MediaFile Camera retry without Browser

**2026-11-14 · CHAT-AC · QA stage:** implementation proposed, CI NOT TESTED until a real exact-HEAD Actions result.  
**Accepted immutable base:** `main@8ed66c438d090efd218efa80b027f0b2f854db4b`  
**Issue:** [#390](https://github.com/1troitsky/photobunker-v3/issues/390)  
**Branch:** `p1/390-media-camera-retry-chat-ac-20261114` · Draft PR pending at initial write.

## Original source-derived defect

The accepted `media-outbox.ts` deliberately persists HTTP 503 as `state=retry`, but its `flushMediaOutbox()` loops only once and has no timer. Its `attachMediaOutboxLifecycle()` registers online/visibility listeners only when `MediaImportPanel.vue` is mounted; the Camera writes MediaFile chunks directly without mounting it. The global `main.ts` mounts photo/grant/assignment background lifecycle but not MediaFile. Therefore a Camera user staying on the same visible route after a transient 503 can remain stuck until a future visibility/online/manual sync event. This is a **source-derived risk**; real P1 QA must reproduce the runtime behavior before claiming a complete fix.

## Scope / source edits

1. NEW `apps/web/src/features/media/application/media-retry-coordinator.ts` — one app-wide session-scoped coordinator. On attach/login, online/visibility and bounded timer, read only authenticated account local rows **outside Browser-owned MediaImportPanel routes**; flush only queued/retry entries with existing signed MediaFile implementation; exponential retry delays 5–120 seconds, idle check 15 seconds; one scheduled timer; no forced reauthentication, no service worker or OS background promise. Abort further attempts on revoked/locked/offline session.
2. NEW `apps/web/src/features/media/application/media-retry-coordinator.test.ts` — bounded delay, retry without browser events, no network on offline/locked device, disposer behavior.
3. MODIFIED `apps/web/src/main.ts` — global lifecycle registration independent of Camera/Browser route, no change to Identity/CaptureView/MediaImportPanel.
4. NEW `tests/e2e/p1-media-camera-autoretry-390.spec.ts` — actual /camera + real key-only registration, IndexedDB AES-GCM offline WAV, original Garage PUT sent to actual backend but first HTTP ACK withheld via transport-only 503, preserve retry state, then no manual sync/navigation/online/visibility event; verify automatic signed finalize, SHA-256 and independent AES-GCM cloud readback on same user/device.
5. THIS QA evidence file.

## Security and non-claims

- No plaintext media, filename, GPS or key logging; crypto/ACL/upload protocol, lease response classification, StorageManager and server records unchanged.
- Existing `MediaImportPanel` retains **exclusive** MediaFile retry ownership on `/browser` and `/browser/*` routes; the global coordinator deliberately yields to it (essential for secure fault-boundary tests). Other routes, including Camera, have no such owner. The underlying `flushMediaOutbox` remains an in-module singleton.
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

## First exact-head CI failure and repair (2026-11-14)

Initial Draft #392 HEAD `7aa3c9c18a8a126cbce00d5061e56253201996b2`:

- [Foundation run 43604666142](https://github.com/1troitsky/photobunker-v3/actions/runs/43604666142) **PASS**: 554/554 Vitest, new coordinator 4/4, PHP8.4 and 8.5 249/249 tests / 3670 assertions each, TS/build and Composer audit0.
- [Security run 43604666107](https://github.com/1troitsky/photobunker-v3/actions/runs/43604666107) and [UX run 43604666138](https://github.com/1troitsky/photobunker-v3/actions/runs/43604666138) **PASS**.
- [Real PG18/Garage/Chromium run 43604666151](https://github.com/1troitsky/photobunker-v3/actions/runs/43604666151) **FAIL 92/94**. Its *new* Camera test was not among failures. Existing **unmodified** P1 fault-injection test expected exactly one corrupted PUT but a concurrent global retry raced the Playwright interception (`route.fulfill: Route is already handled`); old 65MiB signed lost-ACK E2E expected an observable persistent `retry` before deliberate reload but globally accelerated second flush reached `synced` prematurely. Original traces retained. Old tests were NOT changed/skipped and failures not called flaky.

**Minimal own-only fix:** updated ONLY new coordinator to yield when `window.location.pathname` is `/browser` or `/browser/*` (whose mounted MediaImportPanel already handles its own sync, including manual retry); added a new strict unit test that rejects any redundant Browser flush and requires it after returning to Camera. This prevents duplicate global P1 fault-boundary requests. No changes to core MediaFile, old tests, API or foreign CLAIMs. After this fix new exact-head CI must be checked; do **not** count the first SHA's 3 green workflows as final PASS.
