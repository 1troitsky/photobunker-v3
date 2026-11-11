# P2 Viewer — real original-versus-edited photo comparison

**Status:** Draft implementation; real Chromium/PG18/Garage exact-head CI and native-device acceptance required. Parent #103 brush/eraser/Undo/Redo was independently verified (6/6 CI, 36/36 Chromium, 233/233 Vitest).

**Accepted UX source:** `docs/_uiux/browser_photo_editor_3_2_fixed.html` Photo tab with «До / После», and `ts.md` accepted Photo Editor 3.2 controls.

## Behavior and trust boundaries
1. Owner opens an authenticated File Viewer photo. Base original is already decrypted on-device into a local `blob:` URL; editor crop/rotation/light/color transforms are a separate temporary local JPEG.
2. After creating the derived preview, the owner uses **До / После** (toggle) to compare **the real ORIGINAL photo bytes** with the actual transformed JPEG. The original is displayed only from the existing verified local `blob:` URL, not refetched or uploaded.
3. During **Before** preview, overlays, editable text/shape/paint panels, Undo/Redo, and all Save/OS-download controls are disabled or hidden. Handler-side guards also refuse derivative saving, exporting, or painting while original is shown. A clear notice identifies the view as original and tells the owner to switch to After to continue editing or export.
4. Returning to **After** restores exactly the previous edited image, same crop/tonal/brush/text/shape in-memory state, without producing a new MediaFile. No edits, keys, ACL, expiry, GPS or assignment metadata are changed by compare.
5. A later explicit **Save encrypted in Browser** still independently creates a new signed AES-GCM personal MediaFile from **only the derived** JPEG. The original is immutable, no scope grants/GPS/TTL inheritance; no false cloud ACK. A separate user-confirmed **Download** exports derived pixels only, never the original solely because it was last previewed.
6. Navigating, closing, key/device/account change or logout clears comparison and revokes all temporary Blob URLs. This control **does not** erase original source pixels or provide privacy redaction; safe/original scope/publish and actual privacy masks remain separate future stages.

## Acceptance tests
- Real on-device JPEG with two saturated colors; encrypt while warm offline and open authenticated Viewer.
- Apply saturation 0%; verify cropped derived image actually has grayscale RGB pixels.
- Toggle Before and verify **real source RGB** and `src` matches local original object URL; verify Save/Download/editor controls not available, no new E2EE file or OS download. Toggle After and verify grayscale returns, no duplicate or reset.
- Explicitly save E2EE derivative and decrypt it; check grayscale pixels and original source file byte count and metadata intact. Toggle comparison after save then back, confirm export remains edited; explicit OS export and logout URL revocation.
- Unit tests inherited from parent #103. Native Safari/iOS/Android, owner final acceptance, thumbnail retention and production GC NOT TESTED.
