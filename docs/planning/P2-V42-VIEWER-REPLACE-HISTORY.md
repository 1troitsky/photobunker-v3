# P2 V-42 — File Viewer arrow/swipe navigation without browser-history pollution

**Status:** code and real-browser regression test written; exact-head CI pending.
**Parent:** [Draft #139](https://github.com/1troitsky/photobunker-v3/pull/139)
@ `13286fc272ad4fe9dfc9e0a869847fb3be948715` (V-41 fixed
File Viewer scene and editor sheets). `main` unchanged.

## Accepted behavior

PB2 PR #56 `docs/ux/browser/viewer/README.md` §2 and the
cross-screen map in independent docs-only PR #138 N-15–N-17:
File Viewer arrows/keyboard/swipes move between authorized media
inside **one viewing journey**. After browsing several files, native
browser Back must return to original Browser folder/filter/search,
not step backwards through every individual media item.

## Change

- `navigate()` now calls Vue Router `replace`, not `push`, for
  previous/next, keyboard left/right and horizontal photo swipes.
  Opening File Viewer from Browser still uses the existing `RouterLink`
  **push**: there remains one real entry to go back to.
- File Viewer route watcher still resets the previous decrypted object
  URL, stops old media, fetches/decrypts each new item, checks current
  account/device and signed manifest/receipt/TTL and server read ACL.
  V-39/40's one-shot Browser return and last visible file tracking
  remain intact; this is navigation-only, no authorization shortcut.
- Existing real Chromium
  `p2-browser-viewer-origin-scoped-pager.spec.ts` now navigates to
  second E2EE audio file and calls actual `page.goBack()`, requiring
  Browser + original encrypted folder/filters and no intermediate Viewer
  history entry.

**Verification:** exact-head TypeScript/Vitest/build, PHP8.4/8.5,
Security, PostgreSQL18/Garage and 48+ Chromium E2E pending.
Real Safari/iOS/Android back-swipe gestures not independently tested.

No `main` merge, deploy, Matrix, Public Card, physical GC or key
changes. Draft only.
