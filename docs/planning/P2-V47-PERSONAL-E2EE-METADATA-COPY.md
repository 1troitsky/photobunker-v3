# P2 V-47 — Private Information tab: explicit PERSONAL E2EE copy, NOT in-place mutation

**Status:** product code and tests written, exact-head CI pending; NOT owner UX approved or revision API accepted.
**Parent:** Draft [#145](https://github.com/1troitsky/photobunker-v3/pull/145)
@ `d62c4cae599b5e3c3de300f808242566f3ee124a`,
CI 3/3 + Chromium 50/50 PASS; Main remains unchanged.
**UX reference:** immutable PB2 [#56](https://github.com/1troitsky/photobunker-new/pull/56)
Photo Editor 3.2 **SELECTED** Information tab and Media Editor 1.1.
**Screens/edges:** S09/S10, N-18–N-20; journeys J-06/J-07 and J-04/J-21 regression.
**Parallel protocol:** docs-only [#138](https://github.com/1troitsky/photobunker-v3/pull/138)
`docs/ux-integration/PARALLEL-WORK-PROTOCOL.md` — product lane owns this file set.
Historical #139/#140 ancestry divergence remains a separate stack reconciliation item.

## Why metadata copy, not an in-place save?

PB3 `apps/web/src/features/media/domain/media-crypto.ts` creates a
unique signed `MediaContract`, with metadata in a final AEAD chunk.
Account/media ID, plaintext byte size, expiry and chunk count are included
in authenticated AAD. `media-outbox.ts` persists the immutable contract,
signed manifest, and ciphertext chunks; server receipts verify these exact
contract fields. **Overwriting a metadata chunk or bypassing the signature
would violate integrity and receipts.** No accepted `MediaRevision`
mutation/replace + ACL/assignment revision API exists in this product stack.

For this reason the selected "edit information" UX can be partially
implemented safely ONLY as an **explicit new independent personal copy**,
not as renaming/editing the existing object. This is visible in the
Information tab in plain language and confirmed with `window.confirm`.
Neither queued-local nor browser preview is ever represented as a server
ACK. New copying is not the final approval of Editor 3.2.

## Implemented vertical journey

1. E2EE owner source is decrypted/verified as before in the existing S08
   Viewer. In S09/S10 Information tab, editable Name, Description,
   Category and tag chips appear only if the file is a **non-expired local
   MediaFile** belonging to the active account and the stored file has
   **no signed assignment capture**. A cloud-only source, legacy Photo
   (P1 record), assigned/captured file, expired/invalid/conflict file or
   unknown provenance remains **read-only**, not a fake save path.
2. The form validates file name 1–160 characters, forbids path traversal,
   controls/bidi spoofing, and prevents changing the source extension.
   Private description (max 4000), category (max 64) and tag list
   (max 12, 48 UTF-8 bytes/tag, unique, no controls/commas) are validated
   with the **same production domain validator** used by the encrypted
   media contract. Note PB2 UI demo said 30 tags; the **current actual
   signed media metadata implementation** allows only 12 — the app
   does not silently claim 30 until the schema is explicitly revised.
3. Header Save is available when that Information tab has a valid
   changed metadata draft, the source is verified personal, and no
   unsaved photo/WAV/video work exists. Save checks the local owner's
   source again, re-decrypts/authenticates its Blob, verifies identity,
   filename, MIME, byte length, and calls the existing
   `enqueueEncryptedMedia(new File([...]),undefined,privateFields)`.
   This creates a new MediaFile ID, a new wrapped key and new encryption,
   with **no capture binding, GPS, original grants or TTL inheritance**.
   User is warned before it happens. The old encrypted MediaFile/metadata,
   IDs, caption, signed assignment provenance and server state stay unchanged.
4. Repeated click is blocked while encryption is running. Cancel/Back
   warns about any unsaved metadata fields; mixing metadata edits with
   photo/audio/video unsaved edits disables Header Save with an explicit
   explanation, avoiding silently saving half a user's work.
5. A confirmed local outbox write returns to the **same original Viewer**
   (so next Back restores the original Browser folder/filter/search).
   A separate copy is browsable in Browser; the app reports **queued
   locally, cloud not confirmed** and never pretends a metadata update
   or transfer happened on the original.
6. Existing source key-package, account/device or file navigation change
   clears volatile form fields, tag input, saved ID and errors. Real
   unmount still revokes decrypted object URLs and other media drafts.

## Evidence gates

- New Vitest `personal-media-copy.test.ts` covers source extension,
  invalid names/path/bidi, max lengths, tags/canonical fields, assignment
  capture/expiry/cloud-only provenance and conflict gates.
- New real Chromium `p2-browser-editor-personal-metadata-copy.spec.ts`:
  real JPEG with private original category, description, tags and
  authenticated GPS -> encrypted MediaFile outbox -> Viewer -> Editor
  Information -> invalid extension disables Save -> edit name, category,
  description, tag chips -> refused Cancel retains draft -> offline
  confirmed Save -> independently decrypted **two** MediaFiles
  (source metadata untouched, copy metadata changed, same exact SHA-256
  file bytes, no inherited GPS/provenance, no plaintext inside Dexie
  record, cloud state queued) -> same Viewer -> Browser Back.
- Exact-head CI PHP8.4/8.5, Vue TypeScript/build/Vitest, security,
  PostgreSQL18/Garage + Chromium 51/51 **PENDING**.
- Real Safari iOS/Android physical browser, multi-tab source changes,
  metadata revisions/replacement, file renames *in place*, editing
  GPS/assignment/expiry or curator review, Public Card and owner visual
  comparison remain **NOT IMPLEMENTED / NOT TESTED**.

## Cross-lane scope and protected paths

- **Lane:** PRODUCT.
- **Source exact SHA:** #145 @ `d62c4cae599b5e3c3de300f808242566f3ee124a`.
- **Changed:** `apps/web/src/views/FileViewerView.vue`,
  `apps/web/src/styles.css`, new `features/browser/application/personal-media-copy.ts`
  and unit test, one new E2E, and this product planning file.
- **Intentionally untouched:** `apps/api/**`, `media-crypto.ts`,
  `media-outbox.ts`, key package, E2EE pipeline/ACL/retention, old
  `docs/ux/**`, UX-owned `docs/ux-integration/**`,
  `tools/ux-review/**`, `tests/ux-review/**`,
  `apps/web/src/ui/fieldwork/**`, shared Shell/Header and `main`.
- **Overlap:** shared Viewer/CSS with ancestor #139–#145, resolved by
  stacking on latest verified product #145, **none with UX SANDBOX**.
- No merges, deployments, physical cloud deletion, bypassed assignment
  permissions or Public Card scope changes.

## Required future stage

Implement first-class **owner-authorized signed MediaRevision / optimistic
conflict/version checks** for genuine in-place metadata updates, policy-
authenticated assignment transitions and device-level safe offline
revision handling; do not retrofit unsigned metadata mutation to
immutable media contracts. Then integrate the approved GPS/location,
expiry, assignment and Public Card panels with separate authorization
gates, while preserving actual Safe derivative policy.
