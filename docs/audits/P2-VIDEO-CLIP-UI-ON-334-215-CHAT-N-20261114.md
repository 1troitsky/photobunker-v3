# PB3 #215 — Video Editor user-facing real clip export on accepted AV integration #334

Date: 2026-11-14 (Asia/Tbilisi)
Owner: CHAT-N
Issue: https://github.com/1troitsky/photobunker-v3/issues/215
Baseline parent: [Draft PR #334](https://github.com/1troitsky/photobunker-v3/pull/334), immutable integration HEAD c2b8b55d38f99c31b746d313b10c136c7aea2597
Baseline accepted main: security-patched 5aaba8b0509c354f8abb00806180f4ce6cb6ad18
Own independent real clip engine: [Draft PR #331](https://github.com/1troitsky/photobunker-v3/pull/331), verified exact HEAD d8155a471eb8f0acf34883c558d673493bbfdc7b, 5/5 CI PASS and native 85/85 Chromium PASS.

## Source ownership / no main mutation

CHAT-L concluded its integrated AV/Assignments/E2EE candidate #334 and posted [END #6873212487](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6873212487) with full 4/4 workflows and 91/91 real-browser PASS; source branches #325/#330/#333 and main are frozen and unmodified. Own #215 [new START #6873350182](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6873350182), [exclusive child-branch CLAIM #6873353646](https://github.com/1troitsky/photobunker-v3/issues/215#issuecomment-6873353646), both journal/issue read again post-CLAIM to exclude concurrent FileViewer writers.

Our NEW child branch integration/p2-215-video-export-on-334-chat-n-20261114 is created from the exact accepted #334 HEAD. This is a stacked, **Draft** PR targeted at #334's integration branch, NOT main. A later main merge would require separate owner authorization, first for #334 and then a revalidated #215 overlay. This stage never modifies or closes other PRs.

## Product integration in this child only

- Port unchanged verified own #331 source video-clip-export.ts, its negative tests, SHA256-verified 3-second 32x32 VP8 fixture, native browser E2E and own dedicated workflow. Own workflow target broadened to integration/** for this child PR.
- Overlay ONE user-visible existing file solely in this new child: apps/web/src/views/FileViewerView.vue. After a verified authenticated decrypted Blob URL video is open, user can choose Start/End in existing editor and explicitly click **Сохранить новый E2EE-клип в Browser**. The source remains untouched; a clone is decoded/encoded by real browser captureStream/MediaRecorder; output bytes are independently sniffed as MP4 ftyp/WebM EBML, and a new personal File is encrypted through the existing signed AES-GCM Local-First MediaFile outbox.
- Safety: re-check active account/device/keypackage, current file key/source URL, editor route, trim range before/after encoding and inside asynchronous encryption. AbortSignal/epoch cancellation on source change, logout, trim change, editor close and unmount. No inherited assignment capture/grants, category/tags/GPS, or TTL. No automatic OS gallery/download/public sharing; status explicitly distinguishes local encrypted save from server receipt. Native codec unsupported fails closed with visible error.
- New independent tests/e2e/p2-browser-video-clip-ui-215.spec.ts: real user opens personal encrypted Browser video, changes real trim range, explicitly saves offline, verifies two IndexedDB encrypted rows, original private metadata intact, new derivative personal with no metadata/ACL/GPS, actual video decodes, no OS download. Existing accepted browser tests remain enabled (no isolation or skipping).

## CI and acceptance truth

The parent #334 source has 4/4 PASS and 91/91 Chromium E2E; the independent #331 module has 5/5 PASS and 85/85 real Chromium E2E. **These separate successes are not proof that the stacked child integration works.** Record exact child HEAD and full GitHub Actions run results after real CI, including test/failure evidence. No fake PASS. No physical Safari/iPhone/Android test here.

## Remaining release and policy gates

- Codec support varies; MP4-vs-EDL product decision remains OPEN. UI offers actual browser-supported MP4/WebM only, no fake MP4.
- Real decoder frame accuracy/audio preservation and time tolerance on all OS/browser combinations not confirmed. Source trim recording policy 5–300 seconds remains in parent; actual E2EE clip selection is bounded to finite source max 300s.
- Full signed remote S3 uploaded second-device readback, encrypted ACL/grant handling, TTL and Safari/iOS/Android device acceptance require independent QA; encrypted **offline** Local-First Browser enqueue/readback alone is not a cloud sync ACK.
- Parent #334 and child overlay must not be merged without explicit owner permission; keep Draft and partial until all independently required gates pass.
