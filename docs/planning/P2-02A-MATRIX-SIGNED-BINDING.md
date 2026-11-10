# P2-02A — signed PB3 ↔ Matrix account/device binding (not messaging)

**Date:** 2026-11-11. **Stack:** #64 → #66 → #67 → Draft #68.
**Normative:** `ts.md §16`, `AGENTS.md`; SDK reference: `matrix-js-sdk` Rust Crypto, not legacy `initCrypto`.
**P2-02A state:** actual signed account/device mapping + independently queried Matrix `whoami`, with account-encrypted local credential pending/confirmed store. This does not enable Matrix messages.

## Real proof and threat boundary

1. PB3 first authenticates an anonymous **key-only** account via its existing secure session. The Matrix server is selected **only by the platform operator** from `PB3_MATRIX_HOMESERVER_URL`. A user cannot submit a URL and trigger a server-side fetch (SSRF). The URL is rejected unless it is an HTTPS hostname without path, credentials, query, fragment, redirects, explicit non-default port or IP literal. When unset, the binding endpoint refuses operation.
2. The client creates a fixed-field canonical contract
   `{version:1,operationId,accountId,pb3DeviceId,homeserverUrl,matrixUserId,matrixDeviceId}`.
   It independently signs the *same bytes* with PB3 account P-256 key and current PB3 device P-256 key under domain `pb3.matrix-binding.v1\n`.
3. The backend requires current PB3 session, Origin/CSRF, exact schema, both signatures, and same authenticated account/device IDs. It uses the **transient** Matrix access token to call `GET /_matrix/client/v3/account/whoami` at the configured HTTPS homeserver and matches the **exact** MXID and Matrix device ID. Guest tokens, mismatches, unexpected redirects and failures deny binding.
4. Inside a DB transaction the immutable account↔MXID and device↔Matrix-device records are inserted under identity account row lock. Global unique `(homeserver,matrix_user_id)` blocks a different PB3 account claiming the same Matrix identity. Unique PB3 and Matrix device IDs prevent silent rebind. **The backend never stores Matrix access/refresh tokens, room keys or media plaintext.**
5. The browser first encrypts the complete pending proof and token in a device+account-scoped IndexedDB row using **HKDF(AKEK) → AES-256-GCM**, random nonce, authenticated scope and a hash-based key (no plaintext account ID or token indexes). Only then is `POST /matrix/v1/bindings` sent. A timeout or lost ACK leaves a recoverable pending record.
6. Retrying reuses **the identical operationId and both signatures** rather than creating a new binding. After server success the client independently reads `GET /matrix/v1/me` and compares the stored contract/signatures byte-for-byte, then durably transitions to `bound`. An ambiguous or mismatched response never becomes bound. Only `bound` local credentials can be provided to a future Matrix SDK, and only while PB3 session is online.
7. Local credential deletion **does not revoke** a Matrix token, remote Matrix device or PB3 server binding. It must never be labeled Panic, logout, revocation or account deletion.

## Explicitly not yet implemented

- Matrix homeserver deployment, authenticated Matrix login/provisioning, OAuth/MAS, BYO homeserver, multi-tab Rust Crypto arbitration, cross-signing, encrypted Matrix key backup and Recovery Key integration. `PB3_MATRIX_HOMESERVER_URL` has no default production value.
- No live Matrix SDK client is instantiated in this slice. The user does not see enabled send/attachments/receipts and cannot pretend local drafts reached another user. PB3 Contacts or Teams **never** grant Matrix room access or media DEKs.
- No peer Matrix identity directory until explicit signed, privacy-aware disclosure to verified PB3 contacts. Never trust a screen nickname or a backend-only MXID as a recipient identity.
- Remote Matrix token invalidation/revocation, logout/Panic/key rotation/retirement, multi-device recovery, and multi-tab conflict quarantine. Until these gates are real and tested, the bridge is **not production-authentication-ready**.
- There is deliberately no UI for typing a second Matrix password/token. The final user product must use the **single PB3 Recovery Key**, with server/operator-assisted Matrix provisioning and explicit account/device binding.

## Next vertical: P2-02B — verified RustCrypto connection

1. Choose and provision an isolated, reproducible **non-production** Matrix homeserver and key-only account provisioning/binding. Do not grant arbitrary MXIDs on user-supplied alias.
2. Pin a supported `matrix-js-sdk` release, lock its dependency graph and use `MatrixClient.initRustCrypto` + persistent encrypted crypto store. Enforce **single active owner per crypto store across tabs**; no initialization from shell startup.
3. Verify server `/whoami` and every device/peer cryptographic identity before E2EE room creation or sending. Store the client token only in the PB3 vault, never in localStorage, logs or an unencrypted SDK store.
4. Implement Matrix account key backup/cross-signing, delivery/outbox with durable transaction IDs and server ACK/sync dedupe, and permission-aware peer binding. Offline/retry/reload and device loss must be tested as actual workflows, with ciphertext evidence.
5. Only after two real PB3 accounts exchange and decrypt encrypted Matrix messages may `Отправить` be enabled. Matrix downtime must never block Key-Only Identity, Camera, Browser, Assignments or secure wipe.

## Acceptance evidence

Backend: PHP 8.4/8.5 signed binding, whoami fake transport, exact identity, replay, token absence from response/DB, guest/foreign-account collision, configuration/SSRF refusal, safe migration rollback.

Frontend: Vitest enforces AKEK-sealed pending token, durable lost-ACK replay, offline/foreign-account rejection. Existing P1/P2 Chromium and real PostgreSQL/Garage CI run for the **exact SHA**, with no reliance on unverified simulation of a Matrix server.

**NOT VERIFIED:** real Matrix E2EE send/sync, native Safari/iPhone/Android, production Matrix server, cross-device recovery; do not count P2 Messenger as finished.
