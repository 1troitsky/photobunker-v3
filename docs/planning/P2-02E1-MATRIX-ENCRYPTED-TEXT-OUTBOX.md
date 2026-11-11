# P2-02E1 · Matrix encrypted text outbox: durable intent → verified ciphertext ACK

**Date:** 2026-11-11. **Base:** P2-02D3 [Draft #73](https://github.com/1troitsky/photobunker-v3/pull/73) at `d4d9bc9316a32ee284dbfcdbf8931da315e1ad49`. This is a **new Draft** stacked PR, NOT a merge to `main`.

## Scope and non-negotiable boundaries

- `enqueueMatrixText(confirmedContact, roomId, text, independentlyApprovedMatrixEd25519)` is **Local-First**. It checks the current PB3 Contact safety fingerprint, locally sealed PB3 account/device↔Matrix binding and locally pinned PB3↔MXID identity card. It stores a fresh **stable Matrix txnId** and the complete intent in **AES-256-GCM** IndexedDB under an **HKDF(AKEK)** account+PB3-device-specific key. Only random IV, AEAD ciphertext and SHA256-hashed owner/operation indices appear in IndexedDB; not room ID, MXID, PB3 IDs, fingerprint, body, Matrix token or Recovery Key.
- User-visible result is **queued**, not sent/delivered/read. The returned transaction UUID is not a server ACK. Offline queuing is allowed because a sealed existing device/Contact mapping is available locally without a Matrix token/network call. The code does **not** auto-run background Matrix, await Matrix in PB3 Shell, or enable the Messages Send button.
- `flushMatrixTextOutbox(client)` must be called only by a future deliberately established Matrix session; it is **not wired to Messages UI or application startup**. On each entry it revalidates the *online* current PB3 account/device+server-confirmed Matrix credentials, synced Matrix client identity, active RustCrypto, strict `OnlySignedDevicesIsolationMode`, verified cross-signed Matrix recipient device with an independently confirmed Ed25519 fingerprint, unchanged PB3 Contact safety number, and actual Matrix joined room membership from `/rooms/{id}/joined_members`.
- This first vertical is **strictly two-member DM only**. The local room must be `m.megolm.v1.aes-sha2` encrypted and self membership `join`; server must return **exactly** two joined members with the expected MXIDs; local `join` or `invite` for an unapproved additional recipient denies sending. Team/group room send requires a **different role/membership proof** and is not automatically enabled here.
- The official `matrix-js-sdk@44.0.0` encrypts `sendMessage()`. The transaction UUID is reused on every retry after network failure or lost ACK, **never silently regenerated**. The Matrix server's idempotent txn semantics were previously verified with real Synapse in #70.
- SDK `sendMessage` ACK is not sufficient. The browser independently `fetchRoomEvent` on that ID and verifies a valid `m.room.encrypted` Megolm event with the original event ID, expected room and expected sender; explicit clear `m.room.message`, unexpected algorithm, plaintext `body`/msgtype or remote ID mismatch are rejected. Only then is a **sealed `server_accepted`** receipt committed by optimistic ciphertext CAS inside IndexedDB. It is **NOT a recipient delivery/read receipt**.
- A lost ACK, failed ciphertext check, changed identity, changed room members, offline state, server outage, unsigned device or incomplete save leaves the encrypted queued record intact. Stop flushing after the first ambiguous failure: preserve intent order and prevent spurious later messages passing a changed security gate.
- A later reader must decrypt the same account/device-scoped sealed record. Account switching sees no other account's text. No unencrypted preview, Matrix media upload, Team delegation or automatic retry exists. The PB3 Recovery Key is not exported to Matrix.

## What still blocks actual production Messenger

1. Owner-approved, production Matrix account/device provisioning with **PB3 Recovery Key only**, including a real Matrix homeserver and device enrollment (P2-02A/B/D real integration). There is no second user-facing independent password.
2. Owner-approved UX for independently verifying the peer Matrix Ed25519/cross-signing identity through SAS/QR (the current P2-02D3 inspection is read-only). A caller passing an arbitrary fingerprint without actual human verification is not authoritative.
3. Production two-account, two-device E2EE room lifecycle (create/invite/accept/leave/deny/revoke) and PB3 Contact ACL tied to Matrix membership. Server joined member check helps, but cannot independently prevent a rejoin race or a malicious homeserver.
4. A wire-level **real room send from this PB3 outbox**, including encrypted record round-trip with offline/reload and ACK loss, user-facing status sync, account rotation, owner changes, unread, receipts, edit/delete/reply and encrypted attachments. Old #70 Synapse idempotency test doesn't alone prove this new browser queue.
5. Cross-tab CAS race and storage quota/outbox capacity, key rotation/migration and confirmed remote recipient delivery/read. Chromium desktop CI does not replace iOS Safari PWA or physical two-device QA.

## Tests

- Vitest fake-indexeddb + actual WebCrypto: ciphertext only on disk, locally-confirmed offline queue, account isolation, durable reload via distinct IDB connection, stable txnId across simulated lost ACK, already accepted entry not resent, remote ciphertext proof, plaintext/invalid ACK refusal, wrong encryption, unexpected third member, missing binding, changed P1 fingerprint and unsigned recipient.
- Regression CI must pass on **exact HEAD**: PHP 8.4/8.5, TypeScript/build, Vitest, Security, real PG18/Garage/Chromium, disposable Synapse RustCrypto E2EE+cross-signing/4S historical decrypt.

**Safety:** `server_accepted` ≠ delivered/read; UI Send stays disabled. No main merge, deploy, production server or local agent.
