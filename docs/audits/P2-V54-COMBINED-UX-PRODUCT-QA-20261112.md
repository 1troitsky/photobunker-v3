# P2 V54 — PRODUCT + QA + UX integration (2026-11-12)

**Status:** DRAFT, common-tree CI and mobile/device acceptance not yet verified.

## Input commits
- Product + independent QA: PR #162 @ `ed0392fa83696fa15cf993b1791863d5b07a3a54` (includes #160, #159, upstream product stack).
- Existing integrated UX: PR #158 @ `b0b7a9ffbe0b3828ce4f60de31e8f52a1bc120ed` (includes UX-01..05, canonical accepted `docs/ux/**` snapshot and source/lane guards).
- Verified common merge base: product #157 @ `b887a0ffc993ad21a23eee7cac0d24eb66488215`.

## Actual reconciliation
Diffs against the common base: `166` UX file changes and `13` product/QA file changes. The sole overlapping path was `tests/e2e/p2-browser-file-viewer-index-target.spec.ts`. Preserve **PR #162** version `82e2fe7c2f67581c80002139671a0d2f28b38249` requiring scoped `.file-viewer-feedback [role="status"]` warning, preserved 50/50 index and actual forged-page delivery. #158 used `getByRole('status').filter({hasText:…})`, also accepted by its own isolated CI; no product code changed as part of resolution.

All other `165` UX changed paths are overlaid at **exact original blob IDs** onto #162's tree. Both source commits are retained as ordered parents, with #162 as first parent (PR target). No code generated from demos, no runtime E2EE/auth/TTL modifications, no cherry-pick or merge to `main`.

## Gates
- Prior individual #158 CI verified 60/60 Chromium on V52, **not** this V54 combined tree.
- #162 exact-head after rerun: P0 foundation+security+real PG18/Garage **3/3 PASS**, Chromium **54/54 PASS** (workflow https://github.com/1troitsky/photobunker-v3/actions/runs/43175443452, attempt 2). First attempt 53/54 fails an HTTPS rejection alert locator; rerun passes unchanged. Treat original as retained intermittent-failure evidence, not guaranteed fixed.
- Required on this common commit: PHP 8.4/8.5, Vue typecheck/build/Vitest, security source/lane guards, PostgreSQL/Garage full Chromium; no retries/skip/relaxed authorization.
- Manual Safari/iOS/Android, visual approval and exact integrated product acceptance **NOT TESTED**.
- No automatic merge/deploy; source PRs #158/#160/#162 and main unchanged.
