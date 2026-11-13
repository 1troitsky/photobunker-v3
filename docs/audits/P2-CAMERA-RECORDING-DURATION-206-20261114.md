# P2 #206 — Camera AV duration safety, isolated implementation

Date: 2026-11-14 (Asia/Tbilisi). Agent: CHAT-D. Scope: independent partial product implementation, not the full #206 acceptance.

## Baseline and ownership

- Base `main@6565a0fe852882ea5fc26e493df81affed687eee` (owner merge #293). No main edits or merge.
- Separate branch `feat/p2-206-camera-av-duration-20261114`.
- Source: `ts.md` §14, §25 scenarios 4–5; Issue #206. Existing `MediaFile` signed encrypted outbox, `MAX_MEDIA_BYTES=128 MiB` and Camera session/permission checks were preserved.
- Historic Draft #187 owns HTTPS import UI/E2E, not camera duration code. Neighboring CHAT-A Notifications #198, CHAT-B Public Card #211, CHAT-C Recovery Vault #219, Contacts #210, BYO S3 #232 own disjoint paths.

## Verified source finding

The pre-change `CaptureView.vue` used one `recordLimitMs=175000` for BOTH video and audio and allowed explicit Stop under five seconds. `ts.md` explicitly requires video 5–300 s and audio 5–3000 s. A wall-clock `Date.now()` read only after asynchronous finalization could misclassify a timely stop if browser callbacks or policy checks were delayed.

## Scoped change

1. Independent `recording-limits.ts`: immutable per-kind bounds; refuse non-finite, negative, under-minimum and over-maximum measured times.
2. Camera `MediaRecorder`: capture monotonic `performance.now()` immediately around start and user/limit stop; record the signed wall-clock finish AT STOP, not at delayed `onstop`; keep spontaneous interruptions non-persisting; retain 128 MiB cap and pre-enqueue GPS, ownership, assignment, ACL and E2EE checks.
3. The recording label displays the active mode's correct limit.
4. Tests in `recording-limits.test.ts` cover both exact edges and anomalies. Mounted `CaptureView.test.ts` covers under-5s refusal, exact 5s, automatic 300s video and 3000s audio stop, spontaneous stop discard, and late browser callback.

## Evidence (not an assertion of CI PASS)

- GitHub Actions test/build/security/UX workflows: **NOT TESTED at document creation**; verify exact branch HEAD and record links in PR / #206.
- Real 3000-second microphone recording: **NOT TESTED** (mounted fake timer verifies control logic only).
- Physical iOS Safari, Android Chrome, microphone-denied platform flow, codec variation, sustained 128 MiB memory pressure, real cross-device ciphertext cloud readback and WAV trim: **NOT TESTED**.
- Full #206 product journey remains **IN PROGRESS**; bitrate presets, supported waveform/codecs, resilient encrypted partial chunks during interruptions and end-to-end long-recording transfer are separate unresolved work. The existing capture keeps raw ephemeral `MediaRecorder` parts in memory until explicit, valid Stop; it does not yet provide durable encrypted partial recording segments during capture.

## Security and integration gates

No storage API / PHP route / database / S3 / assignment policy / authorization / workflow / `ts.md` / `TS_PROGRESS_TABLE.md` modification. No Service Worker claims, no merge, no deployment. Exact-head CI and physical-device acceptance are separate required gates.

## 2026-11-14 follow-up: exact-head browser regression and bitrate target

Initial exact HEAD `b60d9e511a09b7cd54921e0b2f170d87107eb7f1`: real [PostgreSQL/Garage/Chromium 43510743826](https://github.com/1troitsky/photobunker-v3/actions/runs/43510743826) **83/84 PASS, 1 FAIL**. At `tests/e2e/p1-assignment-media.spec.ts` the genuine `MediaRecorder` scenario requested stop after **1600ms** then asserted an encrypted MediaFile; this test was incompatible with the now-normative `ts.md` §14 / §25.5 minimum **5000ms**. The product denied under-5s save. Updated **only this recording fixture** to wait 5500ms of real Chromium microphone data; preserved real signed requirements, GPS, MediaFile enqueue, ciphertext inspection and owner-receipt assertions. No `skip`, fake clock, bypass or security-test weakening.

Additional product contract: `recording-options.ts` adds native `MediaRecorderOptions.audioBitsPerSecond` selected from **64/128/192/256 kbit/s** for `audio` only. Invalid targets throw before opening recorder; `video` options remain unchanged. UI clearly calls it **target bitrate** and says actual encoded codec/bitrate depends on browser. Pre-start selection is included in new recorder options; selector is disabled while recording. `recording-options.test.ts` checks the four targets, invalid values and video isolation; mounted camera suite checks the real options passed to the fake native constructor and timing/security gates.

**Still NOT TESTED:** hardware codec/bitrate, real sustained 50min audio, iOS Safari and Android Chrome, partial encrypted durable chunks during capture, real E2EE cross-device round-trip and separate WAV editor. The 128MiB cap is not relaxed. Browser MediaRecorder still accumulates ephemeral plaintext chunks in memory pending Stop; do not classify #206 as feature-complete.
