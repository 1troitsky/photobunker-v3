# P2 V-44 — Editor 3.2 / Media Editor 1.1 integration preflight (no runtime)

**Classification:** PRODUCT lane planning / implementation audit, **not code integration or UX acceptance**. 
**Exact parent:** Draft [#141](https://github.com/1troitsky/photobunker-v3/pull/141)
@ `2e40c7097ac0fcad477302b56df1f59a1541369d` (3/3 CI PASS, 48/48 Chromium E2E).
**Sources:** read-only PB2 [PR #56](https://github.com/1troitsky/photobunker-new/pull/56)
@ `daca24a4a38c62473859b2b54b4999d50400c491`;
`docs/ux/browser/editor/README.md` (Photo Editor 3.2 Fixed, SELECTED design),
`docs/ux/browser/media-editor/README.md` (Video & Audio Editor 1.1, ACCEPTED UX),
`docs/ux/UI-SHELL-CONTRACT.md` (one Header/Dock).
Parallel-work contract is [#138 `PARALLEL-WORK-PROTOCOL.md`](https://github.com/1troitsky/photobunker-v3/blob/docs/pb3-ux-cross-screen-map/docs/ux-integration/PARALLEL-WORK-PROTOCOL.md)
@ `f03d3741509dc9f28f8cac8b2506cbe8820676b6`.
**Screen IDs:** S08 File Viewer, S09 Photo Editor, S10 Video/Audio Editor.
**Edges:** N-15, N-17–N-20; **Journeys:** J-06 and J-07 (with J-04, J-21 regression).

## Verified current product ownership — do not duplicate

| PR | Area already handled | Changed paths / protected functionality |
| --- | --- | --- |
| #136 / #137 | Browser→Viewer return; scoped mixed-media neighbor order | `PhotoBrowserView.vue`, `FileViewerView.vue`, `browser-return-context.ts`, E2E |
| #139 @ `82c8b1e2` | One 64px/82px Shell, File Viewer 45/1fr/114/57/48 scene, info/edit sheets, Escape & undo, updated real E2E | `App.vue`, `styles.css`, `FileViewerView.vue`, photo/audio/video/Safe-only E2E |
| #140 @ `17b0e478` | In-view arrows/swipes via `router.replace`; native Back to original Browser scope | `FileViewerView.vue`, scoped pager/Safe-only E2E |
| #141 @ `2e40c709` | Four contextual actions in **existing** Header; real confirmed download and gated Favorite/Copy/Delete | `App.vue`, `FileViewerView.vue`, `viewer-shell-actions.ts`, CSS and E2E |
| #135 / #138 | Exact immutable 117 source files and 22-screen/48-edge cross-screen UX map | UX documentation and lane guard; **not production runtime** |

**Important dependency hazard:** current `#140` history descends from an earlier
`#139` commit `13286fc`, while `#139` HEAD is now `82c8b1e2`.
`git compare 82c8b1e2...17b0e478` reports **diverged** (5 ahead / 2 behind).
Some final `#139` fixes were repeated in `#140`; even a text-merge without conflict
must not be considered proof of behavioral equivalence. Before merging,
a single product owner should reconcile the stacked ancestry and rerun exact-head CI.
This preflight does **not** alter either live branch, any base, or `main`.

## Actual PB3 editor baseline (from #141 source code)

- `apps/web/src/router.ts` routes `/browser/file/:protocol/:id` to File Viewer;
  **no production S09 or S10 routes** exist.
- `FileViewerView.vue` currently owns both the Viewer and its scrollable **Edit**
  sheet. There are no separate accepted 3-tab editor pages, no standalone
  Cancel/Save header, and no production navigation guard preserving an editor
  draft across Viewer↔Editor transitions.
- The working **photo** pipeline already has JPEG crop/rotate, brightness/
  contrast/saturation, brush/pencil/eraser, editable text and shapes,
  blackout masks, before/after, undo/redo, E2EE **separate JPEG derivative**
  save/download, Safe candidate local intent and real Chromium evidence.
  **Do not reimplement compositing, key management or outbox** from prototype JS.
- The working **audio** pipeline can select start/end, decode a bounded source,
  generate PCM WAV, preview, encrypt/save as a distinct Browser file and
  download with explicit confirmation. It is not a full editor 1.1 tabbed UI.
- The working **video** pipeline supports playback, extracted JPEG still
  frame, separate encrypted save and download. **Video trim bounds, clip
  preview and apply behavior are not wired** in the current Viewer editor.
  Do not claim MP4 re-encoding from the demo; that was never accepted.
- The Viewer info sheet **reads** decrypted name/description/category/tags,
  capture/expiry and GPS. This is not the accepted editable Information tab
  with server-policy checked metadata mutation.
- The accepted **Review** tab, curator decisions/audit/permissions and the
  Public Card policy controls are not implemented just because the HTML
  prototype contains them.

## Required invariants / safety conflicts to settle

1. Single `App.vue` Header + Dock; editor gets **contextual** text Cancel
   and green Save, not a cloned shell. Use the same transparent Browser
   pathbar and exact S09/S10 title and three tabs.
2. New editor entry must preserve **the same authorized media ID/version**
   from S08, Browser-origin folder/filter/history context, and the last
   Viewer. Editor Back/Cancel returns to the same Viewer after a draft guard;
   the editor must never grant read rights from an opaque ID alone.
3. Save must mean an **actual encrypted durable outbox revision/derivative**,
   with explicit distinction between local queued status and server receipt.
   No prototype `fieldwork-file-editor-browser-v1` IndexedDB, synthetic
   upload success, original overwrite or change in TTL/ACL defaults.
4. The Photo Editor 3.2 prototype has an **auto-renew checkbox**, but PB3
   `ts.md` §13 and later product policy say auto-renew is **system-managed
   without a user toggle**. This conflict is resolved in favor of the newer
   production contract: **do not add the old checkbox** or pretend there
   is user-controlled entitlement.
5. Title, category, GPS, tags, assignment transfer, expiry and review actions
   may be exposed for editing **only after** the existing relevant server
   policy, role, revision conflict and E2EE metadata mutation can enforce
   them. Otherwise show read-only, scoped state; do not save a cosmetic copy.
6. Original/safe versions and Public Card are independent authorizations.
   Never expose original or EXIF merely because the Editor can render a file.
   Preview is not publication; unsafe public-video/audio scopes remain gated.

## Non-overlapping execution plan

**V-44 (this PR):** Documentation-only product preflight. Allowed changed file:
`docs/planning/P2-V44-EDITOR-INTEGRATION-PREFLIGHT.md` only. No touched runtime
or `docs/ux-integration` (UX-lane-owned), no `docs/ux` source mutations.

**V-45 (later, product lane):** After refreshing the latest product head and
resolving parallel ownership, extract the *already verified* photo/audio/video
editor domain routines into shared product composables **without changing
cryptographic semantics**. Preserve all existing S08 editor-sheet tests
until the new S09/S10 journeys work. Avoid a second media processing pipeline.

**V-46 (later, product integration):** Implement S09/S10 editor routes and
canonical 3-tab composition using production components; wire File Viewer
Edit to the appropriate route, real Cancel/Save and exactly-once return.
Set route-aware contextual Header via the existing shared-shell mechanism.
Do not wholesale copy autonomous HTML or overwrite the #139/#140 scene.

**Acceptance:** Chromium tests for Viewer→Photo Editor→masked JPEG save/cancel
→same Viewer/photo→Browser original folder, and Viewer→audio/video Editor→
WAV/still encrypted derivative→same Viewer. Verify mobile 390px,
desktop 1280px, keyboard, no unsaved draft loss, offline/reload, signed
ACL/TTL/identity changes and no unencrypted browser storage. Physical
Safari/iOS/Android, portrait/landscape and owner visual comparison remain
**NOT TESTED** until independently run.

## Cross-lane status

- **Lane:** PRODUCT preflight; no duplicate UX sandbox implementation.
- **Source PR:** #141 `2e40c709`, not older #134/#138 runtime.
- **Other-lane ownership:** `docs/ux-integration/**`,
  `tools/ux-review/**`, `tests/ux-review/**`,
  `apps/web/src/ui/fieldwork/**` belong to UX SANDBOX; not touched.
- **Runtime reserved:** `App.vue`, `styles.css`, `router.ts`,
  `views/*`, `features/*`, `apps/api/**`, functional `tests/**`
  belong to active PRODUCT; this PR deliberately edits none.
- **Overlap:** NONE in this doc-only PR. Editor runtime path overlap
  DECLARED for later PRs, **requires a single owner** and exact latest
  product base; no parallel duplicate implementation.
- **Verification:** file scope/source/PR ancestry reviewed. No new
  code or claims of production editor/UX acceptance. CI for this head
  must be checked independently before marking any status PASS.
