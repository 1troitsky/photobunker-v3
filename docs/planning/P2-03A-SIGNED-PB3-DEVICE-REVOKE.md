# PB3 P2-M03A · Signed PB3 device revocation barrier (NOT Matrix remote revoke)

**Date:** 2026-11-11. **Parent:** Draft [#79](https://github.com/1troitsky/photobunker-v3/pull/79) @ `95c1a3e7a9578d3c176f2cc4388705867680a259`; source: independent QA [#77](https://github.com/1troitsky/photobunker-v3/pull/77) M-03. This is a narrow follow-on Draft PR, no merge/deploy.

## Scope implemented

- Expose the previously **unrouted** `IdentityController::revoke()` through `POST /identity/v2/devices/{deviceId}/revoke`. This is an authenticated, CSRF-checked same-origin PB3 API, rate limited by the existing Identity group.
- **Replace** the previous cookie-only revocation handler with a signed `pb3.identity-device-revoke.v1\n{contract}` contract. Contract must be exact JSON fields `version=1,operationId,accountId,actorDeviceId,targetDeviceId,accountRevision`, with account-root and **current actor-device** ECDSA P-256 signatures. The target ID from the signed body must match URL; credentials cannot authorize revoking a foreign account.
- Under a database transaction lock the PB3 identity account, the current actor device and the target device, re-check exact revision/identity and account/device status. Mark `identity_devices.revoked_at` and preserve the historical Matrix signed binding rows. No Matrix token or decrypted message crosses into PHP.
- Another active PB3 device can safely repeat an already committed revocation (`unchanged:true`) after lost ACK. A **self-revoked** PB3 device becomes unauthorized and cannot replay using its now-revoked session: on uncertain ACK, the owner can verify via another enrolled device/Recovery Key. Never invent a successful write.
- `actor()` denies every future authenticated PB3 request from a revoked target, including `/identity/v2/me` and `/matrix/v1/me`. The Matrix outbox already fetches that authoritative PB3 binding on *every* send attempt. The existing Matrix SDK local token may remain valid independently, and already-shared keys cannot be recalled.
- The app can display the authenticated PB3 device list, request explicit confirmation, revoke a named device and show an accurate status. On self revoke, it tries to stop the RustCrypto SDK, clear the local encrypted Matrix credential and locks out PB3 locally. On any local cleanup failure the UI reports a **partial local-cleanup state**, not a remote wipe. No automatic background operation or disabled-app login introduced.
- Response uses explicit `matrixRemoteRevoked:false` and `matrixRevocationStatus:'not_performed'` (not `revoked`, `queued` or `delivered`).

## Explicitly NOT implemented — M-03 remains BLOCKED for remote Matrix token/Panic

PB3 intentionally **never saves Matrix access tokens server-side**. The backend cannot revoke an independently issued Matrix homeserver bearer token on a lost/offline target device merely by changing an identity row. Revoking PB3 access only prohibits **future PB3-authorized operations and PB3 outbox sends**. It does not guarantee that an already running Matrix SDK, third-party Matrix client, already distributed Megolm room key or homeserver room membership are revoked. Standard Matrix token deletion on another device may require independently authorized device management or UIA; it is not provided via a fake PB3 logout, raw token sharing or administrator impersonation.

The **next** M-03B gate is an approved homeserver authorization/revocation capability + owner-signed idempotent Matrix remote-device logout and room-key/participant removal, with real lost-device two-browser and disconnected-client negative tests. It must preserve PB3 Key-Only UX without requiring a second password. Panic/remote wipe belongs to the mandatory PB3 P3 security stage and remains **NOT IMPLEMENTED**. Don't turn the **Send** button on or claim remote Matrix wipe.

## Tests and acceptance

- PHP feature tests use genuine P1363 account-root + actor-device signatures (not mocks), verify owner-scoped target, URL/body binding, exact revision, Origin/CSRF, idempotent retry, forged/missing signatures, foreign accounts, self revoke and PB3 Matrix API denial using the **same revoked Laravel cookie**. Check no Matrix token is stored/deleted or represented as revoked.
- Vitest uses WebCrypto-generated PB3 signing keys and verifies both outgoing signatures. Validates truthful status, explicit target, session switch, offline refusal, device list parsing and self-revoke local cleanup partial failures.
- CI exact head: PHP8.4+8.5, Vitest, TypeScript/Vite build, Security, PG18/Garage/Chromium, two real disposable Synapse jobs. If CI tests fail, do not claim PASS.
- Independent audit #77 should replay actual PB3 revoke in two isolated browsers, confirm target's PB3 APIs 401 and separately confirm independent Matrix whoami **still works with existing token**; distinguish expected unresolved remote risk from a product-code bypass. Only then may mark this narrow PB3 revocation step verified. Native Safari, actual Matrix token remote revoke and Panic remain OPEN.

**Release:** no merge to `main`, no deployment, no live homeserver/admin changes, no claim of M-03 final closure.
