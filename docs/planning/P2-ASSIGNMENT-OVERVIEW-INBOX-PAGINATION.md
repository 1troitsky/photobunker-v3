# P2 V-26 — full Fieldwork overview and received-invitation pagination

**Status:** Draft; code written, exact-head CI pending. Parent #120 @ `ab7914bdc31d8c5f24803bafc2a8909a3456604a` 3/3 workflows PASS. `main` unmodified. Matrix paused. No anonymous/public E2EE, new media access or physical GC.

## Problem

The server `GET /assignments/v1` already supported a 50-row UUID cursor, and the recipient-only removal history introduced in #120 was separately paginated, but the primary Fieldwork overview UI called `listServerAssignments()` once. More than 50 valid assignments were invisible in the overview despite server authorization. The incoming `GET /assignments/v1/invites/received` API returned only the first 50 active/pending invitations without any cursor; the client also cached only those 50. The 51st invite could not be seen or independently accepted from the UI.

## Implementation

1. Recipient `GET /assignments/v1/invites/received` now returns original unchanged `items` schema **plus** `nextCursor`, uses 51-row lookahead and max 50 rows ordered by unique invitation UUID, and accepts a validated optional `after` query cursor. Owner/outsider scoping, signed removal exclusion, current expiry/retention and owner account SPKI data unchanged.
2. New shared typed `appendBoundedUuidPage()` ensures at most 50 entries, strictly increasing unique UUID IDs, page-to-page continuity, exact server `nextCursor` equal to last actual returned UUID, no repeated/stale cursor, no empty loop. A forged/incomplete page chain fails closed with `assignment.invalid_cursor_page`.
3. `listAssignmentInvites()` loads up to 100 bounded authenticated pages for the current account. Only after *all* pages validate does it write encrypted/opaque invite records to account-scoped IndexedDB; partial page errors must not poison the cached inbox. Each invite's signed consent continues to require independent pinned owner verification before accepting; paging alone never authorizes membership.
4. `listAllServerAssignments()` consumes up to 100 already independently verified, signed policy pages through existing `listServerAssignments()`, retaining historical private/schedule/retention signature verification and scoped local ciphertext cache. UI `hydrate()` renders **every page**, preserving Local-First offline fallback. Existing owner assignment details and encrypted summary not modified.
5. Removal history from #120 remains separate and can purge only a verified signed removed invitation; it cannot crowd out live invitations.

## Tests and limitations

- PHPUnit 52 synthetic FK-correct **independently signed** assignment roots and invitations accepted by one recipient, bypassing live quota only inside disposable test fixture; recipient first 50 then next 2, null terminal cursor, malformed cursor 422, full 52 overview, outsider has no graph. This is pagination/data-binding evidence, not an E2EE private-envelope decryption test for all 52.
- Vitest 50+2 invitation and overview pages, malformed UUID, repeated rows, forged/rollback/forward cursors, out-of-order page, >50 page. Real P1/P2 two-account E2E remains inherited.
- Current bounded limit is **100 pages / 5,000 rows** per refresh. Beyond that a specific explicit pagination-limit error is emitted, not silently truncated. A later virtualized/incremental UI may be preferable for very large accounts.
- Requires exact-head PHP 8.4.27+/8.5.12+, Laravel, TS/Vitest/build, isolated PG18/Garage/Chromium and Security CI. Native Safari/iOS/Android, 5,000-row performance and independent owner acceptance **NOT TESTED**.

No merge into `main`, deploy, public guest tokens, camera provenance claims or physical deletion.
