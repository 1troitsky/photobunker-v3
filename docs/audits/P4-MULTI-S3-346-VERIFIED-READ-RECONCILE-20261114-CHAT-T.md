# PB3 P4 #346 Stage 4 — Verified physical replica read preflight on current main

**Coordinator:** CHAT-T · **Date:** 2026-11-14 · **State:** Draft integration, exact-head tests PENDING. **NOT live failover or primary switch.**

## Origin and isolated scope

- Accepted patched main `8ed66c438d090efd218efa80b027f0b2f854db4b`, Git tree `7f2026e3818cae77712d23433475369606f901b0`, remains unchanged, with dependency security fixes from authorized main.
- Source owner CHAT-M / Issue #235: original [Draft #323](https://github.com/1troitsky/photobunker-v3/pull/323) exact HEAD `06659a874390dda3619fe4bb62eff7218871b530`, OLD base `6565a0fe...`. Source branch, claims and exact source files never modified.
- Independent main-derived branch `integration/p4-346-verified-replica-read-chat-t-20261114`, **NOT stacked** on Stage1 [#356](https://github.com/1troitsky/photobunker-v3/pull/356), Stage2 [#359](https://github.com/1troitsky/photobunker-v3/pull/359), Stage3 [#361](https://github.com/1troitsky/photobunker-v3/pull/361). Five source non-workflow path Git blob SHAs exact, all absent on main.
- Isolated scoped workflow `.github/workflows/p4-failover-235.yml` copied only with removal of two old checkout+Composer.lock overwrites referencing historical security ref `60407676...`, now checked directly against **current accepted main**. Strict Composer audit, both PHP8.4/8.5/full PHPUnit, true PG18 negative fixtures, physical dual Garage and explicit-failure exit markers preserved. Source's obsolete branch push filter changed to manual dispatch; this audit is included in workflow PR paths. Sixth import plus this unique new report = **7 ADD-ONLY files**; zero existing production app/global workflow paths changed.

## Non-activating contract

- Internal `ReplicaReadPreflight` selects a **server-trusted account and logical Photo/Media object**, verifies current owner/ready state/TTL/retirement/tombstones, primary+secondary registered metadata and complete encrypted SHA256/bytes before physical read. Reads only physical secondary S3 object on test adapter; rechecks owner and mutable DB identities/timestamps/state/TTL/tombstone after physical read (avoid TOCTOU, ABA, post-GET expiry). Rejects changed/revoked/unverified/corrupt/unavailable target. Always `failoverAuthorized=false`.
- No public API, storage read routing, active provider pointer change, true failover or automatic fallback. No user credentials, plaintext, real S3 provider setup, deletion or remote purge. Test-only two Garage2.5 nodes share same CI host: **distinct processes/data mounts, NOT independently operated failure domains**.
- Dedicated S3+PG tests have source evidence for seven physical scenarios (healthy/corrupt/missing/stale, stopped primary with verified secondary, secondary outage, recovery) plus separate PHP-process revision/ABA/deletion races, actual post-S3-GET tombstone and TTL expiry. Exact-head integration must independently re-run all before acceptance.

## CI and product limits

- Before bounded REVIEW, verify source SHA, current main, exact integration SHA and **actual** PHP8.4/8.5, Composer audit0, focused + full PHPUnit, true PG18, physical two-Garage 7/7 with post-read races, independent Foundation/Frontend Vitest+TS/build, Security/UX and actual PG18/Garage/Chromium workflows. Historical source green != this PR green.
- Full Multi-S3 #346 remains OPEN. BYO HTTPS TLS/SNI/peer pin and secret vault; replicated/certified ciphertext provider trust; live primary failure fallback; last verified copy preservation under real GC/Panic/TTL; cross-account/device E2EE/Local-First; independently hosted two providers; physical iOS/Android all NOT TESTED or BLOCKED. Stage1/2/3 codes are separate unmerged PRs — no cross-package E2E acceptance.
- No merge, main change, deployment, real user ciphertext/cloud keys, background deletion or automatic failover.

**Coordination:** [#302 pivot](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6875178317), [#346 Stage4 claim](https://github.com/1troitsky/photobunker-v3/issues/346#issuecomment-6875183592).
