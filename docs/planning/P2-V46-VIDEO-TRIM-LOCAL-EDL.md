# P2 V-46 — local video trim / bounded preview for accepted Video Editor 1.1

**Status:** code and deterministic VP8 Chromium journey written, exact-head CI pending.
**Parent:** [#144](https://github.com/1troitsky/photobunker-v3/pull/144)
@ `a9bc0aead3c86daa1f114430f49ac31d96b69513` 
(**3/3 PASS, 49/49 real Chromium**). Still Draft, no `main` change.
**Accepted UX baseline:** read-only PB2 PR #56
@ `daca24a4a38c62473859b2b54b4999d50400c491`,
`docs/ux/browser/media-editor/README.md` §3.
**Coverage:** S10, N-19/N-20, J-07 and J-21 regression.

## Honest scope

The approved video editor 1.1 has Start/End trim, clip preview and Apply.
Its prototype **does not create a new MP4**; it only changes a local
range. This implementation retains that boundary. **Video trimming
is not a server asset mutation, an E2EE MediaFile derivative or a saved
version**, and the unified Editor Header Save remains unavailable when
only trim bounds have changed. We do not pretend that clicking Apply
uploads, commits or edits ciphertext.

## Product behavior

- After the existing per-file signed E2EE local read, Video Editor
  derives a real finite duration from HTMLVideoElement metadata, or
  a finite seekable range. It does **not** fabricate a duration for
  an unsupported/corrupt media file. An explanatory unavailable state
  appears when duration is not known.
- Start/End controls use source-bound, bounded seconds. Clip preview
  starts at the selected Start and pauses automatically at End.
  A user click triggers playback, respecting browser autoplay limits.
- Apply stores only the **in-memory range** in the current editor
  session and shows explicit text "MP4 не создан / оригинал не изменён".
  Undo/Redo travel up to 50 applied range snapshots, Reset restores
  the full source. No new media encryption, blob output, S3 grant,
  archive or retention state is created by these operations.
- Editor Cancel or native Back warns if the video has unsaved trim
  changes; declining keeps the range intact. After Reset, Cancel
  returns to the same protected Viewer and next Back returns to
  Browser. On source/account/key/device changes the existing Viewer
  security boundary wipes video range state and stops playback.
- The already verified **video stop-frame → separate JPEG encrypted
  file** pipeline stays intact. Importantly, saving a still-frame
  does not silently commit any outstanding video trim to the source.

## Verification

- New real Chromium `p2-browser-video-trim-edl.spec.ts` imports
  a deterministic **2-second playable VP8 WebM** (small test-only
  fixture from ffmpeg) via the production Media Import → AES-GCM
  queued file, opens the same source Editor, adjusts range with native
  keyboard slider events, previews to stop, applies, Undo/Redo,
  rejects unsaved Cancel, Reset/Cancel, and checks no additional
  MediaFile or changes to original encrypted source bytes.
- Existing real Chromium video JPEG still-frame E2E plus photo
  and WAV crypto suites must remain passing (50 total Chromium).
- Exact-head Laravel PHP8.4/8.5, TypeScript/Vitest/build,
  Security and PostgreSQL18/Garage E2E **pending**.
- Real Safari/iOS/Android, codecs without duration, accessibility,
  crash/reload encrypted draft persistence, **actual MP4 trim export**
  and owner pixel-level visual approval are **NOT TESTED / NOT CLAIMED**.

## Cross-lane preflight

- **Lane PRODUCT** on exact verified #144 HEAD, not UX #138/#142.
- Files changed: `apps/web/src/views/FileViewerView.vue`,
  `apps/web/src/styles.css`, new
  `tests/e2e/p2-browser-video-trim-edl.spec.ts`,
  `tests/e2e/fixtures/finite-duration-webm.ts`,
  and this planning doc.
- **Excluded/untouched:** existing Gallery/Viewer return/navigation
  logic from #139/#140, shared Header from #141, E2EE media
  processing/encryption/outbox, server ACL/TTL, API/DB,
  `docs/ux/**`, UX sandbox `docs/ux-integration/**`,
  `tools/ux-review/**`, `tests/ux-review/**`,
  `apps/web/src/ui/fieldwork/**`, Matrix and main.
- Other active product branches share `FileViewerView.vue`, but
  this work is **stacked on their latest verified descendant**;
  no parallel copy or older #134 snapshot. #139/#140 historical
  ancestry must still be reconciled before any merge.
- NO fake storage of trim as an encrypted media derivative. A later
  actual MP4 encoding/export feature needs an explicit scope,
  codec/security/performance policy and independent E2E.

Draft only; no merge, deploy, physical GC or public publication.
