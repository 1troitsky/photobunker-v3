# PB3 P2 pre-main combined integration — AV, mixed Assignments, E2EE negative QA
2026-11-14 · integration owner CHAT-L · **MERGE NOT AUTHORIZED**

## Baseline and immutable inputs
Accepted security-patched main `5aaba8b0509c354f8abb00806180f4ce6cb6ad18`. This report and its branch are **review-only**.

- [Draft PR #330](https://github.com/1troitsky/photobunker-v3/pull/330) @ `27778dd53c8b469337ba5176e1b51886b6f45e32`: combined #205 video 2.4Mbps/96kbps *advisory* options with original #206 E2EE AV capture and local encrypted writer (photo and audio/video); original #295 and CHAT-D #306 untouched. Exactly 23 changed paths against secure main, **4/4 CI PASS**, 89/89 real PG18/Garage/Chromium E2E.
- [Draft PR #333](https://github.com/1troitsky/photobunker-v3/pull/333) @ `452631f888b246bccc9734f21fe476ca87d47252`: two-step signed owner mixed-media creation, public pending intent independently account-signed and tied to ROOT hash, true server root ACK then v6 signed revision ACK, full offline+IndexedDB tamper negative E2E. Exactly 6 changed paths, **4/4 CI PASS**, 85/85 real PG18/Garage/Chromium E2E.
- [Draft PR #325](https://github.com/1troitsky/photobunker-v3/pull/325) @ `befb8ea4443c629bba9b9bb1443fd510e1b8f920`: two deterministic Identity/Folder-Sync negative crypto tests, three QA audits (5 paths); **4/4 CI PASS**, original test/file blobs retained.
- **Zero shared changed paths** across the three inputs, verified through complete GitHub PR per-file inventories. Integration uses base tree of #330 and copies the exact original Git blob hashes from #333 and #325; no edits/reimplementations to any source file. All three source commits are recorded as parents of one integration commit, preserving reviewable ancestry; do not separately merge each old branch on top of this candidate.

## Consolidated scope
Expected one main-relative candidate diff = **34 distinct source/test/QA paths** plus this **one** integration report. #330 product AV, #333 mixed-owner policy, #325 negative tamper tests may coexist and run real CI together. None of the source branches or original owners' issues are edited; new Draft PR targeting secure main only. No GitHub release/deploy/production access.

**No final integration pass until exact head jobs finish.** Mandatory full PHP 8.4/8.5 Composer audit, PHPUnit, Vitest, TS/build, Security, UX and actual PostgreSQL18/Garage/Chromium real E2E. Expected newly discovered independent tests include #206 long-A/V/camera/WAV and #209 signed offline mixed create; tests must not be skipped/mock-succeeded or modified to green the run. Preserve any failure logs and rerun on a new exact SHA only after justified fixes.

## Known merge/release boundaries
- [Issue #200 / Draft PR #272](https://github.com/1troitsky/photobunker-v3/pull/272) reliable 65MiB resumable E2EE uploads: **NOT integrated here**. Its base is old `1e06b553...`, and its changes overlap this candidate's `apps/web/src/features/media/application/media-outbox.ts`; copying either full file would risk losing #206 recording support or #200 lost-ACK retry semantics. Requires separate explicit conflict-resolution implementation/CI and exact source ownership before any main merge.
- [Issue #215 / Draft PR #331](https://github.com/1troitsky/photobunker-v3/pull/331) bounded video clip exporter is separately owned and **NOT integrated**, no native encoder acceptance claim.
- [Issue #209](https://github.com/1troitsky/photobunker-v3/issues/209) remains partial: current signed immutable v1 root photo-only, then permitted audio/video by signed v6; full type-only ROOT, team/curator review and physically-real A→B mobile flow not accepted.
- Chrome/Playwright fake camera/mic exercise real browser crypto/route/upload and server but NOT physical sustained 300s video, 3000s audio, real Safari/iPhone PWA, Android device storage eviction, actual OS mic/GPS revocation; mark **NOT TESTED** until post-merge local-device workflow.
- Partial unrelated modules across P2/P3/P4 cannot be declared launch ready by this integration. **Release readiness ≠ CI green.**

## Exit
No change to main without owner's separate explicit instruction, even after green CI. If 4/4 succeeds and file lineage matches, candidate becomes **technically merge-reviewable for its bounded scope**, not full PB3 production acceptance. Confirm current main HEAD and foreign agents' active claims before seeking any later authorization.
