# PB3 — независимый pre-main integration preflight · 2026-11-13

**Статус: REVIEW TARGET / NOT MERGE-APPROVED / NOT RELEASE-READY.**
**Owner / CLAIM:** ChatGPT, [Issue #289](https://github.com/1troitsky/photobunker-v3/issues/289). Branch `integration/pb3-main-review-gate-20261113` is a NEW branch based on exact immutable [QA Draft PR #288](https://github.com/1troitsky/photobunker-v3/pull/288) @ `f906f1490653db98df34b41db55fbda9cb3238e0`. Base of this review PR is **main** @ `da7327b8c9c440dae3dc864b3245b9f9f4ad14eb`. No production code changes, foreign branch updates, merges, test weakening or deploys.

## Why a single review target

On 2026-11-13 GitHub returned **189 OPEN PRs, all Draft**. **175/189** target other development branches and **14/189** target `main`. Open-PR base/head graph shows an **84-PR ordered product+QA ancestry** with latest tip #288 and root #82 on main. Their commits are cumulative rather than 84 independent patches. Opening or merging 189 PRs individually would duplicate already inherited work, risk rebasing old assumptions into newer E2EE and violate exclusive-file/QA rules.

Main-to-tip **exact Git blob tree** comparison of `da7327b8` vs `f906f149` (before this new audit/progress correction): **523 changed file paths** = **465 added**, **57 modified**, **1 deleted**. The one apparent deletion in this tree-to-tree comparison was `TS_PROGRESS_TABLE.md`. **Important ancestry correction:** this was NOT a confirmed descendant deletion. GitHub compared main→tip as **diverged, 890 ahead / 1 behind** with merge base `a8abcc55e73ea0a2d8be3a24052f814906b8bd1d`; the ONE main-only commit `da7327b8` has message `docs: add TS progress table`, and its ONLY changed file was `TS_PROGRESS_TABLE.md`. The long-running product branch forked before that main-only docs commit. Main blob count **309**; tip blob count **773**. This review branch adds an updated evidence-based `TS_PROGRESS_TABLE.md` explicitly, so **future integration needs to resolve the main-side table addition against this new version**, without losing owner's table. This new branch does NOT merge main or change its contents.

The tip's source tree contains **117** `docs/ux/` reference files and **14** `docs/ux-integration/` sources not in main; these are source/UX evidence, not proof all 22 screens function. The existing 26 `docs/_uiux/` reference HTML files remain.

## The 14 PRs directly targeting main — SHA-based reconciliation

These comparisons are of **exact changed-file Git blob SHA** in each independent PR head vs the latest verified #288 tip, **not commit ancestry or merge approval**. Other modified files may coexist in the tip.

| PR | Changed files / exact-match in #288 | Action |
|---|---:|---|
| [#250](https://github.com/1troitsky/photobunker-v3/pull/250) Signed PWA integrity | 4/4 | Already identical file content; do not merge separately |
| [#249](https://github.com/1troitsky/photobunker-v3/pull/249) privacy telemetry | 6/6 | Already identical |
| [#247](https://github.com/1troitsky/photobunker-v3/pull/247) metadata-only events | 5/5 | Already identical |
| [#246](https://github.com/1troitsky/photobunker-v3/pull/246) Backup admission | 4/4 | Already identical; this does NOT prove backup restore |
| [#245](https://github.com/1troitsky/photobunker-v3/pull/245) Help/FAQ/Legal UI | 5/5 | Already identical; legal copy still requires owner/legal release acceptance |
| [#188](https://github.com/1troitsky/photobunker-v3/pull/188) Admin RBAC foundations | 4/4 | Already identical; production admin MFA/ops not thereby complete |
| [#186](https://github.com/1troitsky/photobunker-v3/pull/186) encrypted local notifications | 2/2 | Already identical |
| [#184](https://github.com/1troitsky/photobunker-v3/pull/184) project Kanban/epics | 2/2 | Already identical |
| [#251](https://github.com/1troitsky/photobunker-v3/pull/251) S3 contract tests | **1/2** | ContractAdapter identical; StorageContractTest has evolved. Compare test intent before closing/reconciling; do not overwrite newer test |
| [#82](https://github.com/1troitsky/photobunker-v3/pull/82) Browser v3 root | **0/7** | ROOT of 84-PR descendant; all seven source paths remain in current tip but have evolved. Do not re-merge old root separately |
| [#84](https://github.com/1troitsky/photobunker-v3/pull/84) Progress | 0/1 | Original main table comes from a separate main-only commit after the stack fork; updated progress table is authored in this review branch, with explicit add/add merge resolution required |
| [#64](https://github.com/1troitsky/photobunker-v3/pull/64) Messages beta | **0/9** | App.vue, router, styles.css, Playwright config all differ in main product tip; **five files of #64** including `MessagesView.vue`, AKEK local drafts/tests/docs are **absent** from tip. Matrix separate acceptance remains HOLD. NEVER merge old UI blindly |
| [#63](https://github.com/1troitsky/photobunker-v3/pull/63) Media grant clock guard | 0/5 | Three media-grant paths evolved; old status doc not in tip and `docs/status/CURRENT.md` must not be overwritten with stale state. Verify negative behavior against current version |
| [#49](https://github.com/1troitsky/photobunker-v3/pull/49) old main status docs | 0/2 | Older `docs/status/CURRENT.md` and history snapshot are stale. Review provenance, not integration overwrite |

Eight side PRs have all changed files **identical by blob SHA**, not necessarily identical commit history. They may be incorporated through re-implementations/branch inheritance. Treat merge/close decisions as separate owner-reviewed housekeeping.

**Graph edge cases:** open PRs #262, #51, #47, #3 target bases not equal to the head branch of another *open PR*. This does **not** mean the referenced base branch is deleted; its existence/merge state has NOT been proven here. Investigate bases before branch ancestry surgery. #262 and #263 address overlapping GPS revoke in the same source, with different bases; independent P4 #265 chose/retested **#263**, not an automatic double-merge of #262. Old Matrix #133 reacceptance has documented BLOCKED paths; do not fold Matrix into the core to make the PR count smaller.

All 14 direct-main root HEADs had three original core workflows PASS when individually checked, but many were created before the fourth UX lane existed. **Their original HEAD CI cannot substitute for the consolidated main-base CI**, and passing unit smoke does not prove production payment, physical mobile, or release readiness.

## Current exact-head evidence, not extrapolated release assurance

The source tip #288 was independently accepted at SHA `f906f1490653db98df34b41db55fbda9cb3238e0` with **4/4 workflow SUCCESS**:
- [PG18/Garage/Chromium run 43351798817](https://github.com/1troitsky/photobunker-v3/actions/runs/43351798817) — real Chromium **83/83** incl synthetic verified paid Go29/Pro89→Free E2EE readback, real Garage outage/restart/lost ACK and **5/5** two-process PG quota races
- [Foundation 43351798681](https://github.com/1troitsky/photobunker-v3/actions/runs/43351798681) — PHPUnit **244/244 (3651 assertions)** on each PHP8.4/8.5, Vitest **446/446**, strict TS/build
- [Security 43351798830](https://github.com/1troitsky/photobunker-v3/actions/runs/43351798830) — PASS
- [UX 43351798745](https://github.com/1troitsky/photobunker-v3/actions/runs/43351798745) — PASS

These facts are for the **stacked base**, not a claim of passing CI on this NEW integration review branch targeting `main`. A fresh **4/4 exact-new-HEAD, base=main** CI is required and must be recorded separately. Even if green, this is a candidate for code review, **NOT automatic permission to merge**.

## Real blockers and dispositions before any main merge

1. **Owner authorization:** `AGENTS.md` explicitly forbids modifying/merging main without the owner's instruction. This review PR remains Draft regardless of CI.
2. **Message UI / Matrix:** #64's original MessagesView + encrypted drafts are not in this selected core tip. Matrix A→B, escrow rotation, SAS/QR, Lost ACK, revoke/Panic, real own-token logout and custom Unlimited+ homeserver are not fully accepted; separate locked lane, do not automatically merge Matrix. The Messages beta UI gap requires explicit reconciliation.
3. **#203 Retention:** Free14/Go30/Pro90 server and Free13/Go29/Pro89 client integration tested in synthetic paid browser-Garage journeys. Unlimited renew/re-sign, natural subscription expiry/grace, irreversible GC/restore/replica precedence and public/assignment/archive share deadline are OPEN and NOT accepted. No concealed TTL extension or physical purge.
4. **Older PR cleanup:** #63 grant, #49 history, #84 progress, #251 evolved test need explicit reconciliation. 4 unmatched open-PR ancestry edges cannot be assumed deleted. Keep selected #263 instead of conflicting #262.
5. **Cross-platform and release:** physical iOS Safari / Android PWA, real payments/settlement finality, own/replica S3 BYO failover, complete backup+Panic, standalone Matrix acceptance and operational rollout NOT TESTED.
6. **Security:** no disabling or rewriting old tests, no CORS/proxy weakening, no S3 ACK forgery, no fake merchant proof, no production data resets or read of E2EE plaintext on server.

## Proposed sequence

1. Use **one Draft integration PR targeting main** with latest verified ordered product stack and this report, and run **all 4 original workflows on its exact HEAD**. Record new PASS/FAIL/NOT TESTED.
2. Reconcile only actually missing side effects in isolated follow-up branches (particularly Messages #64 and #63), with explicit free-file claims and independent tests; do not auto-merge independent Drafts or resurrect old versions.
3. Ask owner for **separate, explicit merge authorization** after code review. Do not close 189 issues/PRs blindly; distinguish stacked ancestry, equivalent content and deferred product scope.
4. Resume independently gated product work (#203, Matrix, BYO S3/Backup) and actual mobile acceptance; do not use a green integration gate to declare P4/release complete.

**Merge ancestry safety:** this Draft head intentionally remains on the existing reviewed 84-PR history, rather than fabricating a two-parent merge or squashing 890 commits. It currently introduces a newer `TS_PROGRESS_TABLE.md` while `main` independently introduced its historical version. A future authorized merge must resolve this same-path add/add explicitly and preserve the reviewed progress table; CI success alone will not certify GitHub mergeability.

**No merging of `main`, no production mutations, no functional-code changes in this preflight.**
