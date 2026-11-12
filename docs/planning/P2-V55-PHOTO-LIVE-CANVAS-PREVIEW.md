# P2 V55 — real-time bounded photo Canvas preview (2026-11-12)

**Status:** implementation in isolated Draft; combined exact-head CI **PENDING**.

**Parent:** verified combined Product V54 + QA + accepted UX PR #187 @
`7a309508cc140897ae6dd75f8d473a89c7296be2`, 4/4 workflows PASS,
354/354 Vitest, 60/60 real Chromium. `main` and parallel lanes untouched.

## Accepted behavior and scope

Source of truth: `docs/ux/browser/editor/README.md` §§3.1–3.6 (Fieldwork 3.2),
S09/J-06/J-21. Crop, 90° rotation and three RGB adjustments respond in
the visible preview immediately, before any user-initiated JPEG export.
The overlay follows the same source raster, layer and blackout order as
the real encrypted derivative; it does **not** replace signed source pixels.

- New `photo-live-preview.ts`: exact shared `cropGeometry()` and
  `adjustPhotoPixels()` (no CSS-only approximation), drawing shapes,
  strokes on an isolated transparent layer, text, then opaque blackouts.
  Bounded to **1024 px on either edge and 1,048,576 pixels total**,
  preserving portrait/landscape rotation. No network request, Blob/JPEG,
  object URL, LocalStorage/IndexedDB write or OS-gallery export.
- `FileViewerView.vue`: local `requestAnimationFrame` coalescing,
  dedicated volatile Canvas, source/identity/file epoch checks. Frames
  from a superseded source are rejected, canvas is zero-sized on lock/
  route/unmount/switch, errors never display partial pixels. Changing
  crop/RGB keeps annotations/Undo in memory and **invalidates the
  old JPEG**; live preview does not enable Save or cloud sync.
- `Создать JPEG-копию` remains an explicit step; it uses the existing
  full-resolution bounded encode and existing E2EE outbox. A preview
  is **not** proof that a derivative was created/uploaded.
- This phase shows existing annotations in a read-only live raster after
  crop/RGB changes; editing layers still uses the current prepared JPEG
  composition screen. It does not persist uncommitted drafts or modify
  50-entry Undo/Redo rules.

## Verification

1. Pure unit tests verify geometry, no upscaling, rotation swaps,
   1024 px/1 MiPixel bounds, malformed coordinates fail before rendering.
2. Existing real-browser crop+RGB+Undo/Redo+AES-GCM E2E now requires
   non-JPEG live canvas with correct dimensions and grayscale **pixels**
   before pressing Create; changing brightness updates displayed pixels
   while Save stays disabled. Original & encrypted derivative assertions
   remain unchanged.
3. Existing blackout E2E requires black RGB pixels in the **live** canvas
   after adjusting brightness, before re-creating/saving JPEG.
4. Release gate: exact-head PHP 8.4/8.5, strict Vue TS+build, Vitest,
   security, UX lane/source integrity, PostgreSQL18/Garage and full
   60 Chromium E2E with no test retries, skips or mocked auth. Manual
   iOS/Safari/Android, keyboard and owner visual acceptance **NOT TESTED**.

**Ownership:** PRODUCT lane. Changed only
`apps/web/src/features/browser/application/photo-live-preview.ts`,
`photo-live-preview.test.ts`, `apps/web/src/views/FileViewerView.vue`,
the two existing Chromium tests and this planning document. No edits
to E2EE Media Outbox, auth/ACL/TTL, accepted `docs/ux/**`, App Shell,
navigation, Matrix, Administration, Notifications or `main`.
