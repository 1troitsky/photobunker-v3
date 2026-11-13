# P2 QA — Chromium E2E asynchronous readiness, real ciphertext/server/camera gates

**Status:** QA-only corrective test changes written; new exact-head CI **PENDING**.
**Product parent:** Draft [#151](https://github.com/1troitsky/photobunker-v3/pull/151)
@ `e3aa6c7b24d1be49fcb5ab9b453de1fdc47ed755` (**CI 2/3, HOLD**).
**Scope:** tests only + this independent audit, no product runtime, API,
crypto, permissions, testMatch, retries, timeouts or CI bypass.
**Screens / journeys:** Browser S07/S08 N-15–N-17 J-04/J-21; assignment
bound safe source J-06; camera capture / encrypted submission J-03.

## Exact observed evidence (do not reinterpret a failed run as green)

- Original product commit `29aaf7fe6f9e557f326495fdffb6279a5e8f94f4`
  [full CI Chromium run 43161392729](https://github.com/1troitsky/photobunker-v3/actions/runs/43161392729):
  **54/54 PASS**. The final #151 commit subsequently changed only
  the way the new figure E2E operates the native range slider.
- Product #151 exact head `e3aa6c7b...` has three separately observed
  **53/54 FAIL** attempts, same real PostgreSQL18/Garage workflow
  [43161587346](https://github.com/1troitsky/photobunker-v3/actions/runs/43161587346),
  with the *new* five-figure photo E2E PASS in every attempt:
  1. Job `130993823431`: Safe-only recipient scenario
     `p2-browser-safe-recipient.spec.ts:216`; after locally creating and
     synchronizing an assignment, `.assignment-detail code` never became
     visible within 30 sec.
  2. Job `130995552262`: Browser/Viewer return scenario
     `p2-browser-viewer-origin-scoped-pager.spec.ts:23`;
     after two `setInputFiles` events, the Browser listed **1** row
     instead of **2**. Original test did not wait for the file picker to
     be enabled or the encrypted media write to commit.
  3. Job `130997830064`: contributor camera/media assignment scenario
     `p1-assignment-media.spec.ts:557`; after switching to video and
     clicking Record, `camera-recording-status` never became visible
     within 15 sec. Same symptom previously observed on parallel UX #146,
     whose Camera code also was not changed.
- PHP8.4/8.5, strict TypeScript/Vue/Vitest/build and security workflows
  were already **PASS** on #151's exact head.
- This is evidence of *variable observed failure points*, **not proof**
  that all three failures are merely harness issues. A real product
  bug, policy refusal or async ownership race remains possible and
  must produce a clear failure rather than a fabricated success.

## Root-cause candidates checked against current code

1. **Media import:** `MediaImportPanel.vue:111–152` sets `busy` while
   authenticated AES-GCM creation and durable IndexedDB write occur.
   File `input` is actually disabled while busy; Playwright's
   `setInputFiles` bypasses disabled inputs and can dispatch a second
   change that `importFiles` legally ignores. **Correctness fix:** wait
   for enabled picker before every real user selection, then poll real
   local outbox for exact metadata filenames and browser row count.
   No sleeps, no fake media rows.
2. **Assignment create/sync:** `AssignmentsView.vue:444–456` first
   queues a signed, encrypted local draft and only then selects its ID;
   `synchronize` drains the existing real outbox and invokes a
   separate async hydrate. The original E2E clicked Sync immediately
   after submitting Create without confirming durable local selection.
   **Correctness fix:** demand the actual local created state and stable
   selected UUID **before** Sync, then wait for the *same* create op to
   be `sent` and independently authenticated server listing to
   include that assignment, and require the selected card to survive
   refresh. A missing signed receipt or lost selected card **fails**.
3. **Camera mode:** `CaptureView.vue:527–533` replaces MediaStream
   asynchronously when capture mode changes. `CameraView.vue`
   `beginRecording` also has a separate policy/preflight check before
   MediaRecorder can start. The original E2E asserted only that the
   Record button was enabled; it did not prove live video + audio
   tracks in the **new** stream. **Correctness fix:** await a genuine
   HTMLVideoElement with nonzero decoded width and both active tracks;
   then Record, and assert the real recording state, reporting any
   explicit preflight error as a test failure (not an allowed outcome).
   Keep real camera recording duration and source-bound policy checks.

## Boundaries and regression assertions

- **No retry logic** around failing operations; `retries:0` unchanged.
  No `test.skip`, `test.fixme`, timeout inflation, waitForTimeout
  delay, artificial server state or browser mocking added.
- **No new production code or duplicate domain implementation**. E2EE
  outbox, signed assignment checks, Server receipt, active camera stream,
  actual encrypted file identity and browser UI are still checked.
- QA changes only:
  `tests/e2e/p2-browser-viewer-origin-scoped-pager.spec.ts`,
  `tests/e2e/p2-browser-safe-recipient.spec.ts`,
  `tests/e2e/p1-assignment-media.spec.ts`, this report.
  No shared runtime overlap with parallel UX #146/#150/#152; #152
  touches a different settings E2E.
- **Gate:** full exact-head PHP8.4/8.5/TypeScript/build/Vitest,
  security, real PostgreSQL18/Garage and **54/54 Chromium E2E**
  must PASS. A green run alone cannot prove long-term absence of
  intermittency: subsequent independent runs/local-browser stress are
  still appropriate. Do not promote #151 product acceptance, perform
  owner visual acceptance or merge to `main` automatically.
