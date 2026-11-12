# P2 V-40 — Browser-scoped File Viewer mixed-media pager

**Status:** Draft, implementation and tests written, exact-head CI pending.
**Parent:** [#136](https://github.com/1troitsky/photobunker-v3/pull/136)
@ `88c242ee045b31c49924540f1702f38154519aaf` (3/3 exact-head PASS;
46/46 real Chromium); parent #134 and #132 are Draft, `main` untouched.

## UX source and gap

PB2 PR #56 @ `daca24a4a38c62473859b2b54b4999d50400c491`:
`docs/ux/browser/viewer/README.md` §2 says File Viewer remains part of Browser,
with mixed-media previous/next, context-aware folder and filter.
`docs/ux/browser/README.md` defines file type, sorting, virtual folder
and private search scopes.

Current production `FileViewerView` built navigation from a separately
reloaded personal-cloud index sorted independently, not from the Browser
user-visible order. When opened in a selected encrypted folder, with
`audio` filter and expiry sorting, its arrows could navigate outside that
folder/filter, even if those files were authorized to read.

## V-40 changes

- Browser stores exactly its **currently displayed ordered file keys** when
  the user clicks an ordinary Viewer link, alongside V-39's volatile return
  context. These are only opaque `photo:UUID` and `media:UUID` keys, with
  no plaintext filename, tag, folder name, description, GPS or external link.
  Refuse inconsistent/duplicate/overlarge (>10,000) snapshots.
- File Viewer prev/next and ordinal/total use this snapshot **only** when
  the current account/device matches and current opaque key belongs to the
  snapshot. Preserves mixed media in the Browser's actual folder, filter,
  sort and private search result. A target may be cloud-only or newly
  imported; opening each still uses the existing server ACL, signed
  manifest/receipt, AES-GCM and per-file TTL checks. Navigation membership
  cannot grant access to ciphertext.
- Viewer notes the last visited source key for one-shot Browser return and
  scroll targeting. Returning to Browser rechecks selected folder against
  locally decrypted workspace as already implemented in V-39.
- Direct File Viewer deep links without a remembered Browser origin use
  the existing independently validated 10×50 opaque catalog pager from
  V-38, without inventing a folder or guessing a search.
- Context is **not persisted or transmitted**: no URL/history query,
  cookies, IndexedDB, localStorage, telemetry, server or S3. Reload/new tab
  safely loses the snapshot.

## Evidence

- Vitest: original 3 one-shot/identity tests and new scoped mixed-file order,
  last visited source position, unknown key/device, and duplicate/inconsistent
  snapshots.
- Real Chromium + PostgreSQL18/Garage: one anonymous account, four genuinely
  locally encrypted media files; two WAVs in an encrypted virtual folder,
  one excluded video in the same folder, one outside WAV; apply audio filter
  and expiry sort; Viewer must navigate **1/2 → 2/2**, never offer out-of-scope
  files; return to correct folder/filter and last visited row.
- Required exact-head PHP 8.4/8.5, strict TS/Vitest/build, Security,
  real PG18/Garage/Chromium **pending**.

This PR does not implement File Viewer 1.0 fixed 64/45/114/57/48/82px UI
geometry, full modal/actions coverage, independent Safari/mobile UX,
a full account-wide index, or cross-device encrypted folder/cloud sync QA.
No merge, deploy, Matrix, Public Card, external sharing or physical GC.
