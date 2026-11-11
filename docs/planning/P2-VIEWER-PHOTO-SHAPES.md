# P2 Viewer — photo shapes / stroke / optional fill

**Status:** Draft code; exact-head CI and native Safari/physical-device acceptance required.

## Accepted UX source

`docs/_uiux/browser_photo_editor_3_2_fixed.html` — approved Photo Editor 3.2, **Фигуры**: Стрелка, Круг, Квадрат, Треугольник, Звезда; «Цвет рамки» and «Толщина рамки» on one row; «Цвет заливки» and independent «Залить фигуру» checkbox on the next row.

## Scope and security

- In the authenticated File Viewer, first prepare a personal JPEG via the existing crop/rotation/light/color path. Overlay up to 12 shapes over that *output* image: select kind, x/y/width/height as normalized integer percentages, stroke color, thickness (1–28), optional separate fill color, and explicit fill flag. Select/drag an SVG shape or edit coordinates in a list; remove it without affecting any other annotation.
- Shapes are strictly ephemeral editor state; their geometry and color values are not written to plaintext IndexedDB, S3 objects, API or analytics.
- **Save encrypted in Browser** or **confirmed device download** flattens text (if any) and shapes into the actual JPEG pixels in **one** bounded in-browser render/encode. The original MediaFile/photo, grants, assignment evidence, GPS and retention policy are not changed or inherited by the personal derivative. Only the new JPEG bytes enter the signed AES-GCM outbox.
- Max output canvas 4096 px/axis, 16MP, max 12 shapes, unique UUIDs, known type, bounded nonnegative integer geometry and in-bounds rectangle, lowercase six-digit RGB hex for stroke/fill, correct boolean fill and thickness. Any malformed mark rejects the operation; silent clipping/unknown shape types are not accepted.
- Active selection/move/resize/color edits invalidate a previously flattened preview and its saved-ID state. Source/crop/route/logout/root changes revoke temporary blob URLs and reset marks. No update to storage access, Matrix or physical GC.
- This is **not privacy redaction**: optional filled shapes are annotations, not a guarantee that underlying sensitive pixels can never be recovered from the original/version. Privacy masks and policy-aware safe/original publish scopes remain a separately gated feature.

## Tests
- Pure shape validation/geometry; actual native Canvas path operations and fill-on/off coverage for five kinds.
- Real browser + PostgreSQL18/Garage: create original all-white JPEG, encrypt while warm offline, add/delete shape, draw and move a green filled circle with separate red outline, save an independent AES-GCM JPEG, decrypt and verify real green/red pixel areas, source bytes and private metadata unchanged, no automatic OS export; confirm OS download and logout URL revocation.
- Native Safari/iOS/Android, complete Photo Editor 3.2, brushes/eraser and undo/redo are not declared verified by this PR.
