# P2 V-38 — File Viewer bounded authenticated index and deep-link navigation

**Status:** Draft, code written, exact-head CI pending. Parent [Draft #132](https://github.com/1troitsky/photobunker-v3/pull/132) @ `987d619c31698809b1c088a4befa9f50ad79782a` (**3/3 workflow PASS**). All PR Draft, `main` unchanged; Matrix paused, Public/physical GC disabled. Accepted UX: PB2 PR #56 `docs/ux/browser/viewer/README.md` (File Viewer 1.0); this PR **only** improves existing production viewer's index correctness, not full visual/interaction UX parity.

## Discovered gap

The current E2EE File Viewer already reads and decrypts both P1 photo and P2 MediaFile originals, switches photo/video/audio in the shared scene and exposes a mixed-media pager. Its **independent** index reader (unlike hardened Browser #129) previously:

1. Trusted a server-provided first-page `nextCursor` and every follow-on page, appending rows without UUID order/duplicate/replay validation, permitting malformed/malicious/stale remote page to corrupt the visible navigation list and make it falsely seem complete.
2. Only loaded 50 P1 and 50 P2 rows initially. When an authorized Browser link opened an existing cloud-only file on page 2+, the Viewer could decrypt and play it but reported «Вне загруженного списка» and disabled adjacent navigation until manual loading; the direct target was never sought automatically.
3. Always cleared existing local-first index before any refetch, causing unnecessary disappearance of known-good local rows on same-device reauthentication even though key package and account remained stable.

## V-38 implementation

- Reuse proven `appendAuthenticatedCatalogPage()` strict per-protocol `<=50`, UUID version/order, non-overlap, non-advancing/replayed cursor and exact last-UUID-on-nonfinal-page validation for initial and every subsequent **photo and MediaFile** page. Reject corrupted per-protocol page **before** mutating its list/cursor; the other valid protocol and AES-GCM local originals stay accessible. A poisoned page never counts as evidence of authorization.
- New `findViewerTargetInBoundedIndex()`: for the **exact current target UUID + protocol only**, scan at most **10 pages × 50 opaque records**, stopping immediately on the matching ID. Query uses **existing account-authenticated GET /photos/v1 or /media/v1 only**; never sends any filename, tag, GPS, plaintext, signing key or search query. Every page validates same strict cursor, no infinite loop, no partial new rows published on an error. Preserves ordinary Load more for remaining entries. If 500 rows end before the target, explicitly show navigation coverage incomplete, **never** falsely claim all account records were searched.
- The view can still call **readCloudPhoto/readCloudMedia directly by opaque ID**, but always follows existing P1/P2 server per-read ACL/TTL and independently validated ciphertext receipt + AES-GCM decrypt. *Being on an index page is neither sufficient nor necessary to grant read access*. No public shares, guest DEKs, or retention changes.
- Cancel in-flight catalog pages on changed account/session or direct route change; don't overwrite a newer target with an old scan result. Same-session auth refresh now retains trusted local+index UI until replacement while a **true** account/device/key-package change still clears it.
- Routing and decrypted object URLs are unchanged; previous video/audio is still stopped on navigation. No new plaintext navigation cache/localStorage, no eager cloud content download for adjacent entries, no remote filename search.
- The current File Viewer is not yet fully aligned with owner-approved fixed 64/45/114/57/48/82px UX geometry, complete File Viewer actions, folder context restoration or all editor details. Those remain separate work; this PR doesn't claim UX acceptance.

## Acceptance evidence

- Vitest: valid target at #57 (50 + 7), first-page early stop, 500-record bounded incomplete index, malformed/replayed/overlapping/forged/truncated/descending cursor, route/session cancellation.
- Chromium PostgreSQL18/Garage A→B: real uploader creates one AES-GCM WAV MediaFile, gets server ACK; recipient is **the same recovered account on a second device** (not a separately granted account). Intercept ONLY opaque catalog index JSON, place 50 synthetic non-authoritative IDs before the **one real authorized** target on page 2. Viewer finds and displays 51/51, reads/verifies/decrypts real original bytes, name remains private. Then simulate poisoned Load more after an otherwise valid 50-row page including real target; unchanged position/ciphertext and visible error. The synthetic index rows are **QA for cursor handling**, not proof that client may decrypt ungranted files.
- Required exact-head PHP8.4/8.5, TypeScript/Vitest/build, Security, isolated PostgreSQL18/Garage/Chromium. Native Safari/iOS/Android, full 5,000+ item production load and end-user UX acceptance NOT TESTED.

No merge/deploy/Matrix/Public or physical GC.
