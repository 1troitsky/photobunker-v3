# PB3 P2 Browser large-account QA — Issue #194

**Scope:** QA only · no product/runtime changes · integration parent PR #187 @ `7a309508cc140897ae6dd75f8d473a89c7296be2` · child Draft PR #253 · `tests/e2e/p2-browser-large-account.spec.ts`.

## Source and acceptance boundaries

Normative source: `ts.md` §12, §25.19, §26 (P2). Parent UX+Product PR #187 contains the existing Browser, MediaFile authenticated index, Playwright tests and real disposable PostgreSQL 18/Garage harness. The QA changes are independently reviewable without editing Shell, Viewer, approved UX or production code.

A **synthetic opaque index entry is not a signed or server-authorized media object**. The experiment therefore deliberately separates a high-volume browser-side *metadata-only* stress test from a small, genuinely cryptographic backend/media test. Neither half may be represented as a fully seeded 10k-file PostgreSQL/Garage acceptance.

| Question | Coverage | Gate |
| --- | --- | --- |
| 10,051 synthetic metadata objects use AES-GCM | WebCrypto AES-256-GCM per-record encryption with 96-bit independent nonce; fixed 100-job batches, one round-trip check; ciphertext sizes recorded | Automated test, GitHub run outcome in PR/Issue |
| 202 pages / 10,051 UUIDs, 50 per page | Call the **actual** `appendAuthenticatedCatalogPage` for every page; assert no duplicate, skip, stale replay, invalid end cursor, or >50 page | Automated test |
| 257 virtual folders, private query and sort | Call the **actual** `buildCatalog`, `scopeCatalogFolders`, `filterCatalog`; ensure no plaintext keyword in opaque index | Automated test; synthetic folder placement only |
| Bounded optional cloud expansion | Call the **actual** `loadBoundedCatalogIndex`, expect 10 pages / 500 rows and `complete=false` for a >10k source | Automated test; intentionally not a global search |
| Real A→B cloud media access | Create **one** genuine encrypted MediaFile and real owner account; obtain server ACK; recover in a second independent browser; inject 50 **synthetic list-only** IDs followed by this genuine server index row | Automated test against disposable PostgreSQL/Garage, not 10k real files |
| Real Viewer page-2 E2EE | Verify actual server manifest/receipt/chunk and AES-GCM plaintext content; negative invented UUID denied | Automated test |
| No secret leakage | Only opaque IDs in index and request endpoint assertions; attach diagnostic JSON with counts/times only | Test covers these paths; not a whole-app log audit |
| Real 10k S3/ciphertext objects | Not provisioned; synthetic entries are not stored in PostgreSQL/Garage | **NOT TESTED** |
| End-to-end signed cursor | Current server cursors are UUIDs without MAC/signature | **SPEC GAP** |
| Heap/CPU on mobile and real PostgreSQL latency under 10k data | No real 10k database seeding, no native mobile measurement, no invented SLA | **NOT TESTED** |

## Known source-level gap: cursor is not cryptographically signed

The parent `apps/api/app/Http/Controllers/MediaV1Controller.php::index` reads `after` as a UUID via `P::uuid($after)`, filters the **account-scoped** `media_files_v1` query with `where('id','>',$after)`, and returns the last result media ID as `nextCursor`. The client `apps/web/src/features/assignments/application/bounded-uuid-pages.ts` checks UUID shape and strict increasing order, and `authenticated-catalog-page.ts` translates invalid pages to `browser.invalid_cloud_catalog_page`.

These are useful pagination-integrity and account-scoping controls, **not a cryptographic signature binding cursor to account, filters, expiry, snapshot or purpose**. The issue title's *signed cursor* criterion cannot be certified as PASS. This observation does **not** prove a cross-account ACL bypass: the server still uses a trusted account from the session. A production fix and security review must be a separate scoped Issue/PR; this QA branch does not modify the backend.

## Reproduction / evidence

The new filename is included by `tests/playwright.config.ts`'s existing `p2-browser-*.spec.ts` pattern. Existing CI `.github/workflows/p0-02-storage.yml` runs Chromium with a disposable PostgreSQL 18/Garage stack. No workflow configuration changed.

```sh
pnpm exec playwright test --config tests/playwright.config.ts tests/e2e/p2-browser-large-account.spec.ts
```

The first test attaches `10k-synthetic-index-metrics.json` with counts, elapsed wall time (observational, not an SLA), and configured batch upper bound; the second attaches `real-e2ee-two-page-evidence.json`. No Recovery Key, decrypted file contents or synthetic private names are attached. On failure, existing workflow uploads traces.

**CI evidence/results:** see actual SHA-specific PR #253 GitHub Checks and Issue #194 comments. Never derive PASS from the presence of this source file or from a green unrelated Foundation/Security check.

## Deferred acceptance

1. Seed **10k+ real and uniquely encrypted** media/folder objects into disposable PG18/Garage through real authorization and receipts; measure real server index limit/cursor and conflict behavior, not synthetic mock counts.
2. Verify dynamic add/delete/archive concurrent with pagination, stable snapshot policy, server ACL recheck, full loaded-index scope and exact decryption permissions for two accounts.
3. Implement/review an independently bound, authenticated cursor contract if the signed-cursor requirement remains normative (version, HMAC/signature, account/scope, expiry and rotation).
4. Capture actual memory/CPU/latency on a constrained device, and Safari/Android; do not infer bounded heap from a bounded page count.
5. If a product bug is proven, file it separately; keep this PR QA-only and don't merge or close Issue #194 without owner acceptance.
