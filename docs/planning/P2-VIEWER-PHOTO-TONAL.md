# P2 Viewer — bounded, non-destructive photo light/color adjustments

**Status:** implementation in Draft, exact-head CI and native device acceptance required.
**Approved UX reference:** `docs/_uiux/browser_photo_editor_3_2_fixed.html`; parent photo crop/rotation in Draft #99.

## User journey
1. Open authenticated, client-decrypted photo in Viewer. Keep original untouched.
2. Adjust brightness, contrast and saturation with native sliders, default **100%**, accepted values **0–200%** in steps of 10. Changes only stage parameters. They never modify a source outbox row or persist plaintext.
3. Explicit **Create JPEG copy** takes already-decrypted current image Blob, applies the selected crop/rotation and then the tonal adjustments to bounded RGBA pixels (max 4096px/axis, max 16MP). The resulting JPEG is flattened in local memory; the original image and metadata remain immutable.
4. User decides whether to **Save encrypted in Browser** (new independent personal JPEG AES-GCM MediaFile, durable offline outbox) or **Download** following explicit warning about plaintext OS exposure. Neither action happens on slider change or preview creation.
5. Any changes of sliders, crop, route, account/device cryptographic identity or logout invalidate the old derived preview and revoke object URLs. The final filename includes crop bounds, rotation and non-default effect percentages without leaking private metadata.

## Correctness and trust
- Pixel transforms use device-local deterministic RGB math: brightness scaling, contrast around midpoint 128, luminance-weighted saturation; alpha is preserved until JPEG encode; output bytes clamp to 8-bit. No external conversion, remote image URL, CSS-only filter, network request or unencrypted index.
- Invalid/malformed percentages or RGBA buffer sizes fail closed, rather than silently saving an unknown variant.
- Existing decoder, encrypted storage/receipt and access grants remain unchanged; new image does **not** automatically inherit original's GPS, assignment evidence, share grants or TTL.
- **Not a privacy mask.** No claim is made that tone adjustments hide sensitive information. Safe overlays/text/blackout masks and photo-editor undo/redo remain separate independent work.
- Chromium + real PG18/Garage tests should verify actual final JPEG becomes grayscale when saturation=0, encoded pixels match real selected effect, E2EE derivative is separately decryptable, source file remains intact, and no automatic device export occurs. Safari/iOS and physical devices remain pending.
