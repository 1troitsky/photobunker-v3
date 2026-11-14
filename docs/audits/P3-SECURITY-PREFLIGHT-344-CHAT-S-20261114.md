# P3 #344 — Post-#336 Security Preflight Integration (CHAT-S)

**Date:** 2026-11-14 · **Status:** STAGED NON-ACTIVATING SOURCE ONLY, PRODUCT NOT ACCEPTED · **Owner:** CHAT-S · **Issue:** #344 · **Main base:** `8ed66c438d090efd218efa80b027f0b2f854db4b`.

## Scope and provenance

New isolated branch `integration/p3-344-security-preflight-chat-s-20261114` from accepted patched `main`, not from outdated source base branches. Transfer 37 isolated source paths, retaining **35 exact source Git blobs** and reconciling only **two original CI workflows** to the already security-patched accepted main (no inferred cherry-pick, no changes to source branches):

| Source | Exact reviewed source HEAD | Isolated paths | Activation limit |
|---|---|---:|---|
| #308 / #220 | `ef8e965947b3f584b6972d87db2e47db810f9947` | 5 | Only standalone PBKDF2/HMAC PIN verifier and relock preference tests. NO identity session, app shell or auth integration. |
| #315 / #221 | `c6a03430385422bf0accc85ba77ab614c1123a7f` | 20 | Signed panic preflight ledger, GET-only route *definition* and client domain/outbox; no app route mount, no destructive intent executor. |
| #307 / #223 | `6949974aa303fbfa6f10f02650330f78c8999aab` | 4 | DMS persisted signed state and provisional expiry_review only; no operational scheduler, alerts, wipe or GC. |
| #320 / #222 | `9e86c157d254f41797c08f2e85c29c35bcbfc749` | 8 | Signed deferred device-local wipe ledger and revoke-only receipt (self-report, **not proof of deletion**); no device delivery route or active wipe. |

All paths above are newly introduced in independently scoped feature directories, migrations, tests and their dedicated workflow files. **Integration-only reconciliations:** `.github/workflows/p3-panic-signed-intent-221.yml` and `.github/workflows/p3-remote-wipe-222.yml` no longer download and replace an obsolete #297 composer.lock. The previously required `git diff ... composer.lock` assertion fails correctly when modern `main` already contains that security patch. Both workflows now rely exclusively on the checked-in modern lock and retain PHP security-floor verification, Composer validate, Composer audit --locked, and all tests. No changed `App.vue`, `Identity/application/session.ts`, `bootstrap/app.php`, global routes, `TS_PROGRESS_TABLE.md`, storage or shared CI files. This QA report is the only integration-original added path; those two claimed workflow adjustments are the only differences from upstream source blobs. An unmounted `apps/api/routes/panic-preflight.php` defines read-only GET but is not hooked into production routing.

## Invariants and known gaps

- Panic signature verification **does not** authorize deletion, grant revoke, emergency PIN, live media GC or Recovery Vault mutation. Retain last verified backup; no destructive executor was imported.
- DMS signed server clock and positive review state do **not** send warnings or expire/delete data. Two-worker race acceptance and future scheduler registration remain distinct gates.
- Remote Wipe requires atomic PB3 signed revocation and target-device delivery. An ACK can at most report local wipe, never prove secure erase, Matrix logout or cloud deletion.
- PIN verifier protects a local state using 600k PBKDF2 and authenticated HMAC ledger, but is **NOT** a trusted Recovery Key/account unlock. Cross-tab/Identity session wiring, emergency PIN final semantics, atomic legacy migration and hardware/mobile acceptance were intentionally not transplanted.
- Real two-device trust, last-verified snapshot, lost ACK, key rotation, Panic production/remote destructive paths and iOS/Android hardware remain **BLOCKED / NOT TESTED**. No claims of full security acceptance.

## Exact-HEAD verification ledger

| Gate | Initial status | Evidence |
|---|---|---|
| Source provenance and four distinct path scopes | PASS: 35 exact source blobs + two scoped security-CI reconciliations | Git commit diff + source PRs #308/#315/#307/#320 |
| PHP8.4 / PHP8.5, Laravel 13 patch floor, Composer audit | PENDING CI | CI workflows on final Draft PR HEAD |
| Standalone PHP signed state / PG18 races / panic / wipe / DMS | PENDING CI | Focused source workflows with real PG18 |
| Frontend standalone PIN + Panic Vitest, TypeScript build | PENDING CI | Foundation workflow |
| Full PG18 / Garage / Chromium, Security and UX | PENDING CI | Final exact-head CI workflows |
| Real mobile iOS Safari / Android, full authorized destructive flow | NOT TESTED / BLOCKED | Needs independent end-to-end security/device acceptance, NOT CI green |

**Merge gate:** An isolated Draft PR with CI PASS is evidence only. No main merge, deployment, activation, server routes, real wipe or destructive operations without separate owner authorization and complete safety acceptance.

## Integration CI regression triage

- Initial isolated HEAD `d10d633c29d4fa7fcbed3aecc384329404fbcc60` was rejected by PHP 8.4/8.5 Panic and Remote Wipe **workflow setup** steps, not yet by product tests: workflows downloaded the legacy #297 patched Composer lock and then required a *diff* in composer.lock. Accepted main already contains the fix, making that diff empty; the assertion exited 1. Evidence: workflow runs `43578061834` and `43578061857`, PHP jobs.
- Own-claimed workflow-only commits `24b9c56480c05775fdd16a99e5fc3ed44b388e57` and `45eb29adc10f3124b40b13c1ba48f212c502626a` remove **only the obsolete external replacement**. Runner now checks the checked-in composer.lock remains unchanged; Composer strict validate and locked audit still run and must pass. No feature tests bypassed, reduced or made optional.
- Re-run exact **final PR HEAD** CI and update PASS/FAIL counts before marking bounded integration `review`. The initial runs are NOT acceptance evidence.
