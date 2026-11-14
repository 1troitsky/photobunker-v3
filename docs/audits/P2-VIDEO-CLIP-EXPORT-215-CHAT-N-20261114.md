# PB3 #215 — independent browser video clip export engine / CHAT-N

Date: 2026-11-14 (Asia/Tbilisi)
Owner: CHAT-N · Issue: https://github.com/1troitsky/photobunker-v3/issues/215
Base: secure main 5aaba8b0509c354f8abb00806180f4ce6cb6ad18
Status: PARTIAL / not mounted / not merge-ready, no changes to current main.

## Source/dependency preflight

- AGENTS.md; ts.md §13.3 says real MP4 output vs non-destructive EDL is OPEN, and forbids representing local trim preview state as an encoded file.
- Existing FileViewerView.vue / accepted Draft #145 contains trim-preview ranges, not actual clip bytes.
- P1 #200 MediaFile signed resumable ciphertext workflow has verified Draft #272 @ 189ee19e4c81fb0f41339e252a58c51c187340c0 but is unmerged.
- P2 #205/#206 integrated QA Draft #330 @ 27778dd53c8b469337ba5176e1b51886b6f45e32 belongs to CHAT-L; changes FileViewerView.vue, CaptureView.vue, media outbox, assignment policy and E2E. NO changes are made to any of those files.
- CHAT-L #209 Assignments own UI work is separate; #218 Backup depends on storage accounting and plan entitlement.

## Narrow true encoder

New paths only:
- apps/web/src/features/browser/application/video-clip-export.ts
- apps/web/src/features/browser/application/video-clip-export.test.ts
- .github/workflows/p2-video-clip-215.yml
- docs/audits/P2-VIDEO-CLIP-EXPORT-215-CHAT-N-20261114.md

exportRealVideoClip receives an authenticated locally decrypted blob: video source, bounded clip selection and an assertAuthorized callback. It clones the video in memory to preserve editor playback, seeks to the start, invokes native captureStream + MediaRecorder and genuinely encodes while playing until the selected end. It never reuses original source bytes nor presents an EDL as an MP4. It validates the returned container using WebM EBML magic or MP4 ftyp magic and sets truthful MIME/extension. If a browser lacks a supported captureStream/encoder or denies playback, fail closed rather than fabricate output. No OS gallery writes, downloads or unencrypted persistent cache.

Safety: 300-second source/selection max, 128 MiB emitted media cap, finite load/seek/recording timers, AbortSignal and account/session guard, track teardown, source detach and stop in finally. This module only returns an in-memory File/Blob. Future authorized integration must use the existing signed encrypted MediaFile outbox.

## CI/evidence

The dedicated workflow runs focused Vitest, strict TypeScript and production build on exact source head. Standard Foundation/Security/Garage/Chromium CI tracked separately. Test-only fake recorder can verify gates, MIME, size, negative result and abort; it does NOT demonstrate real native MP4/WebM playback, frame-exact timing, audio capture or real hardware compatibility.

## Outstanding product gates

NOT TESTED / BLOCKED: real source playback and encoding in Chromium/Firefox/native Safari/iOS/Android; frame/audio synchronization, actual codec bytes decodable and timing tolerance; signed E2EE MediaFile enqueue/sync/reload and verified remote readback; interrupted export; TTL/ACL and private metadata; integration into foreign FileViewerView code; explicit MP4-vs-EDL product decision. No supported-browser or final acceptance claims are made.

Issue #215 stays PARTIAL / NOT MERGE READY.


## Stage 2 — native Chromium media → Local-First E2EE regression

