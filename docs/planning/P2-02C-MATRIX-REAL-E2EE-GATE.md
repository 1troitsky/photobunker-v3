# P2-02C — disposable real Matrix E2EE integration gate

**Date:** 2026-11-11. **Parent:** Draft PR #69 `p2/02b-rust-matrix-client` @ `163a4cfd83507e2a9ac059dd395aeb960bcbe136`.
**Specification:** `AGENTS.md`, `ts.md §16`, `docs/planning/P2-02A-MATRIX-SIGNED-BINDING.md`, `docs/planning/P2-02B-MATRIX-RUST-CRYPTO.md`.

## First real protocol verification

A separate required GitHub Actions gate `.github/workflows/p2-matrix-real-e2ee.yml` starts a **disposable pinned Synapse `matrixdotorg/synapse:v1.161.0`** on **127.0.0.1:18008 only**. This is a disposable Linux Actions runner, not PhotoBunker infrastructure. It generates a fresh config and signing key on the runner, registers two unique ephemeral accounts via Synapse's CI-only shared-secret registration, runs `apps/web/tests/integration/matrix-real-e2ee.mjs`, then destroys the container and data. No image latest tag or production homeserver URL may be used.

The script refuses execution unless all of `MATRIX_CI_DISPOSABLE=1`, exact `http://127.0.0.1:18008` and expected local server name are present. No production credentials, PB3 account keys, stored app photos or contacts are involved. Passwords, tokens, room keys, event contents and message bodies are not printed in success or errors. The workflow masks ephemeral passwords and runs with read-only GitHub permissions.

The test exercises the **official pinned `matrix-js-sdk@44.0.0`** and **Rust Crypto WASM** on real Matrix Client-Server HTTP. The two new independent Matrix devices log in, initialize Rust Crypto with **ephemeral Node memory stores** (`useIndexedDB:false`, which is deliberately NOT the production browser vault), start Matrix sync, create an invitation-only **Megolm-encrypted room** via `m.room.encryption`, invite the other user, verify both observe the joined encrypted room, send a uniquely generated synthetic text event, fetch the raw event directly from the homeserver as the recipient and assert that it is `m.room.encrypted` ciphertext without the text, then confirm the independent recipient's live timeline has decrypted the **same event ID** to the original text.

**No faux delivery**: no pass until a separate Matrix account decrypts the actual event fetched from the local Synapse server.

## Scope and limitations

- This is a **real E2EE protocol/integration gate**, not the complete PB3 Messenger.
- Matrix credentials in this CI are throwaway passwords, NOT PB3's production key-only/Recovery-Key provisioning; do not copy this login workflow to the app. The app stays Key-Only.
- Node in-memory crypto is used to prove the actual RustCrypto/Synapse interoperates. Browser AKEK-derived encrypted IndexedDB, single-writer Web Locks and PB3 account binding were separately tested in P2-02A/B but have NOT yet been combined into one production-real-server E2E scenario.
- No cross-signing, user/recipient/device identity verification, Matrix 4S/room-key backup/recovery on new device, token revocation, explicit app contact→Matrix identity binding, team membership bridge, media attachment, offline outbox, reconnect or Lost ACK delivery dedupe is established by this CI gate. **The production Send action must remain disabled.**
- Local app-only drafts and navigation continue to work independently of this test server. A Matrix outage must never block Camera, Identity, Assignments or Browser.
- Only ciphertext/event metadata is inspected on the test server. Do not expose production messaging credentials/server signing key in CI logs or artifacts.

## Verification and future work

- **Workflow result:** record run, exact head SHA, real Matrix ciphertext and decrypt results only after Actions reports completed SUCCESS. Do not confuse a red gate with completion or a mocked SDK unit with real E2EE.
- Follow-up P2-02D: PB3 key-only Matrix account provisioning (no separate user password), issuer trust, explicit recipient verified fingerprint↔MXID mapping, multi-device E2EE key verification, recovery/cross-signing.
- Follow-up P2-02E: encrypted Local-First outbox + idempotent txn IDs, encrypted two-device text/media, revoked-member and key-rotation tests in a **production-shaped** flow.
- Later: own Matrix homeserver Unlimited+ entitlement; not part of this dev fixture.

No merge to main, no deploy, no agent request.
