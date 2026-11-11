# P2-02D2 — signed PB3 contact ↔ Matrix identity card (fail-closed)

**Date:** 2026-11-11. **Parent:** P2-02D1 [Draft #71](https://github.com/1troitsky/photobunker-v3/pull/71) @ `5fde4baa055771665b3f21d015fab2cbc5e40e53`. **Normative:** `AGENTS.md` + `ts.md §16`, P1-25 fingerprint-confirmed Contacts, P2-02A Matrix whoami/account+device binding. No automatic send or server-side contact directory.

## Trust design

1. The **owner** has a successful **PB3-owned and -device-signed** P2-02A Matrix binding, whose Matrix `whoami` was validated server-side. `exportOwnMatrixIdentityCard()` re-reads `/matrix/v1/me` for its own logged-in device and checks the literal server binding against locally sealed credentials. It verifies both original P2-02A P-256 signatures, then signs a compact `PB3MX1.` portable card with its **PB3 root account signing key**. The card contains public account/device SPKIs, the original signed PB3↔MXID/device contract and signatures — **no token, room key, AKEK, recovery seed or message body**.
2. A separately **fingerprint-confirmed PB3 Contact** must explicitly approve (a) the contact safety fingerprint and (b) the exact Matrix MXID shown from the card. `acceptMatrixIdentityCard(...expectedFingerprint,approvedMatrixUserId)` rejects offline/new trust operations, checks current verified Contact and fresh `pinnedPeer` key-directory evidence, verifies the root signature against the **pinned** account SPKI, verifies both nested account + PB3 device binding signatures, and checks the configured platform homeserver against the local authenticated `/matrix/v1/me` response. No manual Matrix URL is fetched.
3. Only after explicit approvals does the local client seal the complete card and approved fingerprint in a unique account+peer-scoped IndexedDB row under an **HKDF(AKEK) → AES-256-GCM** subkey with authenticated hashed indices. Neither peer ID, MXID, nickname, fingerprint nor device key is stored in plaintext as a database index.
4. Same-card retry is idempotent; a different signed card for the same peer **must not silently replace** an existing mapping. Peer re-binding or rotation needs an explicit future owner-approved recovery/transition contract. A changed PB3 Contact safety fingerprint prevents access. Local “forget” is **not** Matrix-device revocation or room removal.
5. Offline startup can retrieve an existing **signed PB3 identity mapping** for display, but the return type is deliberately `verification:'pb3-account-signed-only'`. There is **no** API to send messages or mark the remote Matrix device verified, even if the PB3 root has authenticated the MXID declaration.

## Non-goals and next security gates

- The P2-02A `whoami` endpoint verifies that the presenting **sender** owns a Matrix token/device at publication time. The receiver verifies cryptographic PB3 authorship but **cannot independently prove that token ownership is current** from a portable card. It must still independently validate actual live Matrix device Ed25519 keys + cross-signing and current membership, with trust-root freshness, before any message sending or media DEK grant.
- A PB3 root signature is **not Matrix device signature**, SAS verification, current membership, verified Matrix crypto ID, or cross-signing authority. This bridge **does not establish** safe end-to-end recipient verification on its own. Matrix `globalBlacklistUnverifiedDevices` should remain fail-closed until actual verified keys/room policy are proven.
- An authenticated PB3 reader cannot discover all contacts' Matrix MXIDs through a backend directory: disclosure is explicitly owner-controlled via a portable card and receiver consent. No readable contact/alias/MXID registry is created in Laravel.
- The current P2 Messages UI remains a disabled-send screen with encrypted local drafts. UX for presenting/verifying the card in Contacts/Messages and actual secure transport permission is a **separate required integration**, not faked here.
- This does not solve account key rotation, compromised same-origin JS, server replay/rollback, cross-device pin backup, independently verifiable Matrix key ownership, Matrix 4S restore or device revocation. Those remain OPEN.

## Tests and acceptance

Two real WebCrypto-generated PB3 P-256 account/device identities in Vitest; export nested signatures, explicit contact safety number and MXID agreement, AES-GCM encrypted account-scoped IndexedDB row, idempotent same card, rejecting forged card/device signature, altered MXID, unrelated homeserver, changed pinned fingerprint, offline confirmation, account isolation and tamper. Full PHP8.4/8.5, TS/build, Vitest, Security, Chromium/PG18/Garage and disposable actual Synapse/RustCrypto ciphertext gate must stay green on the exact PR SHA.

**Never declare Messenger or Matrix-recipient verification complete on this basis. No automatic merge/deploy or local agent.**
