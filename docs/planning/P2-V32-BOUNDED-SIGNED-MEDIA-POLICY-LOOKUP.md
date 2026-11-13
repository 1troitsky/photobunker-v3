# P2 V-32 — bound signed policy lookup for MediaFile E2EE grant

**Status:** Draft; exact-head CI pending. Parent PR #126 (verified local member removal fence, SHA `9b1d2321`, its Chromium rerun pending at branch creation). All PR Draft; `main` unchanged; Matrix paused.

## Gap

`preflightAssignmentMediaGrant()` already verifies signed owner policies via `listServerAssignments()` and correctly supports an assignment on page 2+, but its `do/while(cursor)` previously trusted that the next server cursor would eventually terminate. A server returning repeated or backwards cursors could trigger unbounded network requests, P-256 checks and private-history verification just before the user grants an E2EE media key. A truncated middle page carrying a cursor could also incorrectly skip unseen policy records.

## Change

- `findBoundedAssignmentPolicy()` limits the preflight to **100 pages**, with the same 50-record page and strictly monotonic UUID cursor rules already used for the main Fieldwork overview via `appendBoundedUuidPage()`.
- `listServerAssignments()` still cryptographically validates every fetched owner-signed policy and histories, and enforces account/session isolation before caching encrypted policy snapshots. This lookup validates page shape and cross-page ordering, stops as soon as the exact requested assignment is found, and does **not** unnecessarily read every subsequent assignment in a large account.
- Malformed, missing, duplicate, backwards, replayed, truncated, never-terminating or too-long pages fail closed. A clean final page with no requested ID returns no policy; the preflight refuses the E2EE grant.
- The previously verified local owner removal tombstone remains checked before lookup and after expensive decrypt/signature work; this does not create new grant authority or modify original media.

## QA

- Vitest: item 53 on page 2 of correctly signed 50-record first page, early match without unnecessary fetch, valid terminal/missing target, 5 invalid page shapes/cursors, repeated first page, and 100-page upper cap.
- Exact-head PHP8.4/8.5, TS/Vitest/build, Security, and real PostgreSQL18/Garage/Chromium A↔B acceptance required before PASS. Separate physical Safari/iOS/Android and 5k-account production load testing NOT TESTED.

No public sharing, Matrix, plaintext metadata indexing, owner-invisible E2EE bypass, merge or deploy.
