# PB3 P2 #206 independent patched-main AV integration acceptance · 2026-11-14

**Owner:** CHAT-L, independent QA lane · [integration CLAIM #289](https://github.com/1troitsky/photobunker-v3/issues/289#issuecomment-6871978582) · [Issue #206](https://github.com/1troitsky/photobunker-v3/issues/206) owned by CHAT-D. **QA-only Draft; NO merge to main or deployment**.

## What this branch is

This is a byte-for-byte integration test of **the exact 21 source files** changed by original [Draft #306](https://github.com/1troitsky/photobunker-v3/pull/306), HEAD `44c1aac0332a8db04b5cd6fdb1698440d88cbce1` (based on pre-security `main@6565a0fe852882ea5fc26e493df81affed687eee`). Source branch and issue are held by CHAT-D, not this QA owner. Its production code and existing tests are copied as Git blobs **without modification or cherry-picking unrelated history**.

QA base is **current patched and post-merge CI-verified main** `5aaba8b0509c354f8abb00806180f4ce6cb6ad18` after [security-only PR #326](https://github.com/1troitsky/photobunker-v3/pull/326). Its `apps/api/composer.lock` is already Laravel **v13.42.0**, blob `c4bcae0458bd390b797186c3e2ccf536469588ef`. The QA branch never changes the lock or Composer constraints; the dependency is the **actual main version**.

This QA reports whether existing native camera recording, encrypted media journal/Web Locks, cloud Garage readback and WAV derivative UI/tests continue to work under the patched Laravel runtime. It does **not** deliver production feature acceptance or claim new implementation.

## Original failure and source evidence

- Original #306 final HEAD `44c1aac0332a8db04b5cd6fdb1698440d88cbce1`: [Foundation run 43529153531](https://github.com/1troitsky/photobunker-v3/actions/runs/43529153531) failed in PHP8.4 and PHP8.5 at `Composer consistency and all PHP syntax`, **before PHPUnit**. Job logs were inspected: `laravel/framework v13.39.0` and Composer advisory `CVE-2026-128083` / `GHSA-63hm-g96r-2m2q`. Frontend job passed.
- The same #306 HEAD: real [PG18/Garage/Chromium 43529151937](https://github.com/1troitsky/photobunker-v3/actions/runs/43529151937) PASS, [security 43529152112](https://github.com/1troitsky/photobunker-v3/actions/runs/43529152112) PASS, [UX 43529151960](https://github.com/1troitsky/photobunker-v3/actions/runs/43529151960) PASS. **Do not call original 4/4 PASS.**
- Original #206 E2E tests use native Chromium MediaRecorder, on-device encrypted scratch, signed owner E2EE upload/read, real PG18/Garage, independent Recovery Key browser context B, WAV trim/save as separate ciphertext, foreign-account denial, and interrupted journal privacy. These are code tests with Chromium device emulation, not actual iOS/Android.
- Original #205 video 300-second separate Draft #295 also modifies `CaptureView.vue`. **This QA only mirrors #306**, not #295, and does not resolve conflicts between them. #209 mixed-media assignments still backlog and cannot be claimed complete from #306.

## Exact integration and gate

- Compare source PR #306 against old source base, 21 changed paths. Re-fetch each source blob SHA and include it unchanged on patched main. Add only **this new report path** as a 22nd file.
- Verify branch diff against patched main is exactly 22 anticipated paths; no `composer.lock`, `TS_PROGRESS_TABLE.md`, `apps/api/routes`, or other authors' changed files.
- Run exact-head CI: Composer audit/validate and full PHPUnit PHP8.4+8.5; TS/build/full Vitest; genuine PostgreSQL18/Garage/Chromium; security and UX. No skipped or weakened negative tests.
- Status on initial QA branch creation: **NEW HEAD exact CI PENDING**, not PASS. Record final concrete HEAD and links in issue comment/PR after conclusion, not invent performance or result.
- No production devices, real OS microphone revocation, continuous 50-minute audio on real hardware, OS storage eviction, true device-to-device remote wipe/Panic, cross-account assignment contribute→owner ACK or final release acceptance have been tested through this scoped QA. #206 remains partial/in-progress and owned by CHAT-D.
