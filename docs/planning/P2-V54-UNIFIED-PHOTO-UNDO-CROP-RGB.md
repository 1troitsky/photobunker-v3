# P2 V-54 — unified Photo Editor 3.2 history: crop, rotation, RGB and overlays

**Status:** Product work and real-browser regressions written; exact-head CI
**PENDING**. This is a bounded history-and-replay increment, **not** a claim
that immediate continuous JPEG preview has shipped.
**Exact parent:** [Draft #159](https://github.com/1troitsky/photobunker-v3/pull/159)
@ `f9c781d61495472ce3d6dd546b2cc067c7d4f2aa`
(CI 3/3 PASS, 54/54 Chromium).
**Accepted read-only UX:** PB2 PR #56 Photo Editor 3.2 Fixed
`docs/ux/browser/editor/README.md` §§3.1, 3.2, 3.3–3.6.
**Screens/edges/journeys:** S09; N-18/N-20; J-06/J-04/J-21.

## Verified source gap

The P2 V-53 correction preserved overlays when crop/brightness/contrast/
saturation changed; however, `photo-history.ts` still recorded
**only** text, shapes, brush/eraser strokes and blackout rectangles.
A move to 90° rotation or an adjustment from 100% to 130% destroyed the
previous crop/effects state from Undo's point of view. Also, Undo/Redo
buttons existed only inside `v-if="cropResult&&cropUrl"`, so users
could not reverse changes until manually generating another JPEG.

## Contract implemented

- `PhotoEditSnapshot.view` holds only small immutable-compatible
  **crop geometry** (left/top/width/height/turns), **brightness, contrast,
  saturation** integer percentages, and the selected **aspect preset**.
  This is cloned as part of the **same bounded 50-state volatile
  history** as text/shapes/strokes/private blackout masks. No
  JPEG/source bytes, object URL, raw image, credentials or user keys
  are ever added to a history entry.
- Normal Vue `watch` batching coalesces a multi-field aspect/rotation
  change into **one** final state snapshot per synchronous UI action.
  Each real native slider input becomes a history step (oldest steps
  fall off after 50); when a user edits after undo, redo branches are
  discarded by the existing `recordPhotoEdit` implementation.
- On Undo/Redo of **only annotations**, the current correct JPEG remains
  and overlays update in-place. When a replay changes crop or RGB, it
  revokes the stale JPEG/object URL and clears its save authorization,
  updates all source-bound controls to the restored state and leaves
  the authoring layers untouched. A `restoringPhotoHistory` guard
  prevents a watcher from recording the restored state as a new edit.
- Undo/Redo now appears **outside** the conditional JPEG preview
  container. It is available before any crop is generated and after
  an adjustment invalidates an old JPEG. Before/After is disabled
  without a valid JPEG. «Сбросить аннотации» still resets **only**
  layers, and remains disabled if no layers exist even when crop/RGB
  history does.
- Source switch, logout and Editor cancel continue to reset the
  volatile history. Explicit `resetEditorDraft()` guards its grouped
  resets so a stale/foreign undo entry cannot be recorded during
  session initialization.

**Security / preview boundary:** Restoring a previous crop/effect
does **not** silently reuse or export pixels from the wrong state.
Users must run the existing locally computed
`cropPhoto → canvas → JPEG` and then the real client-side
`flattenPhotoAnnotations → encrypted Media Outbox` pipeline.
No alternative preview raster, CSS-only image filter, implicit
network upload or false cloud acknowledgement is added. The
requested **automatically updating real JPEG preview** is still
OPEN: a follow-on product increment should implement a carefully
bounded/concurrent safe raster pipeline with explicit current-version
staleness handling; V-54 is a necessary history foundation, not that
whole capability.

## Acceptance evidence

- Extended unit `photo-history.test.ts`: stage clone integrity,
  whole-state crop/rotation/RGB/annotation undo/redo and redo branch
  truncation, while keeping existing 50-record cap tests.
- Extended actual `p2-browser-photo-crop.spec.ts` (WebCrypto
  authenticated source): changes crop geometry, rotates 90°, applies
  brightness 120% and saturation 0%; Undo restores saturation 100%
  **before any JPEG exists** and Redo returns to 0%. After raster
  JPEG generation, brightness 130% invalidates the preview and Save;
  Undo → 120%, Redo → 130%, Undo → 120% restore native slider
  values, then re-render and decrypt/check genuine rotated grayscale
  JPEG. Existing E2EE metadata/source invariants remain.
- Extended `p2-browser-photo-five-shape-toolbar.spec.ts`: 90°
  rotation and undo 0° / redo 90° while retained red/green
  figure remains on the layer and final 240×320 saved ciphertext
  decodes to the correct raster. Existing blackouts, strokes, text
  and offline signed-recipient journeys remain part of the **54/54
  real Chromium** suite, retries:0.
- Exact-head CI (PHP8.4/8.5, TS/Vitest/build, Security, PG18/Garage,
  full Chromium 54) **PENDING**. Physical iOS Safari/Android, IME,
  owner visual acceptance and complete live preview **NOT TESTED /
  NOT IMPLEMENTED**.

## Parallel safety

- **Lane:** PRODUCT.
- **Branch base / SHA:** #159
  `f9c781d61495472ce3d6dd546b2cc067c7d4f2aa`.
- **Modified files:** `photo-history.ts` and corresponding unit test,
  `FileViewerView.vue`, two focused existing Chromium specs and this
  planning document.
- **Not modified:** `apps/web/src/App.vue`, router, other UX
  Settings/Appearance, image crypto/media outbox, backend/ACL/TTL,
  `docs/ux/**`, UX archival/integration map, Matrix or `main`.
- **Parallel integration #158:** its last confirmed merged head is
  `b0b7a9ffbe0b3828ce4f60de31e8f52a1bc120ed` rooted at
  PRODUCT #157, *not* #159 or V-54. It passed its own historical
  combined 60/60 but that does not verify new Photo Editor code.
  Reconciliation and independent combined-head checks remain a
  hard gate; do not mutate #158 here or falsely label it current.
- This PR stays Draft, no merge/deploy/owner production sign-off.
