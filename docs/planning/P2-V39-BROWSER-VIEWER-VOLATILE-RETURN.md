# P2 V-39 — Browser ↔ File Viewer volatile return context

**Status:** Draft; code and tests written, exact-head CI pending. Parent [#134](https://github.com/1troitsky/photobunker-v3/pull/134) @ `07fa2832043fc6799c0b5acd127cbafdd5c72eee` (3/3 exact-head PASS). All product PRs remain Draft; `main` unchanged. Matrix remains separately gated.

## Accepted UI evidence and gap

PB2 [PR #56](https://github.com/1troitsky/photobunker-new/pull/56) @ `daca24a`: `docs/ux/browser/viewer/README.md`, §2 requires File Viewer breadcrumbs to return to the same Browser **folder, filter, position and navigation history**, without moving the global shell/dock. `docs/ux/browser/README.md` describes folder selection, media filter, local-first search and sorting. These are accepted *prototype contracts*, not currently accepted PB3 production UI.

The PB3 Browser already maintains a decrypted, local-only encrypted-folder workspace and the Viewer independently decrypts media, but `/browser/file/:protocol/:id` unmounts Browser and loses its selected folder, sort, file type, search and list position. The existing Viewer Back link simply navigates to root defaults.

## Implementation and trust limits

- Capture origin state on *normal same-tab Browser file link navigation*; Cmd/Ctrl/Shift/Alt or auxiliary clicks do not capture a context for a second tab. Stored fields: account/device identity, opaque item/folder IDs, type/sort/view/archive filter, optional private text-search string and scope.
- This state is **tab memory only** in an application module. It is never serialized to URL, browser history state, localStorage, IndexedDB, S3, telemetry or backend. A reload or a new tab starts at root. No decrypted folder title, filename, tag or GPS is retained in the module.
- Arm only on an actual File Viewer → Browser route transition (back link, shell link, Escape or browser history Back). On return, consume **once**, strictly matching the same account and device. Another route destination discards stale context.
- Load the *existing encrypted folder workspace* and accept the captured opaque folder ID **only if that folder still exists locally**. Missing/deleted/foreign folder resolves to root, never creates a synthetic workspace or widens E2EE access. Restore search, filter, sort and list/grid mode; after the authenticated catalog row becomes visible, scroll that row into view. If the row has moved/is inaccessible/filtered out, do not force it into view.
- This is presentation navigation only. It does not mint grants, move ciphertext, trigger cloud upload, change TTL/ACL or persist plaintext. Existing per-file server ACL + AES-GCM manifest/receipt checks remain mandatory for opening files.

## Evidence and remaining scope

- Vitest: one-shot return, identity/device mismatch, new-tab/not-armed and stale cancellation.
- Chromium: real anonymous account and locally encrypted WAV import, create encrypted virtual folder and move row, change type filter/sort/grid and perform private filename search; open Viewer and decrypt file, native browser Back to same folder/search/filter; following unrelated navigation defaults to root. No plaintext search in URL.
- Full exact-head CI: PHP8.4/8.5, TypeScript/Vitest/build, Security, PG18/Garage/real Chromium **pending**.
- Not full File Viewer 1.0 geometry, name-ID headers, modal actions, physical Safari/iOS/Android, reload-persistent UI cursor or signed folder-cloud workspace synchronization validation. No claim of complete UX acceptance.

No merge, deploy, public sharing or destructive GC.
