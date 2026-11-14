# PB3 · P4 #238 Stage 2 / QA Issue #381 — real two-Synapse federation

**Date:** 2026-11-14 · **Owner:** CHAT-Z · **Base:** `main@8ed66c438d090efd218efa80b027f0b2f854db4b`.

## Objective and strict evidence boundary

Unlike first-stage [#238 Draft PR #379](https://github.com/1troitsky/photobunker-v3/pull/379), which only tests mock Matrix responses and optionally validates externally provided events, this stage actually provisions **two real independent, disposable homeservers in Docker** using upstream Complement, exercising actual Matrix federation room membership, server-to-server event delivery and an authenticated outsider's exclusion. No production homeserver, credential, data or paid infrastructure is involved.

**DO NOT claim Matrix E2EE complete:** `m.room.encrypted` is generated with explicit **non-cryptographic disposable dummy** `ciphertext` and cannot be decrypted by SDKs. It proves the server transports an encrypted-event *shape*, not that device keys, Megolm crypto, key-sharing, cross-signing or Recovery 4S function. Neither PB3 Messenger runtime nor Unlimited+ BYO binds to this infrastructure. True E2EE and release §25.17 remain BLOCKED.

## Immutable upstream and explicit CI

- Matrix Complement upstream: `matrix-org/complement@7cd072c1d405398aa8d3221c92a7c74509f9801e` (read-only, checked out exact SHA in CI; Go 1.26).
- Disposable service image: `ghcr.io/matrix-org/synapse-service:v1.117.0` (Docker pull; image repo digest printed by CI for provenance; no floating `latest`). A future acceptance run should pin the exact immutable digest after it is verified.
- Real test: `tests/integration/p4-matrix-two-synapse/pb3_real_federation_test.go`; during CI copied under the *pinned* upstream Complement `tests` package to reuse its authenticated Docker deployment, Matrix federation PKI and Client-Server helpers. Only the one named PB3 test runs, `-count=1`, no skips/retries, timeout 12 minutes.
- Dedicated independent workflow: `.github/workflows/p4-two-synapse-238.yml` PR → main, also manually dispatchable. On failure it must be reported as a failure rather than a synthetic pass.

## Concrete acceptance in real containers

1. `complement.Deploy(t,2)` starts two separate homeservers. Register Alice on hs1, Bob on hs2 and unrelated outsider C on hs2; assert separate auth identities and endpoints.
2. Alice creates **private** room with `m.room.encryption` state. Invite Bob, and Bob joins explicitly through federation to the host's fully qualified homeserver name. Both independently see Alice and Bob in `/joined_members`; C absent.
3. Alice creates the disposable `m.room.encrypted` envelope. Bob's server receives exact event ID via real `/sync`; both account-authenticated servers independently read consistent sender, room, event and dummy Megolm fields through `/rooms/{id}/event/{eventId}`.
4. C's separately authenticated event read must be real HTTP **403 or 404** (401 is not ACL proof), and C's uninvited `/join` must similarly be denied. A public room or unauthenticated token would invalidate this evidence.

Only real completion of step 4 counts for this bounded runner. The test never calls PB3 production APIs and never submits actual private messages or keys.

## Outstanding gates (NOT TESTED)

- SDK-generated ciphertext and independent recipient decrypt; Matrix multi-device verification and E2EE key recovery under PB3 Recovery Key.
- Real voice/media ciphertext, personal/team ACL to Matrix membership, revocation and new device denial.
- Dual homeserver production BYO TLS/DNS/capability/admission, 503/outage while PB3 Camera/Browser works, token logout/remote revoke.
- iPhone Safari/Android PWA, physical permissions, performance and full P4 owner acceptance.

**CI evidence:** record the exact PR HEAD, dedicated two-Synapse job, Foundation/Security/real PostgreSQL18/Garage/Chromium results and actual PASS/FAIL in Issue #381 and PR comment after workflows finish. No successful run is asserted in this source document.

**Main safety:** new files only; no edits or merges in main, original #379, shared API/Matrix SDK/UX, foreign branches or TS_PROGRESS_TABLE. Stop at Draft review without owner's merge authorization.
