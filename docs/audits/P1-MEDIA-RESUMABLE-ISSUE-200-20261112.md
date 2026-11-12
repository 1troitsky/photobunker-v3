# P1 #200 — encrypted resumable MediaFile: transient lease, lost HTTP ACK and large-file acceptance

**Date:** 2026-11-12. **State:** Product Draft / exact-head CI PENDING.  
**Issue:** [#200](https://github.com/1troitsky/photobunker-v3/issues/200); **base:** verified unified QA [#271](https://github.com/1troitsky/photobunker-v3/pull/271) HEAD `cbd9965dac1896bf4a62654503c281f2aa86ba34` (4/4 PASS, real Garage stop/restart + 77/77 Chromium), **NOT** `main`.  
**Lane:** `MediaV1Controller.php`, `media-outbox.ts`, `MediaV1Test.php`, `media-outbox.test.ts`, NEW `tests/e2e/p1-media-resumable-large.spec.ts`, this audit. No StorageManager/StorageRetryLedger, Billing/quotas, signed cursor, product UX, Camera, ACL, Matrix or concurrent branches altered.

## Root cause and minimal product correction

Original `MediaV1Controller::upload()` held a two-minute upload lease for an in-flight chunk. A second legitimate ciphertext PUT during a healthy lease returned `409 Conflict`. `media-outbox.ts::flushPass()` correctly treats **permanent** `409` (contract conflict) as an irreversible `conflict`, but cannot distinguish the transient lease from a forged/invalid envelope. A lost ACK, duplicate async PUT or browser restart could therefore permanently stop an otherwise valid encrypted outbox row, even while full ciphertext remained in IndexedDB.

- Server now returns **503 Service Unavailable with `Retry-After: 5` and no-store** only for the **fresh active upload lease**, leaving physical chunk/parent unacknowledged, signed ownership and same-account check intact. Stale 2-minute lease still allows a byte-identical PUT.
- Other permanent 403/409/410/413/422 remain fail-closed; no global blanket downgrade of 409 to retry, no bypass of quotas or TTL, no receipt invention, no lost ciphertext, no reduced assertions. The server never returns a false verified ACK.
- Client preserves the *existing* encrypted IndexedDB row on 503/429/transport error and fences the exact activeSession **after** every async encrypted PUT and after signed finalize before persisting `synced`; a switched/revoked account cannot proceed with a stale chain of sends. A narrow pure classifier and real offline ciphertext test lock in retry vs permanent failure semantics.

## Tests / exact gates

1. **PHP8.4/8.5:** live uploading lease → HTTP 503 (Retry-After) with no false server ACK; after stale 3-minute lease same signed ciphertext succeeds and repeated PUT/finalize are idempotent.
2. Truncated ciphertext even if request announces full Content-Length → 503, chunk pending, finalize conflict; original exact AES-GCM bytes subsequently accepted, SHA-256 header and signed receipt verified.
3. Signed out-of-order metadata/data chunk PUT; repeat after lost HTTP ACK, finalize exactly once and no duplicated S3 location.
4. **Vitest:** 503/502/429/network error remain `retry`; permanent revoked/expired/bad-contract 403/409/410/413/422 remain `conflict`.
5. **Real Chromium P1 large-file E2E:** generate 65 MiB+17 bytes entirely in browser, AES-GCM encrypt into 66 × 1 MiB data + one private metadata chunk while **offline**, persist ciphertext to IndexedDB (no filename in signed manifest). Online, intercept exactly the first client response **after** `route.fetch()` forwards a real full-byte PUT and receives 200 from actual Garage; deliver 503 only to the PWA (synthetic lost ACK, **not mocked server upload**). Assert outbox `retry`, parent remains pending without receipt, reload, reauthenticate, retry actual signed PUTs, finalize with real receipt and SHA-256, decrypted precise bytes in original browser **and a second independent Recovery Key device**. No OS gallery or public filenames/metadata.
6. Entire repo PHP8.4/8.5, TS/Vitest/build, security/UX guard, **real PG18/Garage** and unmodified full Chromium E2E including all older GPS/Assignment/Media negative tests. Do not change CI allowlists, assert lengths, skip, retries or policy in order to pass.

## Boundaries and deferred acceptance

- Physical network radio interruption, abrupt kill mid-TCP ACK and mobile Safari/Android PWA device storage eviction are **NOT TESTED**. A deterministic response-drop test proves correct ACK-loss handling but not carrier/tower behavior.
- This issue does **not** replace P3 signed five-plan quotas [#192](https://github.com/1troitsky/photobunker-v3/issues/192): GB/GiB remains OPEN and **no paid byte ceiling is invented**. Current Free file/byte/TTL limits remain enforced by backend. Paid plans, larger-than-128 MiB media, native camera MediaRecorder codecs and secondary/BYO S3 remain separate gates.
- `main`, pre-main #265/#269/#271 and source #266/#267 are untouched. Review/open is not integrated, release-ready or production-accepted.
