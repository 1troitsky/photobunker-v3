# P2-02E2 — disposable real PB3 outbox → Synapse → recipient-decrypt gate

**Date:** 2026-11-11. **Parent:** [Draft #74](https://github.com/1troitsky/photobunker-v3/pull/74) @ `2b1c66740064a1e28c46f3ca013014ee2eddd028`. All changes are on an isolated Draft branch. No merge/deploy.

## Why this gate exists

Prior CI was **two separate proofs**: (1) the real `matrix-text-outbox.ts` implementation running against mocked Matrix SDK/ACL callbacks under real browser WebCrypto/fake-indexeddb; (2) a separate disposable Synapse + official Matrix v44 RustCrypto E2EE protocol test. Neither by itself proves that the real PB3 outbox can call the official SDK, survive lost ACK, verify the raw ciphertext receipt, or cause the other SDK client to decrypt.

`apps/web/src/features/messages/application/matrix-outbox-synapse.test.ts` now runs the **actual** PB3 outbox code and the **actual** `matrix-js-sdk@44.0.0` RustCrypto against the existing localhost-only disposable Synapse v1.161.0 GitHub Actions server, with separately authenticated Alice and Bob.

## Exact verified behaviors (subject to live CI)

1. Actual PB3 WebCrypto AKEK derives the outbox AES-256-GCM key. The DB persists an encrypted queue intent including the UUID transaction, body, destination and room; plaintext and relevant IDs are absent from SQLite/IndexedDB raw row serialization. It can enqueue offline without touching Matrix.
2. Two independent Matrix clients log in with disposable credentials, initialize RustCrypto, publish their own cross-signing identity, synchronize and join a *real encrypted two-member private room*. The test uses the actual server `joined_members` and `roomState()` APIs via the PB3 outbox.
3. The test calls `flushMatrixTextOutbox(actualSdkClient)`, intercepting **only the post-acceptance return value** of the first SDK `sendMessage` call to simulate a genuinely lost ACK. The first attempt has already been accepted by Synapse and its event ID is known only inside the test, while PB3 still shows `queued`.
4. An explicit second flush must reuse the **same original PB3 UUID transaction ID** and converge to the original event ID on Synapse (server transaction idempotency) without a duplicate recipient event; PB3 must verify **the raw server-fetched event is `m.room.encrypted`** before writing encrypted `server_accepted` state.
5. Bob's independent RustCrypto client must receive and **decrypt the exact synthetic sent text**. A third flush must not re-send a committed receipt. No user plaintext, Matrix access token, PB3 Recovery Key, room secret or raw event appears in CI logs.
6. The preceding #74 negative tests still enforce revoked PB3 server binding, Matrix-device signing/isolation, no exclusive crypto lease, changed PB3 safety number, third-party join/invite, open join rules, remote plaintext and forged ACK refusal.

## Precise limitations

- In this **transport-focused harness**, the *PB3* Identity/Contacts/Matrix Binding server and `inspectVerifiedMatrixDevice`/exclusive PB3 SDK Web Lock are stubbed, while the PB3 **queue implementation, HKDF/AES-GCM, IndexedDB and the full Matrix SDK/client+Synapse are real**. Cross-signing on the Matrix test accounts is real, but there is **not yet a real out-of-band cross-user SAS/QR ceremony and PB3 server-issued device/Contact proof in a single session**. Passing this test does **not** establish that last link.
- The intended browser experience is not exercised because the approved Messages UI still has Send disabled. Actual reload of the PWA module and installed iOS Safari are still separate. This test verifies the queue row is durable in IndexedDB across connection reuse but does not simulate terminating/reloading the entire application runtime.
- Disposable Matrix CI intentionally uses HTTP **127.0.0.1** only on a loopback port for isolation; PB3 **production** Matrix origin validation remains HTTPS + configured host + PB3 server whoami check. No production credentials are used.
- No media/attachment, independent PB3 account provisioning from the Recovery Key, reader-receipt, group membership, Panic credential revocation, secondary homeserver or physical device tests are claimed. No production Send switch is enabled.
- The test is guarded by `MATRIX_CI_DISPOSABLE=1` and verifies exact localhost URL, server name and two non-identical synthetic passwords before opening a connection. Ordinary Vitest collects it but **skips it** when there is no disposable Synapse. The CI server is destroyed afterward.

## Acceptance and next step

Full exact-SHA CI must include Foundation (PHP8.4/8.5, Vitest, TS/build), Security, PG18/Garage/Chromium, Synapse original E2EE+4S recovery and this **new** real-outbox wire test. A failing test is evidence of an integration problem; do not downscope crypto or claim success.

Next engineering work after PASS: verify actual PWA runtime reload and PB3-issued Contact→Matrix trust/room creation, and run independent audit of the long Draft PR chain before considering any ordered merge. No change to `main` without owner approval.
