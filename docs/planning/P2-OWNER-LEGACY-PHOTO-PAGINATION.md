# P2 V-19 — Owner pagination for legacy P1 photo_records submissions

**Status:** Draft, needs exact-head CI. Parent P2 V-18 #114 at `53ddc559b151b7ced722d7defa7a5cea5ce58d3c`. No merge into main, deploy, Matrix, or physical deletion.

## User scenario

P2 Photo MediaFile owner submissions received paging in #114. The older P1 `photo_records` pathway, which is still supported by existing signed photo capture submissions, independently returned **at most 50** rows with no next cursor, even though the server's confirmed count could correctly be >50. Both lists now have explicit independent bounded continuation controls.

## Backward-compatible API and UI

- Owner-only `GET /assignments/v1/:id/submissions` accepts an optional validated UUID `after`, orders by immutable submission ID, fetches 51 rows and returns at most 50 plus `nextCursor`. All existing contributor media ownership / E2EE grant live filters and retention/owner authentication remain. The original `items` response schema and `listAssignmentSubmissions` first-page helper are preserved.
- Vue owner list has an independent **«Загрузить ещё фотографии»** control for legacy P1, separate from P2 media pagination. Each additional page passes the same bounded monotonically ordered and de-duplicated UUID cursor validator. Cached prior owner rows are not confused with current assignment/account.
- The P1 owner list does **not** claim new independent cryptographic verification of historical P1 photo receipt signatures; that remains a distinct security acceptance question. P2 MediaFile signed consent verification from #113 is unchanged. Neither path exposes private GPS or unencrypted photo content.
- PHP feature regression builds 52 distinct contributor-owned photo grants and submissions, checks first 50 + next 2, cursor validation and outsider denial. Vitest checks same 52-row bounded append and no duplicates / cursor rollback.

## Release gate

Exact-head PHP 8.4.27+/8.5.12+, Laravel, Vitest/strict TS/build, PostgreSQL18/Garage and real Chromium workflow must pass, then independent live 51+ account E2EE photo submission, owner paging and revocation test. Native Safari/iOS/Android and owner acceptance NOT TESTED. No green CI or production readiness claimed until verified.
