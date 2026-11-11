# PB3 · P2 Matrix stacked PR #64–#75 · integration/security desk audit

- **Date:** 2026-11-11 (Georgia)
- **Subject:** `1troitsky/photobunker-v3`, exact **product HEAD** `e39b619dc9ec36eefc9ac322367e2d4348a1508e` ([Draft #75](https://github.com/1troitsky/photobunker-v3/pull/75)).
- **Base:** `main @ a8abcc55e73ea0a2d8be3a24052f814906b8bd1d`; common ancestor `2c8ad9f6f18da9e87797d8df2cc0d6c3cf4eb7a6`.
- **Kind:** SOURCE + GitHub CI EVIDENCE **desk review** by the implementing assistant. **NOT** an independent runner/second-person security audit, physical-device test or production acceptance. All product changes are untouched in this QA-only branch. An independent local acceptance assignment is linked below.
- **Scope/source of truth:** `AGENTS.md`, `ts.md §16, §19, §26`, full GitHub PR DAG, changes versus `main`, PHP Matrix binding + escrow, frontend encrypted drafts, PB3 Matrix cards/trust/SDK/lease/outbox, migration schemas, two real Synapse test scripts, GitHub Actions execution reports.
- **Verdict:** **PARTIAL PASS (tested foundation/Matrix transport), BLOCKED for merger/production Messenger acceptance**. No authorization for `main`, migration, deploy, enabling Send or changing production keys. No claim of an unobserved exploit.

## 1. Reproducible DAG and reconciliation

| Order | PR | GitHub target / purpose | Exact SHA prefix | Verified on that SHA |
|---|---|---|---|---|
| 1 | #64 | `main`, Messages 1.1 overlay + sealed drafts | `fbf09ab7` | 3/3 PASS |
| 2 | #66 | #64 branch, draft save/navigation guard | `f927ce80` | 3/3 PASS |
| 3 | #67 | #66 branch, encrypted Dock preferences | `c972a897` | 3/3 PASS |
| 4 | #68 | #67 branch, PB3↔Matrix binding | `b8e0e13f` | 3/3 PASS |
| 5 | #69 | #68 branch, RustCrypto/Web Lock | `163a4cfd` | 3/3 PASS |
| 6 | #70 | #69 branch, disposable Synapse | `e2ac2265` | 4/4 PASS |
| 7 | #71 | #70 branch, sealed Matrix 4S escrow | `5fde4baa` | 4/4 PASS |
| 8 | #72 | #71 branch, PB3 signed contact cards | `fdbaf8ee` | 4/4 PASS |
| 9 | #73 | #72 branch, checked cross-signing + 4S recovery | `d4d9bc93` | 4/4 PASS |
| 10 | #74 | #73 branch, offline encrypted outbox/trust/ACK | `2b1c6674` | 4/4 PASS |
| 11 | #75 | #74 branch, real outbox → Synapse + SDK local txn echo fix | `e39b619d` | 4/4 PASS |

All 11 are **open Draft, not merged** at review. GitHub compare verifies #66–#75 branches are ahead of their immediate bases, without unrelated history. **#64 is diverged from the current `main`** because one separate documentation commit already entered main since original `2c8ad9f6`. That commit adds `.gitignore`, `docs/_local-tasks` and `docs/_uiux` but the current product chain does not contain it. No product code collision was observed in changed paths; actual rebasing/merge resolution **was NOT performed or tested**. Before a permitted ordered merge, make a disposable integration candidate that preserves both lines of history, run exact-SHA checks and examine file contents/diffs; do not direct-merge #75.

The **QA-only** report in this PR is not an extra product dependency and must not be confused with an owner-approved merge proposal.

## 2. Exact-head CI evidence at product SHA

| Gate | Recorded proof | Result |
|---|---|---|
| PHP 8.4 and PHP 8.5, API, TypeScript/build + frontend Vitest | [Foundation run 42942155087](https://github.com/1troitsky/photobunker-v3/actions/runs/42942155087) | PASS: PHPUnit **121 tests / 1892 assertions** on each PHP version; **213 Vitest pass, 1 CI-only skip**; TS/build PASS |
| Backend security checks | [Security run 42942155113](https://github.com/1troitsky/photobunker-v3/actions/runs/42942155113) | PASS |
| Real PostgreSQL 18 / Garage 2.5 and Chromium | [Storage/browser run 42942155022](https://github.com/1troitsky/photobunker-v3/actions/runs/42942155022) | PASS: **22 Playwright** and real DB/storage smoke |
| Matrix E2EE + 4S recovery protocol, two actual Matrix accounts | [Synapse run 42942155349](https://github.com/1troitsky/photobunker-v3/actions/runs/42942155349) | PASS |
| Real *PB3 outbox module* → separate disposable Synapse → second RustCrypto receiver | Same [Synapse run 42942155349](https://github.com/1troitsky/photobunker-v3/actions/runs/42942155349), second independent job | PASS, including encrypted IndexedDB, cold JS module re-import, lost ACK, same UUID txn, server ciphertext GET, no duplicate and second Matrix client decrypt |

The extra integration test is **excluded from ordinary Vitest** unless `MATRIX_CI_DISPOSABLE=1` with the exact localhost test host; its normal-suite skip is intentional. Both Synapse jobs are independent localhost-only ephemeral servers with separate rate limits. No real account credentials or real user data are involved.

**Not proven by this CI:** a browser with PB3 real authenticated account + backend Contact check and real SAS/QR verification, full PWA navigation reload, native Safari/iOS/Android, revoked-contact race, real configured HTTPS production homeserver, encrypted attachment transfer, Panic key revoke, billing/private homeserver. CI mocks PB3 identity/Contacts/trust/lease in the real-wire outbox job. Node RustCrypto runs in-memory crypto store there; the separate browser tests use the PB3 store/lease interfaces.

## 3. Verified invariants supported by product code

1. **Zero plaintext server storage:** Laravel Matrix controllers store only PB3 device/account signed metadata and AKEK-sealed 4S escrow; no Matrix access token in DB. `matrix-binding.ts` persists access token only in device/AKEK sealed local IndexedDB. `matrix-text-outbox.ts` stores message body, room, recipient, txn and event receipt only inside AES-GCM ciphertext indexed by account/device-scoped hashes and AEAD AAD. Local failure remains queued; it is not reported as delivered.
2. **Signed identity boundaries:** binding POST verifies both account and device signature and checks no redirect to unpinned homeserver `whoami`. Contact cards verify PB3 root signature + mapped device binding signature; explicit Matrix MXID and PB3 safety number approval is distinct from real Matrix cross-signing. The device inspector requires an independently supplied Ed25519 fingerprint, cross-signing and all known recipient devices signed. **These are separate checks—not a completed user verification UX.**
3. **Room/send boundaries:** outbox preflight requires authenticated PB3 ledger match, owner-specific crypto Web Lock, online SDK sync, Megolm state, independently verified recipient devices, exactly two live members, no invited third member and invite-only access policy. It forces `OnlySignedDevicesIsolationMode`. This is not a server-atomic room ACL; membership may change after the check.
4. **Real lost ACK:** the real SDK locally retains a `txnId` mapping and `Room.addPendingEvent()` rejects a duplicate local echo. #75 fixes that by inspecting `getEventForTxnId()`: `SENT` fetches original event from homeserver; `NOT_SENT` uses official `resendEvent()`; any foreign/in-flight state blocks instead of creating a second local event; absent mapping sends with the same UUID. Synapse CI actually tested cold module re-import, ciphertext and recipient decrypt.
5. **Migration preservation:** Matrix schema `down()` rejects routine rollback of populated account/device mappings and sealed 4S escrow, rather than destroying keys. This also means production rollback needs an explicit migration/backout plan. No production migration locks or safe teardown were exercised.

## 4. Gaps, severity and actionable results

### M-01 — BLOCKING P2: no real PB3 identity→verified peer→Send→receive acceptance

**Evidence:** `apps/web/src/features/messages/application/matrix-rust-adapter.ts` initializes crypto and deliberately exposes no `startClient()`/production Send; `MessagesView.vue` remains presentation/drafts. The real Synapse harness `matrix-outbox-synapse.test.ts` mocks PB3 `jsonApi`, `listConfirmedContacts`, `getMatrixContactMapping`, `inspectVerifiedMatrixDevice` and `isLeasedMatrixClient`, then exercises the genuine outbox with the genuine SDK.

**Impact:** no proof that two real PB3 accounts can establish verified Matrix devices, contact safety pinning, room binding and ACL, transfer text, survive a true browser restart and recover history. **Do not enable Send** or describe Messenger as accepted. **Next acceptance:** real PB3 server + two isolated browser contexts + real HTTPS Matrix test server + independent out-of-band trust verification, real ciphertext and failure/retry evidence.

### M-02 — BLOCKING recovery lifecycle: PB3 key revision rotation strands existing Matrix escrow

**Evidence:** `IdentityController::proof('rotate')` increments `identity_accounts.revision`; `MatrixRecoveryEscrowController::mine()` rejects stored escrow with different revision (409); `::store()` insists on new revision but its immutable existing-row comparison rejects replacing the prior revision (409). `matrix-recovery-escrow.ts` also treats an existing escrow as immutable. The PHP test `test_revocation_and_pb3_key_revision_change_fail_closed()` proves old revision correctly fails, **not** re-escrow after a legitimate rotation.

**Impact:** when the account revision advances, previously stored 4S ciphertext is not returned, and the same account cannot store a replacement in `matrix_recovery_escrows_v1`. This is **fail-closed with no evidence of a plaintext leak**, but a *functional recovery dead end*. The code does not prove the customer's Matrix keys are permanently lost (the old device/server backup may still exist). Blocking before supporting PB3 key rotation and real Matrix new-device recovery.

**Required resolution:** design a signed, versioned replacement and safe rewrapping under server row lock with precise old/new revision, durable Lost ACK/idempotence, rollback monotonicity and recovery on a new device; determine whether key rotation preserves the AKEK or requires a re-encryption transition. Add API and browser negative tests (forged/stale revisions, same-epoch fork, concurrent writers, revoked device, failed seal). **Do not delete or overwrite the only ciphertext before successful verification.**

### M-03 — BLOCKING user security lifecycle: Panic/revoke/logout has no Matrix homeserver credential revocation contract

**Evidence:** `MatrixBindingController` exposes only `mine`/`bind`, and `MatrixRecoveryEscrowController` exposes `mine`/`store`; route declarations have no Matrix logout/revoke endpoint. `clearLocalMatrixCredentials()` expressly documents it performs **local-only** deletion. PB3 device revocation exists in Identity but does not by itself revoke a token issued by a separate Matrix homeserver. Server currently never holds the Matrix access token for post-hoc revoke.

**Impact:** user-facing device revoke, Panic or emergency wipe cannot honestly guarantee that an independently issued Matrix token and already shared room keys are invalidated/cleared on the other client. Existing message send is intentionally disabled, so this is an **acceptance/lifecycle blocker**, not a claim that live PB3 customer messages currently leak.

**Required resolution:** explicit Matrix device/token revocation protocol with independent server capability, authenticated PB3 recovery authority, an E2EE key trust/room removal policy and offline retry semantics; test blocked user after revoke and acknowledge that plaintext previously decrypted by a third party cannot be recalled. Avoid ever uploading raw bearer token to PB3 backend for convenience.

### M-04 — RISK requiring independent threat review: remote room membership is not an atomic gate

**Evidence:** `preflight()` obtains live `getJoinedRoomMembers` and `roomState` then waits for SDK send. A third-party invite or join occurring **after** the server state read cannot be excluded by an application-local check alone. `OnlySignedDevicesIsolationMode` and cross-signing checks mitigate unauthorized devices but do not make membership checks atomic with key distribution.

**Impact:** unknown until a malicious concurrent membership-update test. Do not assert hard atomic ACL based on `roomState` alone. Require a reproducible adversarial concurrent-invite/join scenario and Matrix room history/invite/federation policy review before product acceptance.

### M-05 — TEST COVERAGE / PWA: local boot and real reload still distinct

**Evidence:** #75 `vi.resetModules()` creates a new JS outbox instance reusing fake-indexeddb; it does **not** restart a real page or test IndexedDB/Service Worker process lifecycle under actual PWA. Browser-based crypto Web Lock tests and the isolated Node test establish different pieces, not one fully integrated device lifecycle.

**Action:** browser reload/offline/context-lost/account-switch/locked PB3 session + two-tab/Web Locks test with real Matrix backend, plus Safari/iPhone. This remains OPEN, not a contradictory test failure.

### M-06 — RELEASE hardening: operator homeserver and custom Matrix server paths

Platform Matrix homeserver is empty by default and `MatrixBindingController::origin()` intentionally restricts to one HTTPS operator-configured origin, not BYO. The user-managed Unlimited+ homeserver contract belongs to mandatory P4 but is **not** implemented. Do not claim it is delivered, or require it before basic platform E2EE P2 acceptance.

### M-07 — SECURITY EVIDENCE: independent review not yet obtained

The same assistant developed parts of #64–#75 and performed this desk audit using read-only GitHub source/CI. Even if all cited tests PASS, they are not a second auditor's implementation review. The environment here did **not** run local Docker, physical Safari/iOS/Android or independent replay of PostgreSQL/Garage/Matrix migration locks. Independent QA is a required gate *before any merge recommendation*; see the companion audit assignment.

## 5. Merge/rollback disposition and next work

- **DO NOT MERGE:** user Messenger P2 is not end-to-end accepted; M-01/M-02/M-03 are unresolved. The current `main` contains one docs/UIUX commit not present in the Draft chain. Permission to merge is absent.
- Preserve all #64–#75 draft heads unchanged while conducting independent acceptance. Verify no stale base changes; prepare disposable candidate with current `main` + chain and a full diff audit, with no production migration or deployment.
- Run **independent local acceptance** of Matrix/PB3 end-to-end, and specifically add failure-based evidence for M-02/M-03/M-04. Use existing CI as baseline instead of needlessly duplicating all 213/22 tests.
- After independent results, create narrow **product** remediation Draft PR(s) for confirmed gaps; keep this QA-only branch for evidence, not code changes.
- Then propose to owner an ordered merge/rollback plan for a **complete owner-accepted slice only**; until then no `main` modifications.

**Status definitions:** CI PASS = existing automated gates passed at exact cited SHA; DESK REVIEW = source inspection only; BLOCKED = missing contractual acceptance/negative tests; NOT TESTED = no independent runtime/physical proof. None mean owner acceptance.
