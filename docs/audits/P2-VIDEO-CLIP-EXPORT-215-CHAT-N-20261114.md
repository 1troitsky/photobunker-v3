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