Own exclusive new paths:
- tests/e2e/fixtures/p2-video-clip-215-vp8.base64 — 656 bytes of FFmpeg-generated VP8 WebM, 3-second red 32x32 synthetic video, SHA-256 6e7cfe019443bb5b108d75119704b3009d91a3b54082e86864634e13e3a9131b, checked in CI and native Chromium. No personal data.
- tests/e2e/p2-browser-video-clip-215.spec.ts — native Chromium media decode + production video clip export; verify that the produced clip decodes as real video, container MIME/extension is truthful and the original video remains unchanged; with browser offline, enqueue a new E2EE MediaFile, read/decrypt local result, ensure signed contract excludes private name and no OS download occurred
- No source UI, media-outbox, CaptureView, FileViewerView, router, lockfile or foreign agent files changed; this E2E is included by the existing p2-browser-* Playwright matcher.

CI chronology:
- Initial unit run #43562976698 failed 4/8: one expected safe filename used wrong underscore count; jsdom legacy Blob lacked arrayBuffer, not a native production bug. Fixed with bounded FileReader fallback; corrected filename test.
- Next run #43563054570: 8/8 Vitest passed but strict TS failed due one parameter-property with erasableSyntaxOnly, tuple spread and unused constant; all three corrected in own files.
- Source-only head e24b4afbe1a6fe77065d1506b640ee88d3ca18ba: dedicated #43563112350 8/8 Vitest, TypeScript/build PASS; Foundation #43563112298 PASS; Security #43563112310 PASS; UX #43563112267 PASS; real Garage+Chromium #43563112282 was still running.
- After adding native Chromium E2E, pre-audit head c7f73c933e969399c9ea4f04b3f15ce6a2700d33: dedicated #43563530562 PASS; Foundation #43563530558 PASS; Security #43563530583 PASS; UX #43563530566 PASS; real PG18/Garage/Chromium #43563530581 IN PROGRESS during last inspection. Do NOT count that run or the browser native test PASS until the exact job concludes.

The new browser test is the first attempt at proving actual native encoder and encrypted outbox integration; all failure evidence must be preserved. It does NOT replace physical Safari/iOS/Android, audio retention, measured frame-accurate bounds, persistent signed cloud MediaFile readback, production authorization / ACL / TTL, or actual user-facing editor UX acceptance. Until those gates pass, #215 remains PARTIAL/NOT MERGE READY.


## Stage 3 — exact failure triage and deterministic codec fixture

- Prior exact HEAD fbaad5fceece11cf6a6b66389e2c60e8e6e3b06c, real PostgreSQL18/Garage/Chromium [43563751743](https://github.com/1troitsky/photobunker-v3/actions/runs/43563751743): FAIL 84/85; only newly added video-clip E2E rejected static MP4 (fixture_not_decodable) BEFORE calling production exporter. Trace artifact ID 14101083756. Existing 84 browser tests PASS.
- Next exact HEAD 05633c3aec2b57b50fe0758cbed8713b7d49b3f2, [43564812663](https://github.com/1troitsky/photobunker-v3/actions/runs/43564812663): FAIL 84/85; only same new E2E at fixture_bad_duration_or_pixels with dynamically recorded WebM. MediaRecorder WebM cannot be assumed to expose a finite duration in native headless playback. No exporter success claimed and no tests skipped.
- Test fixture replaced with independently valid VP8 WebM generated by local FFmpeg libvpx (color=red, 32x32, 1fps, 3 seconds), validated by ffprobe duration 3.000 and local Chromium playback with proper dimensions and duration. Fixture 656 bytes, SHA-256 above; old invalid MP4 file and runtime generated variable-duration WebM code removed.
- Own dedicated workflow now verifies the exact SHA-256 of decoded base64 bytes BEFORE running any media tests. The new native Chromium E2E independently rechecks hash, decodes source, runs actual re-encode and encrypted Local-First outbox readback. This is not a MIME relabel or fake MP4, and it exercises real WebM decoding/encoding.
- Corrected exact-head full PG18/Garage/browser acceptance remains NOT TESTED until its new workflow completes. Scope is still PARTIAL. Keep first two FAIL results visible in CI, no skip, retry or edited preexisting test.

Remaining product gates: integration into foreign FileViewerView.vue, signed cloud E2EE readback, native Safari/Android, browser-level frame/audio timing and MP4-vs-EDL product policy, physical device acceptance. No main, merge or deploy changes.
