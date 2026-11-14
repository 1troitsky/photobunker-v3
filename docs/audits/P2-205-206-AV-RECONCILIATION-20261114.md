# PB3 P2 video/audio #205 + #206 integration reconciliation · 2026-11-14

**Integration owner CHAT-L; no product Issue ownership transfer.** [Exclusive CLAIM #289](https://github.com/1troitsky/photobunker-v3/issues/289#issuecomment-6872200157). Separate [source #205 video PR #295](https://github.com/1troitsky/photobunker-v3/pull/295) and [source #206 audio/AV PR #306](https://github.com/1troitsky/photobunker-v3/pull/306) remain unchanged, Draft and partially accepted. No main merge or deployment approved.

## Inputs and collision

- Accepted security-patched Laravel main: `5aaba8b0509c354f8abb00806180f4ce6cb6ad18` (post-merge 3/3 PASS).
- Primary AV integration parent: CHAT-L independent [QA Draft #327](https://github.com/1troitsky/photobunker-v3/pull/327), exact parent head `9b770407c64fb157100f84963a44dd7e7594ce27`, with #206 code from source HEAD `44c1aac0332a8db04b5cd6fdb1698440d88cbce1` and one QA-only cold-session test precondition to diagnose previously observed 88/89 E2E FAIL (real Garage/Chromium).
- #205 source HEAD `35978914689b7c9b863a7e22719dee46ecca90f3`: `CaptureView.vue` changes overlap #206. #205 introduced an opt-in video 300s duration cap and advisory MediaRecorder video target **2,400,000 bits/s** and video-audio target **96,000 bits/s**, while leaving standalone audio capped at **175s**. Its video target over 300s is `93,600,000` bytes, under the independent `MAX_MEDIA_BYTES=128MiB` bound.
- #206 already provides TRUE bounded video **300s** and audio **3000s** via `recording-limits.ts`, signed started/ended budget, encrypted journal, Web Locks, durable E2EE outbox, cloud WAV derivative and all associated negative tests, but its video `recordingOptions()` omits the #205 target bitrates.

## Selected safe reconciliation and exact OWN modified files

**Never replace #206 CaptureView with old #205 CaptureView.** Reuse existing #206 `recordingOptions` call, adding only conservative video bitrate hints; preserve unchanged all actual UA/ciphertext/ACL/TTL/policy/size/lease controls.

1. `apps/web/src/features/media/domain/recording-options.ts`: add `VIDEO_TARGET_BITRATE_BPS=2_400_000`, `VIDEO_AUDIO_TARGET_BITRATE_BPS=96_000`, include hints only for `kind==='video'`; audio remains independently chosen 64/128/192/256 kbps and video must not inherit this selector.
2. `apps/web/src/features/media/domain/recording-options.test.ts`: assert exact Video options, audio setting segregation, targeted 300s video `93,600,000` bytes and **below** real 128MiB hard limit; fresh options on each invocation.
3. `apps/web/src/views/CaptureView.test.ts`: tighten existing Video MediaRecorder constructor options assertion; original duration, native cipher, revoke and interruption tests remain unmodified.
4. `docs/audits/P2-205-206-AV-RECONCILIATION-20261114.md`: this independent provenance report.

Original product code remains anchored in #206 parent; no `CaptureView.vue` modification in this reconciliation increment. No import/copy of #205 `capture-recording-policy.ts` or obsolete 175s audio cap. No change to Composer or source PRs, no E2EE plaintext server, gallery export or lower negative-test bars.

**Security interpretation:** bitrate options are **advisory** because a user agent may ignore them. This calculation is an estimate, not proof of actual output bytes. Original `MAX_MEDIA_BYTES` hard failure, 8MiB individual chunk limit and 16MiB pending plaintext buffer bound remain in #206. Actual 300s iOS/Android + codec variation, 50min native audio, thermal, storage pressure, permissions and Safari PWA remain NOT TESTED. Mixed-media Assignments #209 stays backlog pending full downstream acceptance.

## Verification gates

This report records intended implementation, not a completed product claim. New **stacked integration exact-head** must pass full PHP8.4/8.5 Composer Audit + PHPUnit, full Vitest and build, genuine PostgreSQL18/Garage/Chromium E2E, Security and UX. Parent QA #327 must independently PASS before any eventual acceptance; earlier original-source mirror 88/89 E2E failure is preserved (see QA report in #327). All extra CI runs must bind exact final SHA, and any FAIL must remain visible with trace, no skipping/fake server ACK.

This branch and Draft PR are integration-only; main, #205, #206 and their source branches remain unchanged. No merge or deploy without explicit owner approval.

## Target-base gate update (2026-11-14)

This Draft PR was initially opened with target `qa/p2-206-av-patched-main-20261114-chat-l` to review its **four incremental paths** relative to independently scoped AV QA #327. For release-gate CI, the PR target has now been changed to **the actual accepted patched main** `5aaba8b0509c354f8abb00806180f4ce6cb6ad18`, without merging, cherry-picking or rewriting any code history. Its full compare contains the original 21 #306 source paths, one QA-only cold editor reauthentication precondition in `p1-assignment-media.spec.ts` (strict acceptance unchanged), the independent QA report and this selected #205 codec-hint integration. The original precondition-free mirror and its **88/89 E2E FAIL** are immutable at `33d2bc2f9af3848bb41f97bfe0863c23c51f8dee`.

The first stacked-target workflow Security 43560406065 PASS and UX 43560406046 PASS **do not substitute for full main-target Foundation or real PG18/Garage/Chromium**. Updating this own report causes a new exact-head `pull_request synchronize` CI event against `main`; all main-target checks must finish PASS independently. If any failure occurs, preserve original failing step/trace, do not claim readiness or skip tests. No main merge/deployment authorized.
