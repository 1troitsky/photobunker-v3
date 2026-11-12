# P2 V-49 — Photo Editor 3.2: click-to-type JPEG text, one overlay + one list

**Status:** code/real browser journey written; exact-head CI pending.
**Parent:** verified product Draft [#148](https://github.com/1troitsky/photobunker-v3/pull/148)
@ `c1eb47ce9ee78d86f816fda75aea1e288f52e63b`,
CI 3/3 PASS; 52/52 real Chromium E2E PASS.
**Owner-selected UX:** read-only PB2 PR #56
`docs/ux/browser/editor/README.md` §3.4 and §7,
Photo Editor 3.2 Fixed (SELECTED design, not code).
**Coverage:** S09, N-18/N-20, J-06 / J-04 / J-21.

## User-facing vertical flow

- On a real authenticated JPEG displayed within the same Editor route,
  select the Photo tab, produce the already verified JPEG preview and
  tap directly **on the image** to open a keyboard-focusable inline
  text field. The point is computed against the actual image
  `getBoundingClientRect()`, not viewport/document scroll coordinates,
  so scrolling and mobile scaling do not shift the final text.
- An **uncommitted** text draft is a volatile form, **not** a fake list
  entry, exported mark, encrypted metadata, or history mutation.
  Escape/Cancel or empty/whitespace-only completion leaves the
  original photo, mark list, Undo history and stored ciphertext alone.
- After user confirmation (Enter without Shift, Done, or blur),
  `prepareInlineText` calls the **existing** `validateTextMarks` contract
  before inserting/changing the mark. This makes the visible
  `PhotoTextMark` overlay, counter, list and JPEG raster-annotation
  input the **same model**. No separate DOM-only caption store.
- Existing marks can be edited at their physical image position via
  double-click or **«На фото»** next to their list row. No preview
  duplication: changes update the same record and therefore the same
  list and DOM layer. Existing move-by-pointer, numeric position,
  color/size controls and 50-entry Undo/Redo remain working.
- New and edited text participate in the existing snapshot history
  only on commit; delete, Undo/Redo and export use the same list.
  Active inline draft **disables Header Save** and the old direct
  Crop Save, preventing partial export of a JPEG without text that
  the user was still typing. Editor Cancel/Back warns on typed draft.
- On logout/identity change, source switch, failed decryption,
  source disposal, and Editor cancel the existing clear routines
  discard all volatile text fields and revoke decrypted media URLs.
- The flattened JPEG is produced by **existing** `flattenPhotoAnnotations`
  and saved via `enqueueEncryptedMedia` as a **new E2EE derivative**.
  No original overwrite, assignment permission elevation, GPS/metadata
  inheritance, cloud ACK claim, OS gallery action or unencrypted
  IndexedDB text storage is introduced.

**Important scope distinction:** The old shortcut «Добавить текст» and
existing list textarea remain in this incremental PR for compatibility
with already-verified text-annotation journeys. They still create/edit
using the same single `textMarks` model. This PR adds the owner-selected
on-image entry workflow; full Photo Editor 3.2 screen-by-screen
cosmetic matching requires independent owner visual review.

## Tests / evidence

- New pure Vitest `photo-inline-placement.test.ts`: real image-box
  mapping with page offsets, clamping to safe JPEG text coordinates,
  zero/nonfinite source rejection, empty draft no mark, invalid text
  rejection using production validator.
- New Chromium `p2-browser-photo-inline-text.spec.ts` (target total
  53 real browser tests): creates a white JPEG through production
  offline AES-GCM Media Outbox, opens File Viewer → Editor,
  taps image → verifies no phantom caption before commit,
  Escape/Cancel empty, commits two independently placed captions,
  checks photo DOM and list entries, edits second on image,
  Undo/Redo synchronizes both surfaces, deletes first and restores it,
  saves actual red text into independently encrypted flattened JPEG,
  decrypts output and verifies red pixels, unchanged original byte
  count, empty inherited GPS/tags/capture, no plaintext in stored record,
  and native Browser return.
- Retain existing 52/52 photo crop/effects, shapes, masks,
  pointer drag, WAV, WebM, metadata-copy and Viewer tests.
- Exact-head CI PHP8.4/8.5, Vue strict TS/Vitest/build, security,
  real PostgreSQL18/Garage + Chromium **PENDING**.
- iOS/Android physical PWA touch/keyboard, IME composition,
  exact visual parity, draft restoration on browser crash/reload,
  and new in-place MediaRevision **NOT TESTED / NOT CLAIMED**.

## Parallel lanes and scope

- **Lane:** PRODUCT; exact parent #148
  `c1eb47ce9ee78d86f816fda75aea1e288f52e63b`.
- Changed `FileViewerView.vue`, product `styles.css`,
  new pure `photo-inline-placement.ts` and unit test,
  new isolated functional E2E and this planning document.
- **Not changed:** `App.vue`, Shell, route, original `photo-text.ts`,
  photo GPU/canvas crypto, Media Outbox, API/DB/ACL/TTL,
  `docs/ux/**`, `docs/ux-integration/**`,
  `tools/ux-review/**`, UX sandbox `apps/web/src/ui/fieldwork/**`,
  Settings, Matrix or `main`.
- Historical overlap with #139–#148 product-owned Viewer/CSS is
  resolved by stacking on the **verified product #148**,
  not the older #134 or UX docs #138. Parallel integration #146
  Settings/Contacts changed **no shared runtime files**; its independent
  failing E2E run remains a separate UX/QA gate, not an excuse to
  weaken product checks.
- #139/#140 divergent ancestry must be reconciled before any merge.
  All relevant product PRs remain Draft; no merge/deploy.
