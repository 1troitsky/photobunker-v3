# Parallel PB3 development — UX / product coordination contract

**Effective 2026-11-12; anchored on docs-only PR #138.** This controls future parallel PB3 changes. It does not retroactively rebase or modify existing PRs. Owner-approved UX lives in [../ux/](../ux/) (PB2 #56 copy), mapped by [screen registry](SCREEN-REGISTRY.md), [navigation edges](NAVIGATION-MAP.md), and [user journeys](USER-JOURNEYS.md).

## The conflict we are preventing

The existing **product** stack is not UI-free:
- [#134](https://github.com/1troitsky/photobunker-v3/pull/134): verified Viewer cursor/deep-link logic.
- [#136](https://github.com/1troitsky/photobunker-v3/pull/136): Browser→Viewer return context.
- [#137](https://github.com/1troitsky/photobunker-v3/pull/137): filtered/folder-scoped Viewer neighbors.
- [#139](https://github.com/1troitsky/photobunker-v3/pull/139): **already implements part of accepted File Viewer 1.0 UX**; modifies `App.vue`, global `styles.css` and `FileViewerView.vue`.
- [#140](https://github.com/1troitsky/photobunker-v3/pull/140): Viewer arrow/swipe navigation via replace rather than push; modifies `FileViewerView.vue`.
These are stacked, and a later product PR may already have started. **Always query the current open PR list and diff before claiming an area unowned.** Do not restart any of these features from older #134 UX map snapshots.

The separate documentation branch is [#135](https://github.com/1troitsky/photobunker-v3/pull/135) → [#138](https://github.com/1troitsky/photobunker-v3/pull/138), currently based on #134. The two **heads diverge**. The UX branch must not overwrite newer product files by stacking code onto #138 and assuming it is the latest runtime.

## Lane ownership (required for new work)

| Area | Product lane (`p2/*`) | UX sandbox lane (`ux/*`) |
|---|---|---|
| Browser/Viewer, editors, encryption, file/outbox, navigation context, app route state | **SOLE IMPLEMENTER while product stack active**. Use latest relevant product head and its tests. | Read, audit, write specs/test plans; **no modifications** of existing runtime files. |
| `apps/web/src/App.vue`, `apps/web/src/styles.css`, `apps/web/src/router.ts` | **Reserved** for product/integration lane until planned handoff. | No edits, no Shadow Header/Dock or runtime router. |
| `apps/web/src/views/*`, existing `features/*`, `apps/api/**`, existing `tests/**` | Product/integration lane | No edits, no duplicate version of established flows. |
| Immutable `docs/ux/**` sources and `docs/_uiux/**` | No edits (original approved archive). | No edits; exact source SHA verified by CI. |
| `docs/ux-integration/**`, `tools/ux-review/**`, `tests/ux-review/**` | Reference only unless synchronizing shared contracts | **UX owner**: visual review, scenario mapping, source provenance. |
| **New isolated** `apps/web/src/ui/fieldwork/**` | Can later integrate components through a dedicated handoff | **UX owner**: purely presentational components; no route/store/API/crypto access; not wired into production yet. |

**Hard automated rule:** new `ux/*` PRs may change **only** those four UX sandbox directories. CI fails if they touch reserved/shared product paths, including `App.vue`, `styles.css`, `router.ts`, `FileViewerView.vue` or original `docs/ux/`. The allowed roots are stored in [WORKSTREAMS.json](WORKSTREAMS.json) and enforced by [check-pr-lane.mjs](check-pr-lane.mjs) / [GitHub Actions](../../.github/workflows/ux-lane-guard.yml). Branches not inheriting this workflow are not protected retroactively; do not claim otherwise.

**No duplicate work rule:** every new UX task must cite screen ID + navigation edge(s) + journey(s) and identify existing product PR implementation. If the action/edge is already being implemented in `p2/*`, UX work is limited to review and acceptance evidence, **not** another implementation.

## Safe workflow for each next PR

1. **Discover** the newest relevant product Draft PR(s), head SHA, base branch, touched files and covered edge IDs (do not trust old handoffs alone).
2. **Claim** a narrow, nonoverlapping scope, record owner, references, exact base SHA and *excluded paths*. If a live product PR already owns it, do not open a duplicate UX implementation.
3. **Choose lane**:
   - `ux/<name>`: base on current #138 UX docs head (or its updated successor). Edit only UX sandbox directories. Isolated previews/tests may be run without shipping production routes.
   - `p2/<name>`: for product functionality; extend the **latest relevant product stack**, not #138's older runtime tree.
   - `integration/ux-<name>`: when both streams are ready to connect. Start from the **latest verified product HEAD** (currently #140, subject to change), import documentation/isolated components from UX by **selective cherry-pick** or conflict-reviewed merge, and explicitly verify the resulting diff. Do not merge the whole stale #138 runtime snapshot over newer product code.
4. **Preflight diff** against the intended base and active other lane: if any **shared file** is changed in both, stop, select one owner and move the second implementation into a reviewed integration PR. Git can merge two clean text patches yet still create a **semantic conflict**; compare behavior, not only conflict markers.
5. **Implement without architecture drift**: never replace real E2EE/ACL/TTL/outbox/Local-First with prototype state. If a UX source contradicts product security, record an open decision.
6. **PR handoff:** use the pull request body fields below and link product parent, UX baseline, affected edges/journeys, changed paths, duplicated-work check and CI status. The agent creating the *next PR* must read this protocol before starting.
7. **Integration acceptance:** only after latest product baseline is fixed, combine code; run TypeScript/build, affected unit/E2E, encryption/security, UI visual/regression and real-device tests as appropriate. Update map status **after** evidence. Do not merge into `main` automatically.

## Required PR body block

```md
### PB3 cross-lane preflight
- Lane: PRODUCT | UX-SANDBOX | UX-INTEGRATION
- Source PR / exact base SHA:
- Screen IDs / nav edges N-__ / journeys J-__:
- Existing ownership checked: PR #... (files and implemented behavior):
- Scope — I WILL change:
- Scope — I WILL NOT change:
- Overlap with other open PRs: NONE | DECLARED + resolution:
- New UX changes: accepted baseline links or WIP/owner decision:
- Verification: CI, E2E, offline/reload, visual/device; NOT TESTED stated:
```

## Current allocation & next steps

- **Product lane owns N-15–N-20 (Browser/Viewer/Editor handoffs) and N-16/N-17 history**, including visual File Viewer work in #139 and Back in #140. This is **in-progress**, *not* fully accepted screen UX.
- **UX sandbox** can build a read-only interactive review, screenshot comparison framework, design tokens and isolated presentational components. It must **not** independently implement another File Viewer, Back handler, media editor data pipeline or App Shell in production now.
- Profile 1.6 is WIP, Messages 1.1 Beta and Matrix deferred. Public Card preview vs public grant remains separate. Do not fill these gaps by assuming approval.
- Product lane will continue current Browser/Viewer sequence; UX lane starts by verifying correctness and highlighting deficiencies, not duplicating work.
- Before any production integration PR, refresh [GAPS-AND-DECISIONS.md](GAPS-AND-DECISIONS.md) with exact active product HEAD, compare both branch diffs and record a one-owner path plan.

### Enforcement limits

The guard prevents accidental UX-sandbox edits in shared paths **only when its CI is present on the PR**. It cannot prevent another agent from independently opening an unrelated product PR or duplicating logic in a different filename. Cross-lane preflight, current PR comments and mandatory human review remain necessary. We can add repository-level required checks/branch protection later, but do not assert it is configured now.
