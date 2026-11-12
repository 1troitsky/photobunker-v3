# P2 V-50 — Photo Editor 3.2: five figure tools, stroke/fill rows, safe gesture cancellation

**Status:** PRODUCT runtime and real Chromium regression written; exact-head CI **PENDING**.
**Product parent:** [Draft #149](https://github.com/1troitsky/photobunker-v3/pull/149)
@ `37f6c9aa018b5919a5c05ddf2b323972f2893fda` (**CI 3/3 PASS, 53/53 Chromium**).
**Owner-selected UX source (read-only):** PB2 PR #56
@ `daca24a4a38c62473859b2b54b4999d50400c491`,
`docs/ux/browser/editor/README.md` §3.5 (Photo Editor 3.2 Fixed).
**Screens / edges / journeys:** S09 (Photo Editor), N-18/N-20,
J-06 (photo editing) and J-04/J-21 return/privacy regression.

## Approved UX contract implemented

- **Exactly five compact buttons on a SINGLE horizontal row**:
  Стрелка / Круг / Квадрат / Треугольник / Звезда. Every button
  has a recognizable symbol, a Russian visible name and accessible
  name, focus outline and `aria-pressed` for the selected type;
  layout remains five columns at 390px mobile and desktop.
- With no selected shape, pressing a type creates ONE shape of that
  kind. With a selected shape, pressing another type changes **that same
  shape**, without generating a duplicate or breaking its coordinates,
  fill or border. The previous **«Добавить фигуру»** button remains
  available for creating another mark. The existing mark list and
  deletion actions remain connected to the very same model.
- **Second line:** independent border color picker + border-width
  slider, side by side. **Third line:** fill color picker + checkbox
  **«Залить фигуру»**, side by side with checkbox at right.
  Fill is **disabled by default**; the underlying `PhotoShapeMark`
  already stores independent stroke, strokeWidth, fill and filled.
  Existing X/Y/W/H fields remain below as advanced geometry controls.
- Mouse/touch moves continue to reposition the same SVG overlay and
  commit only a completed gesture to the existing 50-step annotation
  history. Newly corrected `pointercancel` restores original
  X/Y and **does not** push an incomplete gesture to Undo.
- The selected shape is composited by the **existing production**
  `drawPhotoShapes` raster into the separate AES-GCM JPEG derivative,
  with separate encrypted MediaFile ID, no original overwrite,
  metadata/assignment/GPS inheritance, public scope changes or
  false Garage ACK.
- No additional text/shape storage model, unencrypted IndexedDB marks,
  second raster encoder, new crypto operations or layout-level fake
  success is introduced.

## Evidence and acceptance

- Updated existing real Chromium `p2-browser-photo-shapes.spec.ts`:
  original signed encrypted JPEG -> Editor -> create figure, select
  circle using the new **5-button toolbar**, set stroke/fill, drag
  and decrypt an actual red-outline/green-fill JPEG derivative.
- New `p2-browser-photo-five-shape-toolbar.spec.ts`:
  create private encrypted 320x240 JPEG; verify five buttons in
  one horizontal mobile 390px row, no horizontal overflow, one
  selected figure as type changes across all five, independent
  visible stroke/fill rows and defaults, border color/width and
  optional fill, geometry, Undo/Redo, interrupted pointer drag
  rollback, real offline E2EE save, decrypted red/green pixels,
  no inherited private source tags/GPS/assignment, and Browser
  return without duplicate media history.
- Preserve all previous 53 Chromium Editor, JPEG, WAV, WebM,
  Browser/Viewer, ACL and Local-First journeys: exact-head target
  **54/54 real Chromium E2E** plus PHP8.4/8.5, strict TS/Vitest/build,
  security and PostgreSQL18/Garage. CI **PENDING**, not claimed PASS.
- Real iOS Safari PWA / Android touchscreen gesture, owner
  side-by-side screenshot acceptance and full Photo Editor 3.2
  pixel parity **NOT TESTED**. UI comparison is not yet owner accepted.

## Cross-lane preflight

- **Lane:** PRODUCT, based on exact verified parent #149
  `37f6c9aa018b5919a5c05ddf2b323972f2893fda`.
- **Changed scope:** `apps/web/src/views/FileViewerView.vue`,
  `apps/web/src/styles.css`, focused functional Chromium tests
  and this new product planning document.
- **Excluded unchanged paths:** `apps/web/src/App.vue`,
  `router.ts`, all media AES-GCM/outbox/domain shape raster files,
  `apps/api/**`, key management, server ACL/TTL,
  accepted original `docs/ux/**`, UX-only
  `docs/ux-integration/**`, `tools/ux-review/**`,
  `tests/ux-review/**`, `apps/web/src/ui/fieldwork/**`, Matrix
  and `main`.
- **Live parallel lanes checked:** #146 Settings + Contacts and
  #150 Appearance / dynamic Dock. They modify **no Viewer,
  PhotoShape domain or global styles.css**; no file overlap with
  this PR. Work remains on product-owned editor branch and is not
  a second UX sandbox implementation.
- Historical #139/#140 ancestry divergence and independent #146
  CI flakiness remain separate **pre-merge gates**. Neither
  branch is rebased/merged/changed here.
- No owner-approved status promotion, merge, deploy or physical
  cloud deletion; PR remains Draft until explicit review.
