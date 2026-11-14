# PB3 P4 #346 Stage 3 — Internal verified ciphertext replica ledger integration

**Date:** 2026-11-14 · **Coordinator:** CHAT-T · **Status:** Draft proposal; exact-HEAD CI not yet verified. **NOT live replication, NOT production multi-provider redundancy**.

## Source and integration scope

- Parent accepted main: `8ed66c438d090efd218efa80b027f0b2f854db4b` with Git tree `7f2026e3818cae77712d23433475369606f901b0`, after owner-authorized PR #336 and current approved Composer security patch. New branch `integration/p4-346-replication-preflight-chat-t-20261114` begins directly on this main, independent of prior BYO and placement integration PRs.
- Original source #234 / [Draft PR #321](https://github.com/1troitsky/photobunker-v3/pull/321), exact source HEAD `7d3281e7cfb24465ad182794bbd8c8bb122cf188`, OLD parent `6565a0fe...`; original CHAT-H ownership, branch and full history left untouched.
- Exactly nine source non-workflow files imported as byte-identical original Git blobs, all absent from accepted main. Isolated `.github/workflows/p4-replication-234.yml` copied with only five precise non-test-behavior adjustments: remove two inherited checkouts of historical security patch `60407676...` and their Composer.lock overwrites, remove obsolete feature-branch push filter in favor of explicit workflow_dispatch, add this report to path triggers, label run as #346. **No relaxation of locked Composer audit, existing assertions, test timing, two-Garage or two-PHP race checks**.
- Unique new audit file `docs/audits/P4-MULTI-S3-346-REPLICATION-RECONCILE-20261114-CHAT-T.md`; 11 all-ADDED paths and zero modifications/deletions to existing main. No StorageManager, routes, S3 provider registrations, cron, global cleanup or TS_PROGRESS_TABLE edits.

## Imported non-activating contract

- `CiphertextReplicaCoordinator` internal explicit-only replica transfer/lease service: checks trusted tenant/Photo/Media access and live TTL/tombstone status, pinning durable source and target ciphertext SHA/length, copies only encrypted bytes, physically verifies target readback **before** durable ACK, lost-ACK replay idempotent with no duplicate remote PUT; retries with leases/backoff. Preserves source, no customer data or plaintext access.
- `BoundedReplicaDispatcher` explicit-only due-job selector, cap 16 jobs, 64MiB, 2 jobs/account and 12 attempts, 8MiB/file, ranked bounded selection; local call-budget is NOT global distributed rate limiting; `noAutomaticScheduling=true`. It is not a scheduler/route/daemon and proves no production delivery.
- Additive sidecar `ciphertext_replication_jobs_v1` retains provisional candidates/leases. Two test-only isolated Garage2.5 endpoints on the SAME runner with separate fixtures; account-fenced PostgreSQL18 concurrent lease and lost-ACK worker tests with independent PHP processes and explicit hard-fail stdout markers. Physical checksum/repair and Garage outage/restart checks use synthetic ciphertext.
- Stage1 [BYO guard PR #356](https://github.com/1troitsky/photobunker-v3/pull/356) exact-head 5/5 CI PASS, Stage2 [Placement PR #359](https://github.com/1troitsky/photobunker-v3/pull/359) dedicated two-Garage/PG18 CI PASS but unrelated global Chromium final pending at start. **Neither Stage1 nor Stage2 is merged or stacked into this new branch**; cross-component interoperability is NOT proven.

## Strict acceptance and remaining gates

- Before any substage REVIEW/PASS, verify CURRENT integration SHA, exact-head dedicated PHP 8.4/8.5 full+focused tests, true PG18 two-PHP race, dual Garage SHA/retry/outage/lost ACK, Foundation (Composer audit 0, Vitest, TS/build), Security, UX, and global real PG18/Garage/Chromium. Historical source green CI does not count.
- Not integrated/tested: live external BYO HTTPS peer pin/SNI/credential rotation, independent cloud operators/regions, auth production S3 adapters, live uploader/StorageManager routing and rate limits, remote background replication, active pointer, true failover/revert, crash-proof multi-provider tombstone/GC, E2EE device/owner cross-account acceptance, iPhone Safari and Android PWA.
- No activation or mutation of production account/cloud data, original source branches, concurrent agents' paths, main, shared CI, or any merge/deploy.

## Coordination

- [Journal #302](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6875117664) and [exclusive Stage3 #346 CLAIM](https://github.com/1troitsky/photobunker-v3/issues/346#issuecomment-6875126765).
- Final exact-head workflow results, links and PASS/FAIL/BLOCKED status must be posted as Issue and PR comments when observed, not pre-filled.
