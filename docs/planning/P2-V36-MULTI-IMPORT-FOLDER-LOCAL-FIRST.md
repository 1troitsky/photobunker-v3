# P2 V-36 — multiple P2 MediaFiles, drag/drop and encrypted destination folders

**Status:** Draft/code written, exact-head CI pending. Parent Draft #130 (nested MediaImportPanel P2 cursor and stale response fence; latest QA selector retry status to be verified separately). All PR Draft, `main` unchanged; Matrix paused. Source of accepted Browser behavior: PB2 PR #56 @ `daca24a4a38c62473859b2b54b4999d50400c491`, `docs/ux/browser/README.md` section 4 (explicit multiple selection, device drag/drop, destination default current folder).

## Gap

The production Vue MediaImportPanel accepted **only `FileList.item(0)`**, even when the user selected multiple files. No destination selector or drop area existed. The Browser's encrypted workspace supports up to 200-file moves but the user had to import one file at a time, then explicitly move it elsewhere.

## V-36 vertical

1. The import form receives decrypted, authenticated *local folder option labels* from the parent Browser, not from a server search. `defaultFolderId` follows the **current open Browser folder**. User may choose any existing allowed nested folder, or root. Destination is snapshotted when import starts, so navigating during encryption cannot silently send later files to a different folder.
2. The HTML file input supports `multiple`; an explicit dropzone supports HTML5 `dragover/drop` with device `DataTransfer.files`. No OS gallery write. Per-batch operational guard is **20 files and 256 MiB total**, each capped by the existing 128 MiB MediaFile protocol. This is a client operational safety limit, **not a tariff quota** and not a revised product/plan entitlement.
3. The category, description, GPS and tags are snapshotted only once for the selection. For each valid File, the existing `enqueueEncryptedMedia()` creates a *distinct AES-256-GCM DEK, signed manifest, metadata chunk and durable local encrypted outbox row*. If file 2 fails validation/crypto, previously encrypted file 1 is retained and file 3 can still be tried; the UI reports exact success/failure counts. No global destructive rollback.
4. Account/device session reference is checked before and after each awaited encryption. If account changes, no additional work or folder event occurs in the new identity; previously created old-account ciphertext remains in that account's encrypted outbox.
5. After encryption, the child emits opaque successful media IDs and snapshotted destination. The parent applies existing `changeFolderWorkspace({kind:'move-files'})` in a **separate AES-GCM local workspace transaction**. This only stores MediaFile opaque IDs and destination folder ID; it does not modify file ciphertext, storage paths, ACL, grants, TTL or any Matrix data. Root requires no placement; if destination fails, files remain in local root and user is warned rather than losing data.
6. Browser refresh shows successful files in the destination without navigation reload. A device reload preserves encrypted originals and folder placement. Cloud sync still uses the existing, distinct explicit user action and requires genuine server/Storage Manager ACK; no offline fake success. A synced personal file remains owned by its uploader. Cross-device folder replication requires separate existing folder-sync user action and isn't claimed here.
7. No external HTTPS-link importer in this PR. It needs separate CORS/referrer/privacy design and an explicit feature gate; don't conflate the accepted HTML demo with implemented production.

## Acceptance and limits

- Vitest: reject zero/21 files, bad per-file size and >256MiB batch *before* encryption, preserve prior successes on a failed file, stop after identity change, no fake cloud completion.
- Chromium/PG18/Garage: true authenticated camera-independent Browser upload, local offline multi-input of WAV+WebM, inspect independently signed AES-GCM P2 chunks and private per-file metadata, verify two opaque files in only the selected encrypted folder, drag/drop third WAV using same current-folder default, reload without loss, server ACK for all three after online resumption.
- No full UI shell v3 adoption claimed: this is **one functional capability in the current Vue panel**. Multiple-file CORS link import, physical Safari/iOS/Android, 256MiB real-device performance and end-user UX approval not tested.
- Exact-head PHP8.4/8.5 security floor, strict TS/Vitest/build, Security and isolated PostgreSQL18/Garage/Chromium workflow PASS required before claiming integrated verification.

No merges, public guest grants, Matrix, account-wide plaintext indexes, key rotation, physical GC or deployment.
