# P2 Viewer — editable photo text layers → flattened E2EE JPEG

**Status:** implementation Draft; exact-head real Chromium/PG18/Garage CI and independent native device acceptance still required.

## Accepted UX and scope

Reference: `docs/_uiux/browser_photo_editor_3_2_fixed.html` (approved Photo Editor 3.2 text tab, text list, selecting/editing/deleting a mark and text on top of the picture). This increment extends the verified JPEG crop/rotation (#99) and pixel-based light/color controls (#100), not the complete Photo Editor 3.2.

1. In File Viewer open an authorized local/cloud decrypted photo, set crop/rotation/effects, and explicitly **Create JPEG copy**. A bounded base JPEG stays only in temporary browser memory.
2. Use **Добавить текст** to create up to 12 in-memory text layers. The image preview shows actual positioned labels. Select any label from the list; edit its Unicode text (up to 220 characters), color, size, and x/y percent coordinates. Drag labels by mouse/touch in the image area. **Удалить** removes the selected layer, not the underlying pixels.
3. A label is located relative to the **cropped and rotated output image**, not raw device GPS or the original image. Modifying crop/rotation/effects clears the old layer positions to avoid silently publishing shifted annotations. Editing a mark invalidates the previous flattened derivative/saved-ID state. No plaintext draft is ever put in a database or network.
4. **Save encrypted in Browser** (separately initiated) validates all text marks, locally rasterizes text onto the JPEG, and creates a new personal `image/jpeg` MediaFile through the existing signed AES-GCM chunk outbox. The original is never overwritten, and no owner grants, assignments, GPS or source retention are automatically inherited. The app reports only device-local durability until server receipt confirms sync.
5. **Download JPEG to device** is independent and still requests explicit plaintext-export confirmation. It applies the same raster text-flattening path; no accidental export of an unannotated base when overlay text is visible.
6. After successful flatten, the preview shows the **real raster JPEG** (the editable DOM overlay is hidden to avoid rendering marks twice). Selecting/editing a label reopens editable layers, invalidates the old composed URL and requires another explicit save/export. Logout, navigation and cryptographic identity switch revoke image URLs and clear volatile text.

## Security, limitations, verification

- Pure, bounded canvas path: <=12 unique UUID layer IDs, 0–85% positions, 2–12% size relative to image width, lowercase six-digit RGB hex, 220 Unicode characters per mark. Reject malformed shape, blank marks, control characters, duplicate IDs, out-of-range coordinates and text overflowing the JPEG. Maximum image 4096px per axis / 16MP. Text paint uses `fillText`/`strokeText` and standard Vue escaped template interpolation, **never `innerHTML`** or URL query parameters.
- No plaintext annotation JSON appears in IndexedDB, S3 API, logs, telemetry or the signed storage manifest. Only the resulting image pixels are encrypted as a new media asset.
- E2E must create a **real** JPEG on-device, encrypt it while warm offline, then create/edit/delete/re-add and move actual text labels. Empty layers fail closed. Explicit save creates a separately decryptable JPEG with a measurable red text raster and original metadata/state unchanged. No auto-download; user-confirmed export produces the same derived image. Logout revokes the temporary object URL.
- The interaction is a single-page increment. It does not yet include on-image keyboard caret editing, shape brushes, masks, full undo/redo, safe/original publish scope, version editing of a shared assignment, or native Safari/iOS physical acceptance. Overlay text **is not** a privacy mask or irreversible redaction; existing photo remains accessible in its original scope.
- Boundary: cold-offline app boot remains unsupported; media editing works on a resumed device with local key material.
