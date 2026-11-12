# P2 V-41 — File Viewer 1.0 fixed scene and accessible information/editor sheets

**Status:** implementation and tests written, exact-head CI pending.
**Parent:** [Draft #137](https://github.com/1troitsky/photobunker-v3/pull/137)
@ `98e62fd179021885331f7e4108b0dce2695a627b` (**3/3 CI PASS, 47/47 Chromium**).
All PRs remain Draft, `main` unchanged, Matrix independently gated.

## Approved sources and cross-screen constraints

- PB2 [PR #56](https://github.com/1troitsky/photobunker-new/pull/56)
  @ `daca24a4a38c62473859b2b54b4999d50400c491`,
  `docs/ux/browser/viewer/README.md` §§1–4:
  fixed 45px path / flexible stage / 114px information strip /
  57px actions / 48px pager; Header 64px, Dock 82px.
- `docs/ux/UI-SHELL-CONTRACT.md`: production must have **one**
  app Header, Dock and status source, no duplicate demo Shell.
- Separate docs-only [#135](https://github.com/1troitsky/photobunker-v3/pull/135)
  and [#138](https://github.com/1troitsky/photobunker-v3/pull/138)
  preserve canonical source and map cross-screen transitions. This PR
  does NOT merge or modify them; maps N-15–N-20 frame the behavior.
- V-39 / V-40 already retain encrypted Browser folder, filter, search and
  scoped mixed-media pager and must not be regressed.

## Implemented vertical user journey

1. Opening a local or remotely decrypted photo/video/audio reuses the
   existing PB3 shared 64px app Header and 82px app Dock. Main gains a
   route-scoped overflow boundary, and Viewer presents the exact fixed
   `45px minmax(0,1fr) 114px 57px 48px` grid. The media types change
   *inside* the same stage. No second Header/Dock is copied from HTML.
2. The Browser path has a back link honoring V-39 one-shot return context,
   a truncated local filename (not sent in the URL) and the **existing
   explicit-confirmation** original download action. Stage fullscreen
   remains browser-native and exits without changing the viewport grid.
3. The information strip contains only **already locally decrypted**
   filename, short opaque ID display, description, capture date and
   known deletion date. A missing NAME-ID or expiry is not fabricated.
4. The 57px row has **Information / Public Card / Edit**. Information
   opens a keyboard-accessible sheet containing existing private metadata;
   Edit opens the existing production crop/annotations, WAV and video
   still-frame editors in a scrollable sheet without altering their crypto,
   local outbox or export contracts. The Public Card control is **disabled**
   pending independently verified Safe/media-grant preview; no fake link.
5. Sheet Close, Escape, focus restoration and keyboard Tab containment
   keep editor work in the current session. On file/navigation/key-package
   change the existing `clearBlob()` clears edited buffers/object URLs
   and dismisses the sheet, as before. Keyboard navigation does not
   accidentally move files while a modal is open.

## Verification

- Existing real E2E source→original→edited encrypted derivative tests are
  updated to explicitly enter the approved Edit sheet; the actual crypto,
  rendering and checksums remain unchanged.
- New Chromium `p2-browser-viewer-accepted-layout.spec.ts`: anonymous
  account, real Local-First encrypted audio+video, 390×844 mobile and
  1280×800 desktop; compare Header/Dock, exact row heights, scene
  bounds across media and info/editor sheets; confirm private info,
  disabled public preview, Escape and focus restoration.
- Required exact-head PHP8.4/8.5, TypeScript/Vitest/build, Security
  and isolated PostgreSQL18/Garage/Chromium **pending**.
- **NOT TESTED:** physical Safari/iOS/Android, device keyboard safe
  areas, motion/performance on real phones, complete Photo Editor 3.2
  separate-screen journey, complete Video/Audio Editor 1.1, full modal
  animations, working Favorites/Copy/Delete contextual Header,
  actual safe Public Card preview, NAME-ID production indexing and
  owner visual approval. Geometry correctness is not full UX signoff.

No changes to upload, signed E2EE manifests, ACL, key management, TTL,
Matrix, server storage, Public Card backend, destructive archive/GC, deploy
or `main`.
