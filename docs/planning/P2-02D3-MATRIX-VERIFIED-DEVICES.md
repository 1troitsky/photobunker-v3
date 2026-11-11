# P2-02D3 — fail-closed Matrix cross-signing recipient gate

**Date:** 2026-11-11. **Parent:** [Draft #72](https://github.com/1troitsky/photobunker-v3/pull/72) @ `fdbaf8ee89453aff2043051c66b2fd74a7faa2e4`. Normative: `ts.md §16`, approved Messages 1.1 overlay, SDK pinned `matrix-js-sdk@44.0.0`.

## Scope of this slice

- The P2-02B Rust Crypto client explicitly sets the **official SDK `OnlySignedDevicesIsolationMode`** on initialization, before any future room key encryption. The SDK refuses to encrypt to recipient devices which are not cryptographically cross-signed by their owner; this is not a homegrown verification bypass or a local `setDeviceVerified` flag. The SDK also refuses decrypting events from unsigned devices in this mode.
- New `inspectVerifiedMatrixDevice(peerAccountId, independentlyApprovedEd25519, crypto)` is **read-only verification**, **not** a send/membership authorization API. It separately requires: active online PB3 key-only session, an existing fingerprint-confirmed encrypted PB3→Matrix mapping, matching current local Matrix account/device binding and platform homeserver, *independently approved* Matrix Ed25519 device fingerprint (provided out of band, not inferred from the card), published Matrix cross-signing keys, verified and unrotated Matrix user cross-signing identity, live SDK `getUserDeviceInfo([user],true)`, all returned recipient devices with Olm/Megolm and Ed25519+Curve25519 keys, and each device **signed by its owner and cross-signing verified**. A locally `setDeviceVerified`-marked device is not enough, even if its `isVerified()` returns true.
- If any single recipient device is unsigned, unknown, missing keys, fingerprint-changed, or identity changed/offline mid-await, the entire check refuses; it does not allow one signed device to mask an unsigned second device. The tool has no `setDeviceVerified`, `pinCurrentUserIdentity`, `crossSignDevice` or outgoing-message API.
- A passing check returns `capability:'inspection-only-no-send'`. It is **not** a persistent trust stamp and must be revalidated before each future send. No UX enables Send by consuming this function; P2-02B never starts sync automatically.
- Independent SDK verification requires current Matrix sync, room membership/ACL freshness, room E2EE status, crypto store trust and Matrix secret-storage/backup recovery: this is **not solved** by checking the current trusted device map. Future operational send should also handle arrival of an unsigned device during key sharing, stale server `/keys/query`, changing MXID/identity and pending revocation.
- The Matrix client stays lazy and isolated with Web Locks, HKDF(AKEK) encrypted RustCrypto IndexedDB, no Matrix auto-login or active Send.
- The PB3-signed contact card authenticates a declaration of MXID, **not** Matrix Ed25519 identity, verified Matrix cross-signing or current room membership. The independent Matrix Ed25519 fingerprint must be confirmed through a supported UI/verification handshake before any live sending; there is no fake “verified” UI here.

## Tests and next acceptance gates

- Vitest: current PB3 session and selected device, complete verified cross-signing, independently approved Ed25519 fingerprint and **all** recipient devices. Negative: TOFU, changed/unknown user identity, locally verified but unsigned device, unsigned second device, changed fingerprint, missing Olm keys, offline, account switch mid-request, remote SDK failure, foreign homeserver.
- Existing PHP 8.4/8.5, TypeScript/build, Chromium, PG18/Garage, Security and disposable Synapse RustCrypto real E2EE jobs must stay green on exact HEAD.
- Next: independent **actual Synapse cross-signing + 4S secret storage/key backup + historic message restore** using 2 user accounts and a new third device. A passing fabricated SDK snapshot is **not** that evidence. Never mark Messenger ready or production Send enabled based on unit tests.

No merge/deploy/main change, no local agent.
