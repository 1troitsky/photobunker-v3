# PB3 P4 #346 Stage 2 — Placement internal physical preflight (post-#336)

**Date:** 2026-11-14 · **Coordinator:** CHAT-T · **Status:** review candidate, exact-HEAD integration CI PENDING; **NOT active S3 switching**.

## Exact source and scope

- Current accepted main parent: `8ed66c438d090efd218efa80b027f0b2f854db4b` (reviewed patched Composer lock; Git tree `7f2026e3818cae77712d23433475369606f901b0`). Branch `integration/p4-346-placement-preflight-chat-t-20261114` is created from that main, independent of BYO #356.
- Read-only source owner CHAT-H: feature #233 / [Draft PR #319](https://github.com/1troitsky/photobunker-v3/pull/319) exact original HEAD `6f5859429db31ac2a11d7fba7898b92a479987e0`, based on old `6565a0fe...`. Source component contains no shared StorageManager/routes/active pointer changes.
- All NINE non-workflow source paths copied using byte-identical original Git blob SHA. Source dedicated workflow `.github/workflows/p4-placement-readiness-233.yml` copied with ONE bounded adjustment: **removed two unsafe inherited `60407676...` checkout/Composer.lock override steps**; workflow now uses current accepted main dependency lock and retains strict `composer validate`, `composer audit --locked`, `composer install`, both full PHP8.4/8.5, actual PG18, genuine two-Garage tests and explicit fail-closed process markers. Removed obsolete source push filter; PR trigger and manual dispatch retained.
- New unique report `docs/audits/P4-MULTI-S3-346-PLACEMENT-RECONCILE-20261114-CHAT-T.md`. Exactly 11 ADD-ONLY paths; source branch and other agents' integration PRs untouched.

## Isolation and boundaries

- `PlacementReadiness` performs trusted account, TTL, tombstone and registered-location checks then real SHA-256/bytes readback for BOTH sources, rechecks locations/asset metadata after network reads, returns `physical_preflight_only`, `switchAuthorized=false`.
- `PlacementPreparationLedger` is an internal additive sidecar journal, candidate generation CAS with PostgreSQL account row `FOR UPDATE`, idempotency, stale generation denial and recovery; physically validated object_key/provider/size/hash/state/updated_at fingerprint checks under account lock.
- No caller activates production placement, edits main active location, rewrites S3, creates or rotates user credentials, deletes any live object, enables cron or adds a route. The test uses two disposable Garage 2.5 endpoints in the same CI runner (not genuine region/operator separation) and synthetic ciphertext only.
- BYO HTTPS/DNS/PIN [stage 1 PR #356](https://github.com/1troitsky/photobunker-v3/pull/356) already had 5/5 exact-head CI PASS but is separate and NOT integrated into this branch. Placement is intentionally isolated from #356 to avoid a hidden cross-PR merge; combined secure transport still NOT TESTED.
- Source #319 had historically false-green PG race because Laravel CLI could exit 0 on an exception. Preserved hard-fail explicit 1/2, 2/2 and COMPLETE marker checks and corrected `pg_stat_clear_snapshot()` logic from source final HEAD.

## Acceptance and NOT TESTED

- Intended dedicated CI evidence: PHP8.4/8.5 Laravel full + focused tests, PG18 two separate PHP processes row-lock races, two actual disposable Garage ciphertext SHA readback (healthy/missing/corrupt), outage and restart, full independent Foundation/Security/UX and PG18/Garage/Chromium on exact new commit.
- Do not infer PASS from source's prior actions. Post actual new integrated SHA, run IDs and failure history in Issue #346 and Draft PR.
- STILL BLOCKED/NOT TESTED: authentic BYO TLS/SNI peer-pinned transport; independently operated S3 providers; live two-provider replication, physical switch & rollback, 404/timeout and in-flight upload fencing in production; S3 credential rotation; signed multi-location manifests; cross-account/device E2EE ACL; remote purge/tombstones; iOS/Android hardware acceptance. **No live StorageManager switch, no main merge, deploy or destructive operation**.

**Coordination:** [journal #302](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6875028734), [stage2 Issue #346 CLAIM](https://github.com/1troitsky/photobunker-v3/issues/346#issuecomment-6875036471).
