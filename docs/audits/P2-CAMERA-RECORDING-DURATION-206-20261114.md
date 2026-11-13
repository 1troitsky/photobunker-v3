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

## 2026-11-14 — Native microphone permissions and hardware-ended gate

Further full PostgreSQL18/Garage real Chromium CI runs after the initial 1.6s audio fix exposed a **second** old fixture in the SAME `tests/e2e/p1-assignment-media.spec.ts`: real camera+microphone **video** was stopped after 1800ms, now rejected by the mandatory five-second gate at line 583. Runs [43513013538](https://github.com/1troitsky/photobunker-v3/actions/runs/43513013538), [43513382776](https://github.com/1troitsky/photobunker-v3/actions/runs/43513382776), [43513508084](https://github.com/1troitsky/photobunker-v3/actions/runs/43513508084) each reached the real browser journey and failed at the video encrypted-save expectation (**83/84 Chromium**, not PASS). Corrected the 1800ms VIDEO wait to genuine 5500ms; NO skip/xfail/fake browser clock/under-five-second save. Both audio and video E2E now use actual capture for >=5s and keep original policy/GPS/media/grant assertions.

New fail-closed capture lifecycle in the own Camera view:
- Reject any `getUserMedia` stream whose tracks are already ended before publication/recorder creation.
- Attach `MediaStreamTrack.ended` listeners while recording. Unexpected microphone/camera hardware/permission interruption aborts immediately, clears event handlers, releases still-active tracks, and **does not** call `enqueueEncryptedMedia`.
- On native `MediaRecorder.onstop`, recheck hardware track liveness **before accepting** user Stop or timer authorization. Stale or interrupted recordings are discarded even if browser callbacks arrive out-of-order.
- Detach listeners on explicit Stop, user Cancel, identity/mode changes and component disposal. Browser `MediaStreamTrack.stop()` itself does not synthesize an `ended` event.
- Normalize native NotAllowed/PermissionDenied/Security errors into `camera.microphone_permission_denied`; missing microphone into `camera.microphone_unavailable`; no platform-specific private error strings displayed. The audio activation button says “Включить микрофон” instead of “Включить камеру”.

Mounted `CaptureView.test.ts` regressions check >=5s interruption, pending accepted stop followed by hardware termination, denial, already-ended permission result, listener cleanup, and correct button copy. The prior monotonic-clock bounds, 128MiB limit, signed assignment/GPS/E2EE requirements and native target bitrate tests are retained.

**Scope distinction:** unexpected-ended recording discards transient in-memory plaintext data, not partial recovery. Truly **durable and encrypted during capture**, restart-surviving audio/video segments are **NOT IMPLEMENTED** here; this needs a separate reviewed chunk/format/nonce/cipher integrity contract and product acceptance. No claim of browser bitrate fidelity, physical Safari/Android, full 50-minute recording or 2-device live S3 roundtrip. Main/other branches unchanged. Exact final HEAD tests and CI are tracked in own PR #306 and issue #206.

## Real E2E acceptance checkpoint and new negative browser suite

**Confirmed historical real-browser baseline at code HEAD `e17d11d19140605282d78602ae5300f98e372610`:** [PG18/Garage/Chromium run 43514645036](https://github.com/1troitsky/photobunker-v3/actions/runs/43514645036) **SUCCESS / 84 of 84 real Chromium E2E PASS** (4.8 min), genuine two-device signed MediaFile/assignment path, audio and video now each record >=5s before upload; 5 PostgreSQL quota races and actual Garage retry/restart/sha256 readback PASS. This confirms the old audio 1600ms and video 1800ms fixtures were the two observed expectation failures, not a reason to weaken recording minimum.

**Additional code-level checks at HEAD `822133595e28d78168955ba2eb0832954e49c94a`**: [Foundation frontend 43514519481](https://github.com/1troitsky/photobunker-v3/actions/runs/43514519481) TypeScript, build, **85 test files / 485/485 Vitest PASS** with negative hardware-ended, permission denied and delayed callbacks. Shared PHP Composer audit remains blocked on inherited CVE #297.

**New non-mocked Chromium cases at code HEAD `387494bc9e805ec90c4d13ec7f7434e188ad4a47`**: own `tests/e2e/p2-camera-microphone-interruption-206.spec.ts` uses genuine Chromium `getUserMedia`/native `MediaRecorder`; one test injects NotAllowedError and requires explicit retry, no plaintext browser error or local media, the other dispatches a synthetic `ended` event on a **real live audio track after >5 seconds** to verify immediate hardware stop and zero enqueues. Dispatching `ended` simulates browser event delivery; **it does not replace physical iOS/Android permission withdrawal testing**. [Security](https://github.com/1troitsky/photobunker-v3/actions/runs/43515238727), [UX](https://github.com/1troitsky/photobunker-v3/actions/runs/43515238640), [frontend](https://github.com/1troitsky/photobunker-v3/actions/runs/43515238679) and [real PG/Chromium](https://github.com/1troitsky/photobunker-v3/actions/runs/43515238833) track this code SHA. **Do not claim new tests PASS until that exact run finishes.**

## 2026-11-14 — signed AV capture ceilings, discovered Playwright gate, and encrypted scratch journal

**Sourced normative requirement:** `ts.md` §14 Camera 1.2 / §25(4–5): video **5–300s**, audio **5–3000s**, capture fragments encrypted before durable storage where platform permits; iOS/native codecs require device acceptance.

### Signed capture discrepancy FIXED IN DRAFT, NOT MERGED

Previously Camera 5–300/3000s was bounded but `apps/web/src/features/media/application/media-outbox.ts` and `apps/api/app/Assignments/AssignmentContract.php::mediaCapture` both rejected **ANY** signed assignment recording >180s, making accepted long audio/video unable to complete an assignment. Corrected both to conservative **photo<=180s (unchanged), video<=300s, audio<=3000s**. This does **not** change ACL/owner proof, account signature, cloud encryption, S3 upload/retry, assignment time windows or trusted policy. Client Camera minimum is still 5s; server signed timestamp is a **self-declaration**, not an attested measurement of microphone samples. Direct new tests `apps/web/src/features/media/application/media-capture-window.test.ts` perform genuine offline AKEK/AES-GCM signed MediaFile creation at exact boundaries and no-row rejection above; PHP `apps/api/tests/Feature/AssignmentCaptureWindow206Test.php` covers server exact boundaries, over-limit 422 and foreign/future denial.

Overlap check: historical #200 / Draft PR #272 touches `media-outbox.ts` only at `flushPass` near line 267+, while this fix touches only signed preflight near line 105. **Do not cherry-pick/merge #272 or touch its upload/retry code.** #297 security/PR #298 owns the Composer patch, NOT modified here.

### Discovered E2E exclusion and corrected real Chromium evidence

`tests/playwright.config.ts` only discovers `p1-*.spec.ts`, `p2-browser-*.spec.ts`, `p2-settings-*.spec.ts`. Original newly created `p2-camera-microphone-interruption-206.spec.ts` was **never executed** by earlier reported 84/84 Chromium runs; removed and moved unchanged to correctly discovered `tests/e2e/p2-browser-camera-microphone-interruption-206.spec.ts` without modifying Playwright config. At exact code SHA `6e896488f18f42c366835ffdf664615002329119`, [real PG18/Garage/Chromium 43516862090](https://github.com/1troitsky/photobunker-v3/actions/runs/43516862090) finished **SUCCESS, 86/86 genuine Chromium tests**, including two new microphone denial/interruption tests. Earlier 84/84 [43515238833](https://github.com/1troitsky/photobunker-v3/actions/runs/43515238833) was PASS but **did not include** those two cases. Exact code SHA `6e896488` [Frontend Foundation 43516862144](https://github.com/1troitsky/photobunker-v3/actions/runs/43516862144) **86 files / 493/493 Vitest, TS & build PASS**; security/UX PASS. No virtual clock substitute in real browser cases; synthetic `ended` event only, not actual OS revocation.

### Private in-flight journal foundation, NOT connected to Camera yet

New **isolated** `apps/web/src/features/media/application/recording-encrypted-journal.ts` + `.test.ts`:
- `createEncryptedRecordingDraft`: new random AES-256-GCM DEK wrapped with account AKEK; draft metadata contains only opaque recording ID, kind/MIME, timestamps and byte/index counters; no private GPS, filename, tags, plaintext, or server/API call.
- `appendEncryptedRecordingSegment`: each native chunk first encrypted with fresh 96-bit IV, authenticated AAD binding account, recording ID, format, policy-independent expiry, key revision, exact chunk index and plaintext size; **only** AES-GCM ciphertext Blob persisted in Dexie, atomic append/count and byte bound. Max 8MiB per input segment, <=128MiB total (same MediaFile cap), reject gaps, duplicates and races.
- `interruptEncryptedRecordingDraft`: does NOT finalize or publish; ciphertext-only partial state persists for future explicit recovery implementation.
- `sealEncryptedRecordingDraft` / `readCompletedEncryptedRecording`: only explicit completion at duration 5–300/3000s can reconstruct plaintext in memory under current correct key, after validating tag, index, size and account identity; never emits interrupted content as a signed MediaFile. Temporary buffers wiped after Blob creation.
- `purgeExpiredEncryptedRecordingDrafts`: explicit, bounded current-account-only cleanup (up to 25 per call), not automatic yet; 24h encrypted scratch expiry. No server-cloud deletion. No storage API or E2EE grants changed.
- Tests with actual fake-indexeddb + WebCrypto check encrypted-at-rest, exact decrypted bytes after seal, missing/duplicate/concurrent chunks, tamper, key changes, different accounts, unsupported codec, no unauthorized salvage and bounded expired-data cleanup. **This module is not yet wired to live MediaRecorder; do not claim capture survives crash/interruption or appears in Browser.** It supplies reviewed primitives for a subsequent user-approved browser flow.

Evidence checkpoints:
- [Frontend 43517862103](https://github.com/1troitsky/photobunker-v3/actions/runs/43517862103) at prior journal code SHA `ce3f7745`: TypeScript/build, **87 files / 501/501 Vitest PASS** (journal 8/8), Security and UX PASS. PHP Foundation blocked before PHPUnit due inherited Composer lock CVE-2026-128083 / #297; no audit bypass.
- New bounded-GC code/test SHA `d6829ea7d2da5a23482d52d767c5ab660ac6fdae`: [Foundation 43518195662](https://github.com/1troitsky/photobunker-v3/actions/runs/43518195662), [Security 43518195663](https://github.com/1troitsky/photobunker-v3/actions/runs/43518195663), [UX 43518195670](https://github.com/1troitsky/photobunker-v3/actions/runs/43518195670), [PG18/Garage/Chromium 43518195674](https://github.com/1troitsky/photobunker-v3/actions/runs/43518195674). **Check final outcomes before claiming PASS.** PHP direct new boundary Feature tests remain NOT RUN until secure Laravel Composer baseline is available.
- **NOT TESTED / BLOCKED:** live 50min iOS/Android recorder, actual revoked OS mic permission, codec bitrate fidelity, wired progressive encrypted segment persistence + recover-on-reload, WAV derivative after a live cloud audio recording across two devices, patched Laravel integrated CI. #206 partial only; no merge/main/deploy.

## 2026-11-14 — actual MediaRecorder → AES-GCM scratch journal integration

Issue #206 / CHAT-D / Draft PR #306, on independently owned paths only. This section **supersedes the older statements above saying the scratch journal was not connected to Camera**. It is now connected in Draft code; production acceptance remains incomplete.

### Implementation and security properties

`apps/web/src/views/CaptureView.vue` creates a fresh AKEK-wrapped media recording draft **before calling native `MediaRecorder.start`**. Every nonempty `dataavailable` Blob is serialized by a per-recording Promise chain into `appendEncryptedRecordingSegment`, which AES-256-GCM encrypts on-device using fresh random IV and authenticated account, recording ID, codec/format, key revision, index, size, expiry; the IndexedDB transaction contains ONLY ciphertext. Individual native data events are capped at 8 MiB, aggregate lifetime bytes at 128 MiB, pending plaintext event queue at 16 MiB; failure stops the native stream and refuses a signed/queued MediaFile. This bounds the plaintext waiting in JS memory; **it does not remove volatile native encoder buffers**.

On native track `ended`, permission revoke, canceled route/account, MediaRecorder native error, timer/size or storage failure: original stream closes, `activeRecording` token invalidated, successful queued ciphertext commits are drained, and the private draft is marked `interrupted` where the same account/key remains accessible. No automatic signed capture, MediaFile enqueue, cloud upload, preview or cross-account access. Unexpected browser crash can leave a `writing` state, but already committed encrypted bytes persist in IndexedDB and cannot be implicitly finalized.

On authorized user Stop or bounded auto-stop, the browser's final `dataavailable` is first queued and awaited. Only after exact signed assignment/removal context, local GPS permission, monotonic 5–300/3000 second validity and 128 MiB checks does the journal seal. The complete original encoder byte stream is reconstructed **temporarily in memory** and passed to the existing `enqueueEncryptedMedia` E2EE pipeline. After encrypted MediaFile has been durably queued, scratch ciphertext is explicitly deleted; a scratch deletion failure cannot invalidate the successful MediaFile. Any outbox or E2EE failure leaves separately encrypted scratch (not a published MediaFile). Server ACL, signing domain, MediaFile manifest and #200 retry/flush untouched.

### Tests and evidentiary scope

- Mounted `CaptureView.test.ts`: 5 new race/failure cases for ordered encrypted native chunks, delayed AES-GCM Dexie commit before Stop, fail-closed quota/storage failure, retain encrypted scratch on failed signed enqueue, block recording startup on encrypted journal initialization failure. Full [Foundation 43519643475](https://github.com/1troitsky/photobunker-v3/actions/runs/43519643475) on CODE SHA `f555ea452e2029e9f4232df0014b356eaac23ce1` **87 files / 507/507 Vitest PASS, TypeScript and Vite build PASS**.
- Real Chromium own `tests/e2e/p2-browser-camera-microphone-interruption-206.spec.ts` expanded to assert already-encrypted partial data before interruption, account-local ciphertext retained after actual page reload, *no implicit decode/MediaFile* after reload. New positive genuine microphone test reads raw native IndexedDB `segments` to confirm every stored part type is `application/octet-stream` and `cipherBytes = plainBytes + 16` **before Stop**, validates signed encrypted local MediaFile after Stop, scratch GC and correct local media after reload. [PG18/Garage/Chromium 43519643539](https://github.com/1troitsky/photobunker-v3/actions/runs/43519643539) at same code SHA: **IN PROGRESS** at this audit update, NOT claimed PASS. Earlier original 86/86 Chromium PASS was *prior* to this integration.
- Full Security and UX workflows at exact code HEAD must be checked and recorded separately. PHP8.4/8.5 foundation on main dependency lock STILL blocked before PHPUnit by #297 Composer CVE; no bypass and no new PHP test accepted.

**NOT VERIFIED / still needed before #206 can be called complete:** final real Chromium acceptance of this live-journal change; genuine browser crash/process death during a MediaRecorder `writing` transaction; user-visible explicit safe salvage/recovery of interrupted media; native iOS Safari and Android MediaRecorder+codec+permission; full 50-minute low-memory capture; signed two-account real cloud audio → WAV editing/readback; checked PHP contract tests after independent #297 security integration. IndexedDB write durability is subject to browser storage quota, persistence policy and eviction: successful Dexie commit does not promise impossible loss-proof storage under system eviction.

## 2026-11-14 — live recorder E2E ACCEPTANCE checkpoint and signed max-timer budget

**Verified real end-to-end acceptance:** [PG18/Garage/Chromium 43519643539](https://github.com/1troitsky/photobunker-v3/actions/runs/43519643539) at code SHA `f555ea452e2029e9f4232df0014b356eaac23ce1` finished **SUCCESS / 87 of 87 real Chromium E2E PASS**, including:
1. Signed-assignment real microphone/video E2EE capture, GPS, signed policy, cloud Garage, owner received media; earlier baseline remains covered.
2. Native real microphone after >5s: AES-GCM ciphertext-only IndexedDB parts **before Stop**, no unauthorized MediaFile, then real Stop, signed E2EE MediaFile queued, scratch ciphertext explicitly GC, same MediaFile survives page reload.
3. Native real microphone unexpected `MediaStreamTrack.ended` after already encrypted parts: **no signed MediaFile**, fragments persist encrypted and marked interrupted, survive real page reload, `readCompletedEncryptedRecording` rejects incomplete drafts.
4. Native microphone NotAllowedError denial: browser private error not displayed, explicit retry required.

The user-facing camera code is now genuinely connected to durable encrypted pieces as expected by §14; exact scope remains **Chrome CI on fake device streams**, not physically interrupted iPhone or Android.

**Signed max-timer safety fix:** capture's signed `startedAt` precedes async GPS/policy checks and journal preparation, so the old native `recordingBounds(mode).maxMs` auto timer could produce a signed `finishedAt-startedAt` exceeding 300s (video) or 3000s (audio) despite correctly bounded monotonic MediaRecorder duration. New OWN pure `signedRecordingBudget(kind,startedAt,Date.now())` reserves **250ms** plus already elapsed preflight time, requires budget >=5000ms, rejects backwards/invalid wall clocks, and uses the resulting bounded timeout for native `MediaRecorder.stop()`. This is best-effort clock-skew protection, **not hardware or trusted time attestation**. Added boundary tests in OWN `recording-limits.test.ts`.

**Latest code SHA** `885117531ec111f613e4720145573a5f27b5e05a`:
- [Foundation 43520553376](https://github.com/1troitsky/photobunker-v3/actions/runs/43520553376): frontend TypeScript/Vite and **87 files / 509/509 Vitest PASS** (including signed timer budget).
- [Security 43520553382](https://github.com/1troitsky/photobunker-v3/actions/runs/43520553382): PASS.
- [UX 43520553453](https://github.com/1troitsky/photobunker-v3/actions/runs/43520553453): PASS.
- [Real PG18/Garage/Chromium 43520553373](https://github.com/1troitsky/photobunker-v3/actions/runs/43520553373): **IN PROGRESS** at report checkpoint; do not claim this last exact CODE SHA 87/87 until completed.
- PHP 8.4/8.5 Foundation FAIL before PHPUnit due the original main Laravel Composer lock advisory CVE-2026-128083, separately owned #297 / Draft #298. New server signed 300/3000s feature test is **NOT EXECUTED** against patched baseline.

**Still NOT IMPLEMENTED / NOT VERIFIED:** explicit safely reviewed user-facing recovery/publish action for interrupted fragments; process-kill mid-transaction, mobile PWA eviction, browser storage durability guarantees; automatic expired draft GC invocation and emergency PIN/Panic/Remote-Wipe integration of the new encrypted recording scratch database; 50min hardware capture on physical iOS/Android; full cross-device cloud audio → WAV trim exact flow; native codec/bitrate fidelity. **Panic/remote wipe integration is a required security gate before this new scratch storage is production accepted**. These gaps mean #206 stays **IN PROGRESS/PARTIAL**. No changes to other agents' #220 PIN or #223 DMS/Panic work.

## 2026-11-14 — opt-in interrupted-media review and local all-account scratch erase hook

### Explicit private, ephemeral preview after interruption

OWN `recording-encrypted-journal.ts` adds `readEncryptedRecordingForPrivateReview(id)` alongside the unchanged stricter `readCompletedEncryptedRecording(id)`. The former can decrypt only an **explicitly selected** `interrupted` or `complete` account-local/valid-key recording, never `writing`. It validates all AES-256-GCM tags, authenticated recording identity/MIME/key revision/chunk indexes/lengths and 128MiB aggregate before returning a temporary in-memory Blob. **This is NOT a signed MediaFile, official source, recovered cloud backup or automatic publish**. Partial encoder output may be unplayable if the platform never wrote its final trailer. A resumed "writing" state after a crash remains unreviewable until a separate safe stale-writer protocol is approved.

OWN `CaptureView.vue` now performs account-bound bounded scratch-GC (up to four batches of 25 expired private drafts) on mount/session-resume and displays only `interrupted`/`complete` encrypted local drafts. The user must explicitly click **"Просмотреть локально"** to trigger decryption and a volatile `blob:` audio/video preview, with no download/share/grant/cloud API. The URL is revoked on preview close, account/device/key change, mode switch and component unmount; a late AES-GCM decrypt after identity switch cannot create/open a URL. The user may explicitly **"Удалить фрагменты"** only after native `window.confirm`. Nothing silently deletes unexpired incomplete fragments, promotes them to a signed outbox row, or exposes drafts from another account/key.

OWN Vitest covers private AES-GCM reconstruction, wrong-account/tamper/unsealed rejection, no implicit preview, cancellation of delayed preview on identity switch, object URL revocation, confirmed deletion, no UI for a current `writing` journal and bounded 100-row current-account expired GC. OWN discovered Chromium E2E expands the earlier genuine microphone interrupted+reload scenario: lists ciphertext metadata, manual blob URL preview, revoke, explicit confirmed deletion and zero signed MediaFiles. **Real media decoder playback and format finalization of interrupted clips are NOT claimed**, only local revocable URL creation.

### Privacy deletion dependency for Panic / Remote Wipe

OWN journal exports `eraseAllEncryptedRecordingScratchForPanic():Promise<void>`. It deliberately requires no active recovered user session because Panic can run after logout/device revocation. It fail-closes all further recording reads/writes in the **current JS realm**, atomically clears **all accounts' scratch rows and ciphertext chunks** and verifies both tables are empty. A test constructs scratch belonging to two different account packages, removes the active session, calls the exported hook in fake-indexeddb and checks both tables empty plus denial of subsequent writes. This is a **reusable lower-level LOCAL primitive**, NOT authorization or a fully integrated Panic, not connected to PIN matching, the DMS scheduler, remote device revoke, cloud deletes, cross-tab stop/broadcast or a server ACK. Cross-tab active capture can recreate data if another tab is not coordinated by the future destructive orchestration. Never claim full emergency deletion because this function exists. An integration dependency was filed as non-claim comment [#221 Panic](https://github.com/1troitsky/photobunker-v3/issues/221#issuecomment-6866846244).

### Exact-head evidence

- Prior full live-recording code [real PG18/Garage/Chromium 43520858903](https://github.com/1troitsky/photobunker-v3/actions/runs/43520858903) at earlier accepted code SHA **87/87 E2E PASS**; prior 509/509 frontend test result also recorded above.
- Current preliminary private-review code SHA `25d5cbb743543255afe648e2ce15e6bc016f4857`: [Foundation 43521944134](https://github.com/1troitsky/photobunker-v3/actions/runs/43521944134) **516/516 Vitest (87 files) TypeScript/build PASS**; [Security 43521944148](https://github.com/1troitsky/photobunker-v3/actions/runs/43521944148) PASS; [UX 43521944268](https://github.com/1troitsky/photobunker-v3/actions/runs/43521944268) PASS. [real PG18/Garage/Chromium 43521944229](https://github.com/1troitsky/photobunker-v3/actions/runs/43521944229) IN PROGRESS at this checkpoint.
- Additional current-code bounded-GC test SHA `85d12905a55e678edfc0548845ce3c837f608401`: first [Foundation 43522314912](https://github.com/1troitsky/photobunker-v3/actions/runs/43522314912) frontend had an *unrelated existing* `folder-sync-crypto.test.ts` failure. The test "rejects altered ciphertext..." mutates random AES ciphertext using `slice(0,-2)+'AA'`, which is not a deterministic mutation if the suffix already matches; the owned #206 code does not touch Folder Browser crypto. Requested **rerun of only that failed frontend job on exact same SHA** (GitHub job retry); check outcome before claiming frontend final PASS. No foreign test edit, skip or weak assertion. PHP 8.4/8.5 lanes remain blocked before PHPUnit by inherited main Composer Audit CVE-2026-128083 (#297 / PR #298).
- [PG18/Garage/Chromium 43522314765](https://github.com/1troitsky/photobunker-v3/actions/runs/43522314765) on latest CODE SHA was IN PROGRESS at report checkpoint. Final results must be appended to Issue #206 / PR #306.

### Still blocked / not accepted

Verified native 50-minute physical iOS Safari/Android capture, true device OS permission withdrawal, media codec/remainder integrity after abrupt process kill, safe recovery of stale `writing` drafts, secure full Panic + Remote Wipe across all tabs/devices/storage layers, proven non-eviction/low-memory encrypted scratch durability, cloud two-account live-recorded audio and WAV edit/readback, and server PHPUnit on patched main baseline are **NOT TESTED**. This remains partial Issue #206, Draft PR only. No main/merge/deploy.
