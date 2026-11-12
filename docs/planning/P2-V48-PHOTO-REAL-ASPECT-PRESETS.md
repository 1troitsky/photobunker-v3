# P2 V-48 — Photo Editor 3.2: real JPEG crop aspect presets and 90° rotation controls

**Status:** implementation, Vitest and real Chromium E2E written; exact-head CI pending.
**Parent:** product Draft [#147](https://github.com/1troitsky/photobunker-v3/pull/147)
@ `6324daf1f9821b70b5234824a484d227975ac2a1`
(**3/3 CI PASS, 51/51 Chromium E2E PASS**).
**Approved visual source:** immutable PB2 PR #56
`docs/ux/browser/editor/README.md` §3.1 Photo Editor 3.2 **SELECTED**.
**Screens / edges / journeys:** S09 (Photo Editor), N-18/N-20,
J-06 / J-04 / J-21 security and return regression.

## User journey

- Open an authenticated, decrypted private JPEG from Browser → File Viewer
  → distinct Editor Photo tab. Existing crop sliders and file content remain
  authoritative. New aspect buttons **Исходные / 1:1 / 4:3 / 16:9**
  use a pure `choosePhotoAspect` function with original image
  `naturalWidth/naturalHeight` and the existing selected crop geometry.
- The helper scores actual integer pixel regions in the original image,
  considering 90°/270° rotation. It chooses a **maximum-pixel-area**
  percentage crop within 0.4% of requested ratio when feasible,
  otherwise the smallest relative error. The selected crop remains
  centered on the user's current manual focal point and is guaranteed
  accepted by production `cropGeometry`.
- `Исходные` restores full crop bounds with the current rotation.
  Manual crop slider input marks the selection **custom**, avoiding a
  false aspect indicator. ±90° buttons use the existing `turns`
  value and preserve a selected aspect when rotating; legacy rotation
  select remains to preserve keyboard/E2E functionality.
- Creating the JPEG invokes the **existing authenticated cropPhoto**
  canvas raster pipeline: true source-pixel selection, rotation, optional
  brightness/contrast/saturation, composited annotations. No CSS-only
  aspect filters or unauthorized new media read.
- Saving via the shared Header still creates a **separate encrypted JPEG
  derivative**, with original bytes and signed metadata untouched,
  no inherited GPS/assignment/ACL/TTL, and truthful "locally queued,
  cloud confirmation separate" status. Cancel and Browser return remain
  those verified in #144–#147.

## Verification gates

- New Vitest `photo-aspect-presets.test.ts` covers exact square crop
  for a 200×100 image, original reset preserving turns, portrait/
  landscape + ±90° ratio tolerance, current focus preservation and
  invalid source geometry.
- New real Chromium `p2-browser-photo-aspect-presets.spec.ts`
  creates and encrypts an actual two-color 200×100 JPEG, enters the
  selected Editor, applies 4:3 (asserts raster preview dimensions),
  then 1:1 + +90° (must yield **100×100 actual rotated JPEG**, not CSS
  styling), encrypts the derivative offline, reads source + output
  locally through production AES-GCM, checks pixel channels rotated
  to different top/bottom regions, distinct file metadata/rights,
  and native Back to Browser.
- All existing JPEG crop/effects, text, shapes, blackout Safe-only,
  WAV, WebM and metadata-copy suites must stay passing. Target
  **52 real Chromium E2E** plus PHP8.4/8.5, Vitest/TS/build, security,
  PostgreSQL18/Garage. Exact-head verification **PENDING**.
- Pixel-perfect Visual 3.2 approval, physical iOS Safari and
  Android Chrome, transparent PNG input details, unrestricted
  freeform geometry, and future MediaRevision remain **NOT TESTED /
  NOT CLAIMED**. Integer percentages permit a small aspect error
  (bounded by 0.4% when feasible), not a mathematically exact crop
  for every arbitrary natural dimension.

## Cross-lane ownership / exclusions

- Lane: **PRODUCT**, stacked on verified #147 head rather than
  unrelated UX or older production code. #139/#140 source divergence
  is a separate pre-merge dependency reconciliation issue.
- Touched: `apps/web/src/views/FileViewerView.vue`,
  `apps/web/src/styles.css`, new pure photo-aspect helper and
  Vitest, one new Chromium E2E and this product planning doc.
- **Not touched:** existing `photo-crop.ts`, any E2EE media
  crypto/outbox, signed manifests, API/DB/ACL/TTL, immutable
  `docs/ux/**`, UX-owned `docs/ux-integration/**`,
  `tools/ux-review/**`, `apps/web/src/ui/fieldwork/**`,
  other product features, Matrix or `main`.
- Parallel UX-integration Draft #146 (Settings and Contacts) has
  no shared changed files; separate stack branches may integrate
  through reviewed cherry-pick / latest product integration, not
  blind wholesale merging.

Draft only, no merge/deploy/destructive operations.
