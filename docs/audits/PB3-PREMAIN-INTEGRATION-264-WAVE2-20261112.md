# PB3 second pre-main integration wave — Issue #264 (2026-11-12)

**Status: CANDIDATE / CI PENDING.** This is an integration branch for acceptance only. No main merge, deployment or production storage operations are authorized.

## Exact source lineage

- Original unified pre-main candidate: [#265](https://github.com/1troitsky/photobunker-v3/pull/265) @ `b5783a731ec565b6abf1158dc86ed13de6ea5c71` (4/4 PASS, Chromium 77/77). Includes V55 and the sole chosen GPS consent fix #263; #262 remains an alternative, not imported.
- Web brand-config descendant: [#268](https://github.com/1troitsky/photobunker-v3/pull/268) @ `33be05bd14d039da1a15281258b324a73ff8c150` (4/4 PASS, Chromium 77/77, Vitest 416/416). This is the direct parent of the new wave branch, not a second set of cherry-picks.
- Storage resiliency [#266](https://github.com/1troitsky/photobunker-v3/pull/266) @ **`57f330fb467e1ff695b3c147573f3ee0bcecb94a`**: full 4/4 CI PASS as a standalone verified source on #187.
- Server plans/entitlements and independently diagnosed assignment reauthentication race [#267](https://github.com/1troitsky/photobunker-v3/pull/267) @ **`89b40310bb26b719a9defa5811f46ea2694b994d`**: full 4/4 CI PASS as a standalone verified source on #187. The earlier `528bd27e` billing PR was 3/4 FAIL and is *not* the source for this wave.

## Method and collision analysis

The branch `integration/pb3-264-wave2-storage-billing-brand` starts from exact #268 HEAD, which inherits #265. All changed-path sets of #266 and updated #267 were checked against each other and the **entire ancestry diff** from #187 to #268 (not merely the changed files of #265). There are **zero same-path overlaps**. The complete code, tests and audit files of #266 (10 paths) and #267 (12 paths) were copied *exactly* via the GitHub contents API. A subsequent 22/22 source-versus-destination Git **blob SHA comparison passed**, with no local edits, wholesale merge, skipped test files or change of source branches.

Both new migrations share numeric prefix `2026_11_12_000007` but use distinct filenames; they are intentionally both present. Their combined Laravel runtime migrations, DB contracts, routes, services and the separate front-end GPS/assignment/retry paths **must pass together in CI**; no status is inferred from the non-overlap alone.

## Required exact-head acceptance

- Runtime/security floor, PHP 8.4/8.5, all PHPUnit assertions, TS/Vue build, Vitest, signed UX source guard.
- Fresh PostgreSQL 18 migrations containing both Billing and Storage tables, real Garage 2.5, actual outage-recovery QA, Chromium complete E2E (including previously negative GPS #258 and P1-13 assignment-media).
- Independent later proof that the new StorageRetryLedger worker actually recovers through real stop/restart and lost ACK; #266 PHP mocked resilience and #259 real Garage outage alone do **not** prove this combined new-worker case.
- Device acceptance in physical iOS Safari / Android PWA, Matrix A↔B/SAS/4S/Panic, owner-approved release gate #183 remain **NOT TESTED / BLOCKED** and are never implied by GitHub Actions.
- Public brand-config slice #268 has passing CI, but Public Card, real push, payments/invoice branding and PWA signed activation remain pending within #240 and related issues.
- GB vs GiB plan byte ceilings remain OPEN; no artificial quota ceiling or fictitious paid entitlement is permitted.

## Result

Candidate source files: **22/22 identical blobs** verified. Exact combined CI not yet accepted at document creation. If integration fails, diagnose and patch only the verified integration branch after preserving first failure evidence, without modifying source PRs or weakening tests. Source issues remain in review, Draft PRs remain open, and `main` stays unchanged.
