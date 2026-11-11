# PB3 · Independent local acceptance assignment — Matrix Draft #64–#75

**Owner action:** hand this exact assignment to the **independent local coding/QA agent** only when ready. This is **not** a request to automatically merge or implement a new app. The local agent should perform a second-source, *runtime* audit, not repeat the producing assistant's opinions.

## Identity and immutable scope

- Repo: https://github.com/1troitsky/photobunker-v3
- **PRODUCT UNDER TEST:** [Draft PR #75](https://github.com/1troitsky/photobunker-v3/pull/75), `p2/02e2-real-synapse-outbox-gate`, exact head **`e39b619dc9ec36eefc9ac322367e2d4348a1508e`**.
- **Target main only for reconciliation:** `a8abcc55e73ea0a2d8be3a24052f814906b8bd1d`, common ancestor `2c8ad9f6f18da9e87797d8df2cc0d6c3cf4eb7a6`.
- Chain: #64 → #66 → #67 → #68 → #69 → #70 → #71 → #72 → #73 → #74 → #75. All are **Draft**, none merged as of this audit. Their actual base branches must be retrieved from GitHub, not guessed.
- New **source desk-audit evidence**: `docs/audits/P2-MATRIX-STACK-INTEGRATION-20261111.md` on QA branch `qa/p2-matrix-stack-audit-20261111`; assess findings independently, do not treat this report as trusted proof.
- Required reading: `AGENTS.md`, `ts.md §16, §19, §26`, `docs/status/CURRENT.md`, Matrix API controller/migrations/tests and client `matrix-*.ts`, encrypted drafts, reference Fieldwork Messages 1.1. PB2 accepted PR #56 is *read-only UX reference*, not code to merge wholesale.

## Goal: second-source verdict before any merge discussion

Use **your actual own local environment** (or disposable CI runner) to test whether the **production PB3 Identity/Contacts/Matrix trust integration** on #75 can work safely with real Matrix users, encrypted outbox and key recovery. No fake PB3 proof in the acceptance test. Existing GitHub CI at #75 already reports 4/4 PASS: PHPUnit 121/121 per PHP runtime, Vitest 213 PASS, Chromium 22/22, real PG18/Garage2.5, disposable Matrix/Synapse protocol + outbox jobs. Your job is to uncover integration failures **those mocks can hide**.

Prioritize these tests; stop on confirmed blocker rather than attempting dozens of low-value general tests:

1. **Full DAG and migrations:** compare each PR's actual base/HEAD and changes, ensure no lost work, no unintended duplicate DB schema/migration, and that the independent `main` docs commit is retained. Construct only an **ephemeral local candidate** for inspection if necessary; NEVER change remote `main`. Review safety and reversibility of both Matrix migrations with real PostgreSQL, including populated tables. Do not run destructive rollbacks against real data.
2. **Real PB3 A→B:** register two genuinely distinct PB3 accounts, open two isolated browser contexts, establish PB3 confirmed Contact with pinned safety number, bind two real disposable Matrix accounts/devices using the verified server `whoami` contract, verify independent Matrix fingerprint and actual cross-signing (explicit SAS/QR/approved cryptographic ceremony, not a fake promise). Create private Megolm two-user room; verify server room ACL and actual invite handling. If current UI intentionally cannot produce this flow, mark **BLOCKED BY IMPLEMENTATION**, do not bypass real PB3 authentication by mocks and call it PASS.
3. **Local-first recovery/transport:** enqueue real encrypted PB3 message offline, assert no plaintext in IndexedDB or backend logs, reload **actual browser page**, reconnect, send through real Matrix SDK and receive/decrypt on B. Induce real lost HTTP ACK after server accept, retry exact same txnId and verify **one encrypted server event** and **one decrypted recipient event**; test server ciphertext and unauthorized read. Concurrent tabs/Web Lock and account switch should refuse unsafe crypto writers.
4. **Matrix 4S / PB3 Recovery Key:** persist account-root-signed AKEK-wrapped 4S, recover PB3 on an entirely new browser/device; validate *original* Matrix cross-signing root and old Megolm event decryption while old Matrix devices are offline, and deny wrong Recovery Key/wrong 4S. Explicitly confirm this is different from current synthetic node-only Matrix 4S test.
5. **Regression finding M-02 — PB3 revision rotation:** first store a valid rev1 Matrix escrow, perform genuine PB3 key revision rotation, then try safe rev2 read and re-escrow. Document both API responses and whether recoverability is preserved. Existing code appears to make rev2 store impossible because immutability prevents replacement; do not disable freshness checks or overwrite the only ciphertext as a workaround. If real test is unavailable, mark **BLOCKED / SOURCE-PROVEN**, not PASS.
6. **Regression finding M-03 — revoke/Panic:** revoke PB3 Matrix-bound device while a Matrix SDK client/token is active and observe whether Matrix homeserver token/key sharing is truly revoked/blocked. Identify which token survives and where, with **no token itself in logs**. Verify local-only clear is not being misreported as remote revoke; no ordinary logout should masquerade as Panic. No production credentials.
7. **Race M-04:** on disposable Synapse, try third-party invite/join and changed room policy between PB3 live ACL preflight and Megolm send; capture whether a third receiver could get a room key. Distinguish risk from confirmed unauthorized decryption; preserve test evidence. Do not relax isolation to make the test run.
8. **UI and actual device limitation:** confirm approved Messages overlay and Dock behavior; do not enable Send just to display a UI state. Native Safari/iPhone/Android is **NOT TESTED** unless you possess and used that hardware.

## Guardrails

- **NEVER** change/merge `main`, merge the Draft chain, deploy, rotate production keys, reset non-disposable databases, delete real data or leak Matrix tokens, room keys, user message bodies, Recovery Keys, GPS or personal IDs into logs.
- Keep live Matrix tests restricted to your **disposable localhost or explicitly approved isolated private homeserver**. Mask tokens and synthetic payloads.
- The escrow is immutable by design so far. If its lifecycle is broken, **record a FAIL**, and propose a *separate* versioned remediation rather than an ad-hoc overwrite.
- Do not modify this QA-only PR's report to make it falsely green. If a product bug is confirmed, report it and make a **new narrow Draft PR off #75** only if safe and within scope, then prove the exact new SHA separately. Never silently merge fixes or alter the original validated SHA.
- Avoid broad unrelated refactors, repetitive standard CI passes, and artificial ready-to-merge status.

## Required output

Write one review report in `docs/audits/` on a **separate QA-only branch and Draft PR**, with:
- environment, exact GitHub refs/SHAs, commands, sanitized evidence and both successful & failed attempts;
- compact criterion-by-criterion **PASS / FAIL / BLOCKED / NOT TESTED**, with distinction between GitHub CI and independently executed scenarios;
- evidence for M-01 through M-05, the precise narrowest reproducible root cause and suggested remediation order;
- an explicit statement whether the *entire stacked product PR* can even be **proposed** for owner-approved merge (expected **NO** until real PB3 acceptance and key/revoke lifecycle);
- a safe planned merge/rebase/rollback order only if all prerequisites are met, never automatic execution.

If critical acceptance cannot proceed with the current design, stop the risky scenario, keep the existing secure feature gates off and report **BLOCKED BY DESIGN/IMPLEMENTATION** with what is missing. Do not ask owner to repeat the whole project background; sources are in GitHub.
