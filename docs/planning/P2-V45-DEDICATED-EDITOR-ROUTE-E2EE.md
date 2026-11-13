# P2 V-45 — S09/S10 dedicated Editor route on existing E2EE Viewer engine

**Implementation state:** code written; exact-head CI and physical device acceptance pending.
**Product base:** [#143](https://github.com/1troitsky/photobunker-v3/pull/143)
@ `7efbe1dbe1d0a64d82041695eb6ae8d200ca796b`
(**3/3 CI PASS**, documentation-only preflight, stacked on checked #141).
**UX reference:** immutable PB2 PR #56
@ `daca24a4a38c62473859b2b54b4999d50400c491`,
Photo Editor **3.2 Fixed (SELECTED)** and Video/Audio Editor **1.1 (ACCEPTED)**,
plus UX lane coordination [#138](https://github.com/1troitsky/photobunker-v3/pull/138)
`PARALLEL-WORK-PROTOCOL.md`. Screen S08/S09/S10, N-18/N-19/N-20, J-06/J-07.

## Purpose and narrow boundaries

The existing viewer on product PR #139 has *working* E2EE JPEG crop,
text/shapes/brush/masks, WAV trim and video still-frame. #140 fixed
in-Viewer navigation history; #141 consolidated the real Shell Header.
This PR does **not** implement a second media editor, fork its crypto
operations, or replace approved File Viewer. It creates a standalone
**user-visible Editor route and layout** within the same Vue view instance,
reusing the actual authenticated media read and derivative-save pipeline.

## Behavior

- `/browser/file/:protocol/:id/edit` uses the existing authorized
  `FileViewerView` instead of duplicating files, encryption, MediaFile
  metadata, outbox, key grants, ACL or signed read checks. Clicking
  **Редактировать** from File Viewer opens this route; original source
  protocol+opaque ID remain unchanged.
- Editor uses the **one existing Shell Header** (64px) with text
  **Отмена** and green **Сохранить** plus the shared 82px Dock.
  Its own content uses transparent Browser/file path, "Редактировать
  фото/видео/аудио", three tabs
  **Информация / Фото|Видео|Аудио / Проверка**, and one scrollable body.
  Current Information is **read-only**, pending real metadata mutation
  authorization. Review is **read-only with disabled curator actions**,
  pending role/policy/revision-backed server decisions.
- Native photo/video/audio media source is also visible on editor's
  working tab, with the **same DOM ref** as the original Viewer source
  (not a second Blob or unverified URL). Existing crop, annotations,
  WAV and still-frame operations remain unchanged.
- Header Save is **disabled** until a real JPEG/WAV/still derivative
  is prepared and eligible. When pressed, it calls the **existing**
  E2EE outbox enqueue functions, verifies that a local output ID was
  actually produced, and returns to the same Viewer file with truthful
  **queued locally, not cloud ACK** status. It does not alter or
  overwrite the source and does not silently inherit ACL/GPS/TTL.
- Cancel / native Back checks draft modifications and requires explicit
  discard confirmation; on discard the volatile editor draft is
  cleared without changing the source. Viewer→Editor→Viewer should
  leave a single Viewer history entry, allowing next Back to Browser.
  Direct Editor deep-links fall back to replace-to-Viewer.
- Viewer-origin Browser folder/filter/search context from V-39/V-40 is
  preserved across Editor navigation and the exact same file is selected.

## Deliberately NOT claimed

- Pixel-perfect Photo Editor 3.2 or Media Editor 1.1 visual acceptance
  or independent full-page screen production coverage.
- Editable metadata/assignment moves/retention dates/automatic renewal;
  PB3 `ts.md` overrides old demo retention checkbox with system-managed
  renewal (no fake user toggle).
- Accepted curator backend, role transitions/review audit, Public Card
  publication, video MP4 trim/export (only accepted local bounds),
  physical gallery import or simulated success.
- Offline draft persistence across forced browser reload; this first
  route reuses **volatile** data across in-app navigation and warns before
  intentional exit. Crash/reload restoration requires a separately
  designed encrypted draft storage path. No demo IndexedDB was copied.
- iOS Safari PWA/Android real device, full accessibility audit and
  owner screenshot comparison — **NOT TESTED**.

## Test gates

- Existing photo/video/audio/Safe-only Chromium E2E now exercise the
  distinct Edit route by clicking the same File Viewer action.
- Updated fixed-geometry mobile/desktop test checks the 3-tab
  editor and Cancel→same Viewer without a second Shell.
- New `p2-browser-editor-route-journey.spec.ts`:
  real Local-First AES-GCM private JPEG → Viewer→Photo Editor,
  info/review tabs (gated), prepared real JPEG derivative,
  refused Cancel with retained draft, Header Save producing
  **separate** queued ciphertext, return to original Viewer and
  native Browser Back without history pollution.
- Exact-head PHP8.4/8.5, Vitest/TypeScript/build, Security,
  PostgreSQL18/Garage and 49 Chromium test run **pending**.

## Cross-lane ownership

- Lane **PRODUCT**. Base #143, not the stale UX source branch.
- All source `docs/ux/**` and UX `docs/ux-integration/**`,
  `tools/ux-review/**`, `tests/ux-review/**`,
  `apps/web/src/ui/fieldwork/**` stay **untouched**.
- Product code changes scoped to `router.ts`, shared `App.vue` Header,
  `viewer-shell-actions.ts`, `FileViewerView.vue` and
  `styles.css`, plus functional E2E and this doc. These files were
  already reserved by product #139–#141; all edits are stacked on their
  verified combined descendant (via #143), not a concurrent UX branch.
- #139/#140 have divergent commit ancestry even though latest #141
  includes both functional fixes; reconcile before integrating/merging.
- No change to `main`, Matrix, backend/API/database,
  cloud physical deletion or production deployment.

This PR is **Draft**, not owner-accepted UI or production readiness.
