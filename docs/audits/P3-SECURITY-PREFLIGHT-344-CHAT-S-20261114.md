# P3 #344 — Post-#336 Security Preflight Integration (CHAT-S)

**Date:** 2026-11-14 · **Status:** STAGED NON-ACTIVATING SOURCE ONLY, PRODUCT NOT ACCEPTED · **Owner:** CHAT-S · **Issue:** #344 · **Main base:** `8ed66c438d090efd218efa80b027f0b2f854db4b`.

## Scope and provenance

New isolated branch `integration/p3-344-security-preflight-chat-s-20261114` from accepted patched `main`, not from outdated source base branches. Transfer 37 source paths as their **exact Git blob SHA** (no inferred cherry-pick, no changes to the source branches):

| Source | Exact reviewed source HEAD | Isolated paths | Activation limit |
|---|---|---:|---|
| #308 / #220 | `ef8e965947b3f584b6972d87db2e47db810f9947` | 5 | Only standalone PBKDF2/HMAC PIN verifier and relock preference tests. NO identity session, app shell or auth integration. |
| #315 / #221 | `c6a03430385422bf0accc85ba77ab614c1123a7f` | 20 | Signed panic preflight ledger, GET-only route *definition* and client domain/outbox; no app route mount, no destructive intent executor. |
| #307 / #223 | `6949974aa303fbfa6f10f02650330f78c8999aab` | 4 | DMS persisted signed state and provisional expiry_review only; no operational scheduler, alerts, wipe or GC. |
| #320 / #222 | `9e86c157d254f41797c08f2e85c29c35bcbfc749` | 8 | Signed deferred device-local wipe ledger and revoke-only receipt (self-report, **not proof of deletion**); no device delivery route or active wipe. |

All paths above are newly introduced in independently scoped feature directories, migrations, tests and their dedicated workflow files. No changed `App.vue`, `Identity/application/session.ts`, `bootstrap/app.php`, global routes, `TS_PROGRESS_TABLE.md`, storage or shared CI files. This QA report is the only integration-original path. An unmounted `apps/api/routes/panic-preflight.php` defines read-only GET but is not hooked into production routing.

## Invariants and known gaps

- Panic signature verification **does not** authorize deletion, grant revoke, emergency PIN, live media GC or Recovery Vault mutation. Retain last verified backup; no destructive executor was imported.
- DMS signed server clock and positive review state do **not** send warnings or expire/delete data. Two-worker race acceptance and future scheduler registration remain distinct gates.
- Remote Wipe requires atomic PB3 signed revocation and target-device delivery. An ACK can at most report local wipe, never prove secure erase, Matrix logout or cloud deletion.
- PIN verifier protects a local state using 600k PBKDF2 and authenticated HMAC ledger, but is **NOT** a trusted Recovery Key/account unlock. Cross-tab/Identity session wiring, emergency PIN final semantics, atomic legacy migration and hardware/mobile acceptance were intentionally not transplanted.
- Real two-device trust, last-verified snapshot, lost ACK, key rotation, Panic production/remote destructive paths and iOS/Android hardware remain **BLOCKED / NOT TESTED**. No claims of full security acceptance.

## Exact-HEAD verification ledger

| Gate | Initial status | Evidence |
|---|---|---|
| Source file provenance and four distinct path scopes | PASS: exact blob transplant | This commit tree + source PRs #308/#315/#307/#320 |
| PHP8.4 / PHP8.5, Laravel 13 patch floor, Composer audit | PENDING CI | CI workflows on final Draft PR HEAD |
| Standalone PHP signed state / PG18 races / panic / wipe / DMS | PENDING CI | Focused source workflows with real PG18 |
| Frontend standalone PIN + Panic Vitest, TypeScript build | PENDING CI | Foundation workflow |
| Full PG18 / Garage / Chromium, Security and UX | PENDING CI | Final exact-head CI workflows |
| Real mobile iOS Safari / Android, full authorized destructive flow | NOT TESTED / BLOCKED | Needs independent end-to-end security/device acceptance, NOT CI green |

**Merge gate:** An isolated Draft PR with CI PASS is evidence only. No main merge, deployment, activation, server routes, real wipe or destructive operations without separate owner authorization and complete safety acceptance.
