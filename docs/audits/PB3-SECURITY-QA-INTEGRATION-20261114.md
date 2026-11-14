# PB3 — P0 Laravel patch + deterministic E2EE negative QA pre-main integration · 2026-11-14

**Integration owner:** CHAT-L · [coordination #302](https://github.com/1troitsky/photobunker-v3/issues/302) · [wave-2 CLAIM #289](https://github.com/1troitsky/photobunker-v3/issues/289#issuecomment-6871393125). **Review-only Draft. NEVER merge `main` or deploy without the owner's explicit, specific approval.**

## Base, selected immutable sources, strategy

- Exact accepted main/base: `6565a0fe852882ea5fc26e493df81affed687eee` (merged #293).
- P0 security source: [PR #298](https://github.com/1troitsky/photobunker-v3/pull/298) at `60407676c7cb9bdb649f5017cf9450aff25eedab`. Select **only** exact source blob `apps/api/composer.lock` (`c4bcae0458bd390b797186c3e2ccf536469588ef`) and its authored audit `docs/audits/P0-LARAVEL-CVE-2026-128083-297.md` (`b52a9432cd2d05b3ad78330a26d439ad9e19d8c3`). Locked Laravel 13.39.0 → 13.42.0, no ignore/suppressions. No `composer.json` edit.
- P1 security test determinism source: [PR #312](https://github.com/1troitsky/photobunker-v3/pull/312) at `5be3834fc03c9bcf2e47ec0dfac3415ed5903115`: exact blob `apps/web/src/features/identity/infrastructure/crypto.test.ts` (`257f01caf5c2d5e87d9b72de05f70ab118a2a5f9`) and independent source audit `docs/audits/P1-IDENTITY-CRYPTO-TAMPER-311-20261114.md` (`abf235e76d860520159a0f96dc9afa4231f12dba`).
- P2 security test determinism source: [PR #313](https://github.com/1troitsky/photobunker-v3/pull/313) at `f69afd2cc3ebb7c55eb7ecd86eb587bf2c1f75a3`: exact blob `apps/web/src/features/browser/application/folder-sync-crypto.test.ts` (`8392b5835c316bb812f43b75834e590d91d21859`) and source audit `docs/audits/P2-FOLDER-SYNC-TAMPER-309-20261114.md` (`6d8aac3e2bd7a9a93a9c9353f1ee841153984925`).

These six source blobs are assembled onto exact main by a NEW single-parent Git tree/commit; **not** a chain merge, rebase, patch recreation, or modification of foreign source branches. Original 3 Draft PRs stay open and keep independent ownership/provenance. Preserve prior E2EE negative tests and full baseline product code.

## Explicit exclusions

- **Do not copy `TS_PROGRESS_TABLE.md` from security PR #298.** Its snapshot refers to pre-#293 main; newer post-merge status proposed in standalone [PR #294](https://github.com/1troitsky/photobunker-v3/pull/294). Leave current root table untouched until independently reconciled, not part of this code gate.
- Source PR #312/#313 dedicated **extra QA-only workflows** are retained in their own Draft branches and evidence, not proliferated into production `.github/workflows` through this concise main-bound batch. Existing main full Foundation + PostgreSQL/Garage + Chromium + security/UX workflows must validate combined code. No disabling/weakening tests.
- Deliberately **do not integrate** #292 Messages, #296 Notifications, #306 AV, #308 PIN, #315 Panic, #316 Checkout, #317 Analytics, #319 Placement, #320 Remote Wipe, #321 Replication, #322 Legal or #323 S3 Failover: independent integration/release gates and active foreign owners; product routes/destructive activation not ready.
- Native iOS Safari / Android PWA, production key trust, real Matrix E2EE, real DePay settlement, destructive Panic/Remote Wipe, full S3 failover/Backup restore, P1–P4 full PB3 release criteria are **NOT TESTED / BLOCKED**, not inferred from security+QA test success.

## Source-level evidence (not combined acceptance)

- #298 exact final SHA: 4/4 GitHub workflows PASS, Composer locked audit 0, PHP8.4/8.5 245 tests each, Vitest449, Chromium84/84 on same-head rerun. Initial same-SHA Chromium 83/84 timeout preserved. See [source audit](./P0-LARAVEL-CVE-2026-128083-297.md).
- #312 final SHA: isolated QA/security/UX workflows PASS; deterministic decoded-byte AES-GCM negative tests; [source audit](./P1-IDENTITY-CRYPTO-TAMPER-311-20261114.md).
- #313 final SHA: isolated QA/security/UX workflows PASS, with same-head transient Packagist timeout and successful rerun retained; [source audit](./P2-FOLDER-SYNC-TAMPER-309-20261114.md).

## Required combined-HEAD verification

Record exact *new integration commit* + independent 4/4 workflow results: Composer validate/audit, PHPUnit PHP 8.4/8.5, Vitest/TS/build, real PG18/Garage/Chromium, security and UX, regressions of both negative tests. **Combined-HEAD result at initial commit: PENDING, not PASS.** If CI fails, retain evidence and report; no main merge. Recheck current `main` and source blobs before suggesting concrete owner-approved merge. Propose the batch only after independent full combined CI PASS and file-level change verification.

