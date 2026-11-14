# PB3 — P1/P2 deterministic E2EE tamper QA, reconciled after P0 Laravel main merge · 2026-11-14

**Owner:** CHAT-L · [coordination #302](https://github.com/1troitsky/photobunker-v3/issues/302) · [exclusive integration CLAIM #289](https://github.com/1troitsky/photobunker-v3/issues/289#issuecomment-6871942184). **Review-only Draft #325**; never merge or deploy without owner's specific permission.

## History and approved security baseline

1. Accepted pre-P0 main: `6565a0fe852882ea5fc26e493df81affed687eee`.
2. Independently authored source [PR #298](https://github.com/1troitsky/photobunker-v3/pull/298) at `60407676c7cb9bdb649f5017cf9450aff25eedab` provided patched `apps/api/composer.lock` blob `c4bcae0458bd390b797186c3e2ccf536469588ef` (Laravel 13.39.0→13.42.0) and audit `docs/audits/P0-LARAVEL-CVE-2026-128083-297.md`. Owner-authorized security-only [PR #326](https://github.com/1troitsky/photobunker-v3/pull/326) merged both source blobs without source #298's stale `TS_PROGRESS_TABLE.md` change.
3. **Live accepted main after P0 fix**: `5aaba8b0509c354f8abb00806180f4ce6cb6ad18` (ordinary two-parent #326 merge). Main post-merge security, Foundation and PG18/Garage/Chromium workflows **3/3 PASS**: [security 43556739272](https://github.com/1troitsky/photobunker-v3/actions/runs/43556739272), [foundation 43556739327](https://github.com/1troitsky/photobunker-v3/actions/runs/43556739327), [PG18/Garage 43556739270](https://github.com/1troitsky/photobunker-v3/actions/runs/43556739270).
4. Own initial main-based integration [Draft #325](https://github.com/1troitsky/photobunker-v3/pull/325) code HEAD `9b22c19fbac900fea8dd1d0f3ff5d830ee30ed40` had **4/4 exact-HEAD PR CI PASS**: Security [43554799071](https://github.com/1troitsky/photobunker-v3/actions/runs/43554799071), UX [43554799021](https://github.com/1troitsky/photobunker-v3/actions/runs/43554799021), Foundation [43554798954](https://github.com/1troitsky/photobunker-v3/actions/runs/43554798954), PG18/Garage/Chromium [43554798995](https://github.com/1troitsky/photobunker-v3/actions/runs/43554798995).

**Now integrating accepted main ancestry into our OWN #325 branch only**, preserving its original SHA as first parent and the new accepted main SHA as second parent, with one report update. No force/rebase or foreign branch edits. This makes the already-shipped Laravel lock and P0 audit content-equivalent to main and narrows the pending PR diff to **exactly two deterministic negative crypto tests and three QA provenance reports**.

## Selected unchanged P1/P2 source blobs

- [P1 Identity #311 / source Draft PR #312](https://github.com/1troitsky/photobunker-v3/pull/312) at `5be3834fc03c9bcf2e47ec0dfac3415ed5903115`: `apps/web/src/features/identity/infrastructure/crypto.test.ts` original exact blob `257f01caf5c2d5e87d9b72de05f70ab118a2a5f9`; accompanying [QA audit](./P1-IDENTITY-CRYPTO-TAMPER-311-20261114.md) exact original blob `abf235e76d860520159a0f96dc9afa4231f12dba`. Authenticated decoded-byte tamper, revision/AAD/signature and fresh independently sealed recovery envelopes, negative tests preserve existing assertions.
- [P2 Folder Sync #309 / source Draft PR #313](https://github.com/1troitsky/photobunker-v3/pull/313) at `f69afd2cc3ebb7c55eb7ecd86eb587bf2c1f75a3`: `apps/web/src/features/browser/application/folder-sync-crypto.test.ts` original exact blob `8392b5835c316bb812f43b75834e590d91d21859`; accompanying [QA audit](./P2-FOLDER-SYNC-TAMPER-309-20261114.md) original exact blob `6d8aac3e2bd7a9a93a9c9353f1ee841153984925`. Re-signing modified ciphertext cannot bypass AES-GCM, no fake random Base64URL mutation acceptance.
- Source #312 and #313 had their own dedicated exact-HEAD QA/security/UX PASS. Their two extra QA-only workflow files are NOT copied into main-bound integration, preserving existing 4 workflow gates.
- No production encryption implementation or API change, no test skip/xFail, no weakening of tests. No edit to source authors' PRs/branches.

## Scope / exclusions

- Keep `TS_PROGRESS_TABLE.md` unchanged, do not reintroduce old #298 status file. Current #294 documentation has independent ownership.
- No #292 Messages, #296 Notifications, #304 Contacts, #306 AV, #308 PIN, #315 Panic, #316 Checkout, #317 Analytics, #319 S3 Placement, #320 Remote Wipe, #321 Replica, #322 Legal, #323 S3 Failover, #324 Admin grant changes.
- Native iOS Safari/Android PWA, 50-minute microphone, Recovery Key physical device, complete product Matrix, Panic/Remote Wipe, provider failover, payment settlement and 25 final PB3 scenarios remain NOT TESTED / BLOCKED. **Green E2EE QA-only suite does not imply PB3 release-ready.**

## Reconciled exact-head CI acceptance

Following this document update + accepted-main ancestry merge, obtain a NEW HEAD and independent 4/4 GitHub workflows (real Composer locked audit; PHPUnit 8.4 and 8.5; full Vitest + TS/Vite build; real PG18/Garage/Chromium; security + UX). **New reconciled HEAD CI is PENDING at creation**. Do not rely exclusively on previous passing SHA. Record any flakes with original run and exact failure; never suppress. Verify the changed-file inventory is five paths only and that correct P1/P2 source blob SHA is preserved. Do NOT merge this QA-only PR without specific owner approval.
