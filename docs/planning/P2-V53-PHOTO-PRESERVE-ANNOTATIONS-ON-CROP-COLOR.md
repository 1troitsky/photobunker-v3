# P2 V-53 — no silent loss of Photo Editor annotations after crop/color changes

**Status:** PRODUCT safety correction with real browser coverage; exact-head CI
**PENDING**. This is intentionally **NOT** full 3.2 adjustment history.
**Parent:** exact-head [Draft #157](https://github.com/1troitsky/photobunker-v3/pull/157)
@ `b887a0ffc993ad21a23eee7cac0d24eb66488215` (**CI 3/3 PASS,
54/54 Chromium E2E PASS**).
**Accepted read-only UX:** PB2 PR #56 Photo Editor 3.2 §§3.1–3.6,
navigation S09 N-18/N-20, journeys J-06/J-04/J-21.

## Failure and production correction

**Observed source defect (not merely CSS):**
`FileViewerView.vue` watched every change to cropping coordinates, 90°
rotation and brightness/contrast/saturation. It called
`clearTextMarks()` before `clearCrop()` on every such change.
`clearTextMarks()` removes every text overlay, figure, brush/pencil/
eraser stroke, safe blackout, selected mark and the **entire 50-step
Undo/Redo history**. No warning, confirmation, saved encrypted copy or
recoverable draft was created. Consequently a user could annotate a
private photograph, adjust contrast, and silently erase all unfinished
work before the E2EE save.

**Precise product fix:** Changing the crop/effects invalidates only
the now-stale **raster** (revoke previous JPEG Blob/object URL, bump
epoch, disable Save, clear stale output/candidate saved ID). It DOES NOT
call `clearTextMarks`, so volatile text, shapes, strokes, blackouts,
selection, size/color/fill and the 50-step annotation history all
remain untouched in memory. Rebuilding from the already authorized
source image with the existing `cropPhoto` pipeline recomputes
true Canvas pixels with the chosen crop, rotation and RGB adjustment,
then reattaches the **same** annotations on the new image. A distinct
`enqueueEncryptedMedia` derivative is created only after the user
saves; the signed/immutable original is never overwritten.

When layers exist and a crop/color value changes, the editor displays:
*«Параметры кадра изменены. Надписи, фигуры, штрихи, закрытые области
и история сохранены в памяти. Нажмите „Создать JPEG-копию“, чтобы
применить настройки перед сохранением.»*
This notice is **not a fake server success**. A new JPEG must be
generated and verified before Header Save can be used; stale original
output cannot accidentally be re-enqueued.

**Boundary:** RGB adjustment/crop/rotation inputs still require explicit
`Создать JPEG-копию` to re-render. Although previously placed marks
remain in Undo/Redo, these parameters are not themselves 50-state
Undo entries, and there is not yet continuous live-render on every
slider event. PB2 3.2 §§3.1/3.2/3.6 full history and immediate-preview
parity remain a separate product work item. This PR fixes **loss of
data**, not that entire feature. It also does not persist an uncommitted
plaintext draft to IndexedDB, cloud or browser history.

## Real evidence / regression requirements

Reuses four **already selected** Chromium tests (54-suite still 54,
`retries:0`), rather than a fake isolated demo:

1. `p2-browser-photo-inline-text.spec.ts` (390px mobile):
   two captions, rename/delete and history, set selected caption red,
   font 10% with native range and Undo/Redo, change **brightness**,
   require old JPEG/Save to disappear, re-create true JPEG, check the
   same caption text/color/size and Undo survive, decrypt separately
   AES-GCM saved JPEG and count red raster pixels. Original retains
   original hash/size and no metadata inheritance.
2. `p2-browser-photo-five-shape-toolbar.spec.ts`: all five figure
   types with independent red stroke + green fill, abort pointer drag,
   apply **90° rotation**, re-create JPEG and verify same figure,
   fill/stroke/coordinates/history persist plus actual decrypted
   **240x320 rotated image** with red+green pixel counts.
3. `p2-browser-photo-strokes.spec.ts` (390px mobile): complete Brush,
   Pencil, Eraser and their Undo/Redo, then change brightness,
   re-render and ensure real paint Canvas still has alpha pixels,
   history remains, and separately encrypted JPEG still has valid
   green/red strokes and white erased center.
4. `p2-browser-photo-blackouts.spec.ts`: mask creation, delete,
   Undo/Redo and exact mask geometry, brightness + new crop, verify
   opaque-black same center and original source SHA256 byte-for-byte,
   no private metadata transfer to the new JPEG.

All 4 tests verify **real local authorized E2EE outbox**, not DOM-only
marks. Full backend/security/real PG18/Garage/Chrome CI on exact HEAD
**PENDING**; do not infer from parent #157. Physical Safari/Android,
Keyboard/IME under real on-screen keyboards and owner screenshot
acceptance **NOT TESTED**.

## Cross-lane constraints

- **Lane PRODUCT**, stacked exclusively on verified #157
  `b887a0ffc993ad21a23eee7cac0d24eb66488215`.
- **Only changed:** `apps/web/src/views/FileViewerView.vue`, the 4
  existing photo E2E cases above and this product planning doc.
  **No new CSS**, App Shell/router, WebCrypto/Media Outbox, backend,
  ACL/TTL/grants, immutable `docs/ux/**`, UX sandbox, public scopes,
  Matrix, `main` or destructive cloud operations.
- **Parallel integration:** #158 (UX+PRODUCT integrated on **#156**,
  not #157) was read before this task. Its changed-file list does
  **not** include `FileViewerView.vue` or these product E2Es.
  This new work must **not be merged independently into #158** without
  explicit reconciliation and new exact combined-head CI. Conversely,
  #158 must not be treated as already containing #157 or #159.
  No parallel agent branches were edited. Owner-reviewed release
  ancestry still required.
- **Release gate:** Draft only, no merge/deploy until all exact checks
  pass and #158 integration is resynchronized and separately accepted.
