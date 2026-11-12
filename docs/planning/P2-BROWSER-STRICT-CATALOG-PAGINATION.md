# P2 V-34 — validate ordinary Browser photo/media cursor pages

**Status:** Draft/code written; exact-head CI pending. Parent #128 @ `e28bbbd58ed5d7f2d4001c6b3ac4a5a2036d3c35`, 3/3 PASS (291/291 Vitest, 41/41 Chromium), no `main` changes or Matrix work.

## Identified problem

The explicit V-33 extended private-search flow checked each authenticated cloud-list page for strict UUID order, page size and correct forward cursor, but Browser's ordinary **«Обновить»** and **«Загрузить ещё»** paths still trusted JSON `nextCursor` blindly and concatenated records. Even an account-authorized but malformed or changing server page could append duplicate entries, show stale material twice, advance past an unseen range, or make the UI incorrectly believe there were no further files. The encrypted file originals/outbox were not at risk; catalog integrity and search completeness were.

## Narrow change

- Share the already independently tested **`appendBoundedUuidPage`** invariants (UUID, strictly ascending row order, no repeated ID, max 50 records, nextCursor exactly last ID of 50-row nonfinal page, cross-page continuation).
- `refresh()` validates **both first cloud lists independently** before publishing them. A malformed P1 list cannot poison P2 and vice versa; local-first encrypted originals remain present.
- `more()` validates a retrieved P1/P2 page against the last successfully committed cursor and previous rows **before** replacing the Vue array or cursor. On malformed/repeated/truncated input the affected protocol's known-good records/cursor remain untouched. If the other protocol succeeded, its authorized list can still advance; UI reports a partial failure.
- This does not give the browser authority to sign cloud index rows; server remains the owner-account authorization/TTL/archive filter, and every private metadata/media read still verifies signed manifests, ciphertext SHA-256 and AES-GCM.
- No plaintext name, search term, tags or GPS in HTTP requests or local persistent index. Existing explicit extended search (max 1000) and ordinary 200-row default unchanged. No public recipient grants, physical GC or Matrix.

## Tests

- Vitest: P1 photo and P2 media 50+2 cursor pages, replay/duplicate/backwards/forged/truncated/out-of-order/invalid UUID, immutable previous trusted rows on failure. Inherited V-33 Chromium real owner/cloud E2EE journey and P2 media receipt checks.
- Required exact-head PHP 8.4/8.5 + TS/Vitest/build + Security + PostgreSQL 18/Garage/Chromium. Native Safari/iOS/Android and independent owner/product acceptance NOT TESTED.

No merge/deploy or destructive migration.
