# P2-02B — pinned Matrix RustCrypto bootstrap

**Date:** 2026-11-11. **Parent:** Draft #68 (P2-02A signed Matrix account/device proof). **Status:** implementation candidate, NOT production messenger.

## What is implemented

- Official `matrix-js-sdk@44.0.0` with exact pnpm lockfile; no legacy `initCrypto` or custom Megolm/Olm implementation.
- The app **does not start the SDK on Shell load**. `startMatrixCrypto()` must be explicitly invoked by a future fully verified Messaging path; the current Messages 1.1 draft UI still has disabled Send, attachment and delivery controls.
- Before crypto initialization: require live PB3 key-only session, read confirmed device-bound credentials from the AKEK-encrypted P2-02A vault, re-check the server's signed binding through `/matrix/v1/me`, then verify the actual remote Matrix `whoami()` user ID and device ID. A mismatched or unconfigured server/device fails closed.
- Strict browser `navigator.locks` **exclusive**, `ifAvailable:true` owner lease for a SHA-256 account/device/homeserver/MXID scoped crypto database. If Web Locks is unavailable or a second tab is using the database, startup is denied. No localStorage flag or unsafe time-based election.
- Initialize Rust Crypto using IndexedDB with explicit **32-byte `storageKey` derived by HKDF from the PB3 AKEK**, scoped to this account/device/Matrix identity; no empty, default plaintext crypto store. Zero the JS view of derived key material after initialization. Name the store with a digest (not account ID).
- `stopMatrixCrypto()` and the reactive PB3 identity-change guard stop the SDK before releasing the ownership lock. On an SDK shutdown exception, fail closed by **retaining** the lock, not by allowing a second writer.
- No Matrix chat client is exposed to Vue components, no `startClient()`, no real room sync, no sending, no key sharing or account-data writes made by product code. Only a `crypto_initialized_only` state is exposed; this is **not ready-to-send**.

## Important unverified/dependent steps

1. **No production Matrix login provisioning** yet. The P2-02A token vault stores a confirmed token from a real external auth process, but the single-Recovery-Key credential provisioning and Matrix key backup aren't implemented.
2. Before any send, implement and independently verify **Matrix cross-signing, verification of all recipient devices, key backup/restore, secure PB3 Recovery Key envelope**, E2EE room memberships, revocations and Matrix device logout/revoke. Do not assign trust from a PB3 contact name, account ID or team roster alone.
3. Implement two real PB3 accounts with independently verified Matrix device keys and **real ciphertext send, sync, decrypt, reload/offline/reconnect and recovery**. Confirm server only stores ciphertext; preserve Lost-ACK transaction IDs and room permission checks.
4. Web Locks availability and lifecycle need physical Safari/iOS/Android validation, including BFCache/pagehide, two real tabs, crash/restart, actual WASM IndexedDB shutdown and key-rotation eviction.
5. Deleting encrypted Matrix token **is not** Matrix logout. Panic, remote revoke, token rotation, device retirement and storage deletion remain OPEN.
6. Do not claim that a PB3-encrypted local Rust store equals Matrix server-side 4S/cross-signing/room-key backup.

## Evidence gate

- Pin lockfile and verify `pnpm install --frozen-lockfile`, TS/build, unit tests (Web Lock conflict, identity checks, no plaintext store) and full existing real PG18/Garage/Chromium suite on the **same exact SHA**.
- A passing mocked SDK unit test is not evidence of successful Matrix real-transport E2EE; keep this milestone explicitly separated from the final Messenger acceptance.

**Workflow:** Draft branch, no deploy, no main change, no local agent.
