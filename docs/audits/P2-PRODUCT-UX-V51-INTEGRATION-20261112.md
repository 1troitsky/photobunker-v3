# PB3 PRODUCT + UX — независимая интеграционная сверка (2026-11-12)

**Status:** DRAFT, not approved for merge to `main`. No production key, Storage Manager, cloud, DB, authenticated media or ACL mutations performed by this operation.

## What was combined, and why it is safe

| Stream | Immutable commit | Purpose |
|---|---|---|
| PRODUCT | `db22454cca1816a473871109f5dab3d8c9337507` · [#156](https://github.com/1troitsky/photobunker-v3/pull/156) | Latest checked functional stack: encrypted media Viewer / Editors / QA, including #140–#154 |
| UX code | `d439f1b05879ad148ce03c1d5462993fc6e1fbd0` · [#155](https://github.com/1troitsky/photobunker-v3/pull/155) | Entire verified UX chain #146→#150→#152→#153→#155; Settings, Appearance Dock, start page, search and safe retap |
| UX docs/source | `64f415f0ce92474ecc8a8c64ddb3e7482cab2168` · [#138](https://github.com/1troitsky/photobunker-v3/pull/138) | #135 canonical 117 immutable PB2 #56 source files, 22-screen registry, 48 navigation edges, human-visible 23-file map, ownership guards |
| Final #139 corrections | `82c8b1e2568f89d8bfe5e68decba91956f49afa1` · [#139](https://github.com/1troitsky/photobunker-v3/pull/139) | Closes the divergent #139-current/#140 history. Both late fixes were already present in PRODUCT code, so no downgraded Viewer code was copied |

The merge commit `c99fe952303dabf0c73306a61ce2905ba374e9ba` has **all four parent commits** in this order. Its first parent is **latest PRODUCT #156**, not the older UX-docs branch or the older #139 branch. Only the strictly reviewed UX/doc file deltas are transferred into PRODUCT's tree.

### Verifiable file-level reconciliation

- **31 UX files** changed from the common #145 ancestor `d62c4cae` to #155.
- **133 source / docs / guards** changed from #134 `07fa2832` to #138: **117 files under `docs/ux/`**, 14 under `docs/ux-integration/`, 2 isolated UX Actions workflows.
- **0 overlapping changed paths** between UX and docs; **0 concurrent product modifications** to any selected UX or docs path since the relevant common ancestor. Every selected blob was copied by **exact Git blob SHA**, not reconstituted from an HTML mockup.
- Preserved exact PRODUCT SHA for `apps/web/src/views/FileViewerView.vue` = `982d279f66cfb0f467e31fa320860dc1e6914c25`. The global `apps/web/src/styles.css` also remains unchanged from #156.
- Original `docs/_uiux/` has **23 root HTML files excluding logo**, covered by the #138 visual map integrity check. The unhelpful standalone `tools/ux-review/` from now-closed #142 **was not imported**.
- The special #139 patches are **already in PRODUCT**: `FileViewerView.vue` permits Ctrl/Cmd+Z inside editor sheets without file hopping; `p2-browser-safe-recipient.spec.ts` explicitly opens Editor via `viewer-action-edit`. The #139 HEAD is an explicit parent so Git ancestry no longer hides its late two commits.
- PRODUCT's browser media, crypto/ACL/TTL/outbox, PHP server, `tests/e2e/p1-*`, `tests/e2e/p2-browser-*` are **not overwritten** by stale UX source. The UI integration uses **real Vue routes**, not a demo/proxy file viewer or a replacement encrypted storage pipeline.

### Known runtime UX scope and limitations

| Area | Integrated code | NOT accepted / excluded |
|---|---|---|
| Settings hub | Existing Key-Only Identity remains intact, Contacts links to real `/contacts` | Profile 1.6 WIP card, PIN/Security, Notifications, Help, Billing views remain unimplemented/not fake routes |
| Appearance | Device-local validated Dock 3–6, mandatory movable Settings, preview/cancel/save; start page Camera/Tasks/Browser saved atomically with Dock | Full theme, accent, text size, language i18n, cross-device preferences |
| Search | RU/EN synonyms and **exact** Dock / Start Page field navigation with focus | Unavailable settings stay clearly marked, not clickable |
| Shell | One shared Header/Dock; safe active Dock retap with existing editor leave guards | Physical mobile touch, Safari, Android native back testing not performed |
| Media editors | **Existing #156 PRODUCT code unchanged**, including its E2EE derived-file flows | MP4 clip export not magically added; no UX prototype used as real data |

### QA history and fresh merged-head release gates

Known previous UX #155 CI: original code `7cca9e45` had two flaky full Chromium attempts (54/56, 55/56), recorded in [UX-05 audit](P2-UX05-DOCK-RETAP-CHROMIUM-20261112.md). **Later docs-only head `d439f1b0` completed 56/56 real Chromium PASS**. PRODUCT #156 latest head individually had 3/3 PASS. Neither independently green result proves the **combined** code.

**The integration is not mergeable until all of the following are met:**
1. Frontend strict TypeScript/Vitest/build and PHP8.4/8.5/Laravel runtime floors pass on the **final integration HEAD**.
2. P0 Security floor passes without bypass, including unchanged recipient and identity paths.
3. Real PostgreSQL18/Garage and the **full** Chromium P1+Browser+Settings E2E pass on the exact combined SHA, without skipped, deleted or weakened safety tests.
4. UX source integrity, links and 22/48/23 mapping pass; UX lane/ownership preflight passes.
5. Manual visual review, mobile widths, real Safari/iOS and Android, editor unsaved-change leave flow and any release-specific offline/policy checks are accurately marked NOT TESTED until performed.
6. Confirm current product latest head has not moved before accepting this PR, reconcile any newer product changes, and obtain owner approval for merge. **Never auto-merge the independent PR chain to `main`.**

Evidence of the final integrated CI run should be appended to this report or PR description after it is available. Historical CI failures must remain documented.

### Branch ownership / next development

- Single Draft integration target: `integration/ux-product-v51-reconciled`, base `p2/photo-editor-draw-three-tools-row` (PRODUCT #156).
- No changes to the independent #139/#140/#146/#155/#138 branches.
- New PRODUCT editor work should continue on latest product head; integrated UX work should rebase/merge from here only after checking current open PRs and overlap.
- Matrix remains a separate scope; new source docs do not imply it is enabled.

---

## V52 integration update — PRODUCT PR #157, 2026-11-12

Product [#157](https://github.com/1troitsky/photobunker-v3/pull/157) @ `b887a0ffc993ad21a23eee7cac0d24eb66488215` extends #156 with genuine Photo Editor text **Color + Size** toolbar and encrypted JPEG proof. Its own exact-head CI: **3/3 PASS**, **54/54 real Chromium E2E PASS** ([Actions 43169529825](https://github.com/1troitsky/photobunker-v3/actions/runs/43169529825)).

**Checked product delta:** only `apps/web/src/styles.css`, `apps/web/src/views/FileViewerView.vue`, `tests/e2e/p2-browser-photo-inline-text.spec.ts` and `docs/planning/P2-V52-PHOTO-TEXT-COLOR-SIZE-MOBILE.md`. Before adding these four exact V52 Git blob SHAs, the integrated tree contained the identical blob SHAs of PRODUCT #156 for the three pre-existing paths; the fourth path did not exist. Thus no UX or accepted source changes collide with #157.

Integration branch now adds a dedicated **two-parent merge** of the previous four-parent V51 integration commit chain and PR #157. The **resulting V52 tree includes the entire #157 product code exactly**, plus UX #155 and approved #138 source files. **Do not infer V52 CI PASS** from PR #157 (independent) or the earlier V51 integration run; full combined V52 CI on the final head is mandatory.

For final review, PR #158 should target the V52 product branch `p2/photo-text-color-size-mobile-row`. Before any main merge recheck whether product has advanced again; the frozen V52 integration is a checked snapshot, not authority to auto-merge future PRs.


### Combined V51 Chromium QA finding and precise test stabilization

The **first combined V51** workflow [Actions 43169926565](https://github.com/1troitsky/photobunker-v3/actions/runs/43169926565) completed **59/60 Chromium PASS, one FAIL** in the unchanged `tests/e2e/p2-browser-file-viewer-index-target.spec.ts:109`. The failure is a Playwright **strict mode selector ambiguity**: `getByRole('status')` matched two status elements (Viewer loading indicator and the *expected* forged-page rejection warning). The warning `Ранее проверенные файлы и курсоры сохранены.` was present. PRODUCT Viewer code was not changed in this integration.

A **narrow test-only stabilization** now locates the specific warning using `getByRole('status').filter({hasText: ...})`, preserving the exact rejection text assertion, `badPageDelivered > 0`, unchanged `50 / 50` cursor position and continuing E2EE audio preview. It does **not** skip, reduce timeouts, disable role checks, alter Viewer code, or change crypto/security behavior. This is the same root cause as the older #146/#155 intermittent page-index test failure; the present integration fixes only the broad selector.

This change is scoped **inside the combined integration/QA branch** (NOT to product #154/#157 or to `main`). Final exact-head V52 full suite must pass after the change; previous attempts remain historical evidence.
