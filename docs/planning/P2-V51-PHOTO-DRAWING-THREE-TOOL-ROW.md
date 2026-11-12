# P2 V-51 — accepted Photo Editor 3.2 drawing controls and interrupted strokes

**Status:** PRODUCT UI/tests written; exact-head full CI **PENDING**.
**Parent:** [Draft PR #154](https://github.com/1troitsky/photobunker-v3/pull/154)
@ `1f4c6a1d5ece34b203e6cb1bf97d26da5e3ba86d`:
**CI 3/3 PASS**, **54/54 real Chromium twice** (jobs
`131004184233` and `131006319322` on run 43164840541).
**Owner-selected design:** immutable PB2 PR #56
`docs/ux/browser/editor/README.md` §3.3 / Photo Editor 3.2 Fixed.
**Screens/edges/journeys:** S09, N-18/N-20, J-06 and J-04/J-21 regressions.

## Product implementation

- **One-row** group with three separate accessible icon+label buttons:
  **Кисть / Карандаш / Ластик**. Native SVG vector icons (not platform-
  dependent emoji), Russian labels, `aria-pressed`, focus-visible
  and compact, minimum-height touch targets. Phone width 390px and
  desktop show exactly 3 columns, no accidental wrapping.
- Directly below in a **single two-column horizontal row**:
  **Цвет + Толщина**. The generic photo editor form's 1-column mobile
  media rule is overridden for only these controls; other Photo Editor
  form layouts remain unchanged.
- This is presentation, **not** an invented new drawing engine. The
  previously implemented `PhotoStroke` canvas pipeline, Pencil/Brush
  paint distinction, eraser restricted to the paint overlay,
  50-entry Undo/Redo, bounded point counts, pointer capture and
  separate AES-GCM JPEG derivative are untouched. The original photo,
  E2EE contract, metadata, GPS, assignment and public sharing scopes
  do not change. No plaintext/draft is put in IndexedDB.
- Existing cancellation handler
  `finishPaintStroke(event,true)` already discards the partial draft
  on `pointercancel`; this PR adds a **real browser acceptance test**
  to lock that behavior without changing proven production logic.

## Browser acceptance

The existing full
`tests/e2e/p2-browser-photo-strokes.spec.ts` still exercises an
authenticated AES-GCM private JPEG through Browser → Viewer → Photo
Editor. The test now explicitly runs at **390x844**, checks SVG icons,
all three buttons share a horizontal row, **Color + Thickness** are
side by side without overflow, and a real pointer-canceled brush
stroke contributes **zero** painted pixels and no Undo step.
Then it draws actual green Brush + red Pencil, erases only paint,
verifies Undo/Redo and decrypts the separately queued JPEG to compare
real colored pixels, unchanged source metadata and absence of
plaintext in the durable encrypted outbox. Real device-native
Safari/Android pointer behavior is **NOT TESTED**.

- Total Chromium suite remains **54 existing tests**; no test excluded
  or renamed, `retries:0`, genuine MediaRecorder/server checks
  from QA #154 remain intact.
- Exact-head PHP8.4/8.5, TypeScript/Vitest/build, Security and real
  PostgreSQL18/Garage/Chromium **PENDING**.
- Owner visual pixel matching, touch screen and IME are not claimed.

## Parallel lanes

- **Lane PRODUCT**, stacked exclusively on verified #154, not
  UX sandbox #138 or Settings #146/#150/#152/#153.
- **Changed:** `apps/web/src/views/FileViewerView.vue`,
  `apps/web/src/styles.css`,
  `tests/e2e/p2-browser-photo-strokes.spec.ts`,
  and the inherited QA-controlled
  `tests/e2e/p2-browser-viewer-origin-scoped-pager.spec.ts`,
  plus this document. The latter change is limited to waiting for
  completed session bootstrap and treating ONLY the crypto layer's
  expected `identity.account_changed` mid-decrypt as a transient
  poll state; every final filename remains decrypted and compared
  byte-for-byte against the exact expected names. Unexpected crypto
  or ACL errors still fail the test.
- **Excluded:** backend API, E2EE/domain/crypto, Shell/router,
  retention/ACL/Local-First storage, immutable `docs/ux/**`,
  UX-only `docs/ux-integration/**`,
  `apps/web/src/ui/fieldwork/**`, other QA tests, Matrix, `main`.
- No changed-file overlap with #146/#150/#152/#153, whose
  Settings/Appearance work is parallel and remains Draft.
- Parent #151's historical red exact-head CI is **not** redefined
  as green; the combined product+QA descendant #154 has separate
  verified exact-head 3/3 and two 54/54 runs. All future integration
  must reconcile #139/#140 product ancestry and product/UX branches
  under a single reviewed combined head before any merge.

## Exact-head browser fixes / evidence journal

- First #156 test HEAD `6ee9301b...`: **53/54 Chromium**; real mobile
  `photo-strokes` found the original generic first-label full span,
  with color/range Y coordinates separated by 66px.
- Second HEAD `1f6b2c84...`: **53/54 Chromium**; two fields on the same
  line but native `input[type=range]` overflowed the container.
- Third HEAD `a2d69cf2...`: **52/54 Chromium**; exact `scrollWidth`
  exceeded `clientWidth+1` by one further pixel; a separate Browser
  return test hit an expected `identity.account_changed` abort on
  an in-flight E2EE metadata read during session bootstrap.
- Current code removes browser-native range margins and waits for the
  actual session proof before polling the unchanged AES-GCM filenames,
  tolerating only the documented transient session-epoch exception,
  without bypassing signatures/identity checks or weakening geometry
  assertions. Current exact-head CI **PENDING**. No runtime Browser/
  MediaFile crypto changes; any new failures will be reported by job.
