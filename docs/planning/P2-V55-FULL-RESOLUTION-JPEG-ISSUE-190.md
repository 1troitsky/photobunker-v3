# P2 V55 / Issue #190 — true native JPEG export after volatile live preview

**Status:** corrective child implementation, exact-head checks pending.
**Base:** [Draft PR #207](https://github.com/1troitsky/photobunker-v3/pull/207) @
`6899df3e8f3f206a51ee5d8460ab883a2b5a94ad`, all workflows PASS,
357 Vitest, full 60 Chromium. Scope is **Issue #190 only**.

## Previously confirmed and now corrected

The UI shows immediate photo crop/rotation/RGB/annotation preview on a
volatile Canvas of at most **1024 px per edge / 1,048,576 pixels**.
Previously `cropPhoto()` reused `cropGeometry()` limited to
4096 px / 16,777,216 pixels and silently downscaled the **saved JPEG**
too. The downstream flattening functions used the same 4096px cap.
That violated #190 even though #207's CI was green.

Now:
- Preserve `cropGeometry()` and its existing 4096/16.8MP display
  behavior. `livePhotoPreviewSize` still caps the raster to 1MP.
- `fullResolutionCropGeometry()` extracts the **same source crop** with
  native dimensions and 0/90/180/270° rotation, **never scales up/down**;
  identical geometry is used for real JPEG encoding and for the
  downstream shape/text/brush/blackout flattening.
- A separate conservative export admission policy rejects frames with
  either dimension >8192 or >24MP. A device exposing
  `navigator.deviceMemory` below 4 GiB is restricted to 8MP; if
  memory is not exposed (Safari/etc.), assume a conservative 12MP
  budget. This is an explicit refusal, not a hidden downscale, and
  does not pretend to know physical device allocatability.
- Real Canvas allocation/encoding must succeed; `toBlob` is bounded
  by **30 seconds**. Missing JPEG Blob, unexpected MIME and decoded
  JPEG dimension mismatch all fail closed before local AES-GCM upload.
  Any late encoder callback is ignored. UI shows an actionable Russian
  explanation and tells the user to crop a smaller area.
- The existing 128MiB `MAX_MEDIA_BYTES` and original/media signatures,
  account epoch guards, ACL, TTL, encrypted outbox and unsafe/public
  constraints remain unchanged. No raw JPEG is silently stored in
  IndexedDB, OS Gallery, browser cache, cloud or another account.
- Full-resolution crop and annotation flattening each **validate
  actual decoded dimensions**. Mask is still applied last, with
  eraser on a separate transparent layer. Device can fail even below
  these limits: fail closed; never advertise successful upload.

## Acceptance evidence

- Unit: preview vs real output geometry >4096 px and >16.8MP,
  90° axes, low/unknown memory rejection, explicit oversize refusal,
  encoding timeout/null/throw/late callback.
- Real Chromium E2E: source JPEG **5200×3400 (17.68MP)** imported
  through actual local AES-GCM MediaFile. Simulated 2GiB memory
  rejects final export with visible error, no files added, Save
  disabled. On 8GiB, real Canvas encodes native JPEG,
  UI confirms natural 5200×3400, user adds a safe blackout and saves.
  Re-decrypts actual derivative, verifies **5200×3400**, black mask
  center, unmasked source region, original bytes and SHA-256 unchanged,
  no inherited private category/GPS/assignment.
- Existing crop/RGB/rotation Undo/Redo, stale Save and annotations
  E2E remain enabled; no QA bypass/retry/extended timeout.
- Required exact-head: PHP8.4/8.5, Vue typecheck/build, Vitest,
  security/UX lane/source contracts, real PostgreSQL18+Garage and
  whole Chromium suite including the new high-resolution journey.
- **NOT TESTED:** native iOS Safari / Android PWA, device-level
  memory/thermal constraints, owner visual acceptance and integration
  to `main`. #190 remains open in review until approval.

## Parallel work and ownership

Separate Draft child branch `p2/v55-full-resolution-export`, based
strictly on #207, **not** on old `main`. No edits to #207 or
#158/#160/#162/#185/#187. No changes to external notifications
#186, Administration #188, Help #182, backup limits #189,
accepted `docs/ux/**`, Matrix, app Shell, backend or shared auth.
