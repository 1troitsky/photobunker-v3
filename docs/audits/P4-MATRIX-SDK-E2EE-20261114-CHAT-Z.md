# PB3 / P4 #388 — real Matrix JS SDK E2EE A↔B (two actual Synapse)

**Owner:** CHAT-Z · **Date:** 2026-11-14 · **Base:** `main@8ed66c438d090efd218efa80b027f0b2f854db4b`

## Why this stage exists

Original [P4 #381 / Draft PR #383](https://github.com/1troitsky/photobunker-v3/pull/383) demonstrated actual Matrix federation on two disposable Synapse and independently verified server access controls (outsider 404 read and 403 join). It used a **dummy** `m.room.encrypted` event and therefore did not prove actual encryption. Earlier [#238 / Draft #379](https://github.com/1troitsky/photobunker-v3/pull/379) tested fail-closed metadata contracts only.

This entirely separate Stage 3 must prove that an **actual Matrix JavaScript SDK encrypts the message before sending** and an independent SDK client on the other Synapse decrypts exact canary plaintext. It uses no synthetic ciphertext, no fake responses and no source changes to PB3 app runtime.

## Exact verifiable stack and original test

- Upstream `matrix-org/complement-crypto@38a76041346f64a384f569e090248ff947a1ecd3`; cloned in CI and exact SHA checked.
- Published `matrix-js-sdk@41.0.0`, passed to official pinned `rebuild_js_sdk.sh`; Yarn package dependencies installed by upstream script; RPC compiled with `-tags=jssdk`.
- Two actual separate disposable Synapse in Docker via Complement Crypto + MITM proxy; fixed upstream Synapse `ghcr.io/matrix-org/synapse-service:v1.117.0` and mitmproxy `10.1.5`; image digest must be captured from actual runner logs before any provenance claim.
- Own source `tests/integration/p4-matrix-sdk-e2ee/pb3_sdk_roundtrip_test.go`, injected as one new Go test under pinned upstream `tests/` during execution. Only `TestPB3RealFederatedJSDecryptRoundTrip` runs, `-count=1` and no skip/retry.
- Dedicated workflow `.github/workflows/p4-matrix-sdk-e2ee.yml` plus standard exact-head Foundation/Security/real PG18/Garage/Chromium.

Test proves: three separately registered A@hs1/B@hs2/C@hs2; private encrypted room with B explicitly invited, actual federated join; A's real SDK sends a canary that B's real JS SDK decrypts, then B→A reciprocal message decrypt; authenticated API raw events on both servers are `m.room.encrypted`, algorithm Megolm, non-empty actual ciphertext and keys/session fields, and **do not include synthetic plaintext canaries**; outsider with valid credentials must be denied raw event read (403/404, not 401). Any missing decrypt, exposed canary, wrong sender or unauthorised access is FAIL.

This is **test-framework/SDK interoperability**, **not PB3 production application**: neither `apps/web` nor `apps/api` currently use this test's SDK context, its recovery identity or device keys. No real customer keys/tokens/media are sent. Generic JS SDK E2EE PASS is **not** proof of PB3 E2EE.

## Product gates still NOT TESTED / BLOCKED even with a green SDK result

- Key-Only account root Recovery Key → PB3 E2EE device/room keys (4S), new-device restoration and trusted device cross-signing.
- Real PB3 Messenger UI, Local-First encrypted outbox, offline reconnect/dedupe/lost ACK; original Matrix #212/#213.
- Voice/video/photo/file attachment ciphertext and TTL/ACL, team membership/revocation, Panic and remote wipe, Matrix outage while Camera/Browser run.
- Unlimited+ user-managed homeserver binding/entitlement and native iPhone/Android PWA acceptance.
- Security release gate: owner acceptance; no `main` merge/deploy here.

## Evidence discipline

Exact SHA, runner URLs, selected named real test, synthetic canary on-device decrypt, server raw JSON `m.room.encrypted`, outsider denial and overall workflow status must be documented in [Issue #388](https://github.com/1troitsky/photobunker-v3/issues/388) after CI. No PASS asserted simply because this file or a workflow was committed. Failed runners must be reported as FAIL, without disabling checks, modifying other agents' branches or weakening crypto assertions.

**File isolation:** 3 new-only paths. Other agents own Notifications, Vault, S3, security, Browser/Assignments E2E and other pre-main integration. This PR must not modify any of those files or main. No user-approved merge/deploy.
