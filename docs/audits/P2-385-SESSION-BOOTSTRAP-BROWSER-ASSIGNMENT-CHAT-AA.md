# P2 QA #385 — post-navigation signed session barrier in Browser and Assignment picker

**CHAT-AA · 2026-11-14 · QA-only Draft PR, no merge/deploy authority.**

Base accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b`. Branch `qa/p2-385-browser-assignment-bootstrap-chat-aa-20261114`. Status **PENDING exact-head CI** on creation.

## Original real failure evidence

[Issue #382 / Draft #384](https://github.com/1troitsky/photobunker-v3/pull/384) changed only three NEW-only PostgreSQL QA files, not browser/session/product code. Its exact SHA `4af3c8a36a5490803fb8be081d408c9d8d732b13` failed the real PG18/Garage/Chromium suite on two new independent disposable runs:

1. [Run 43588630947 attempt 1](https://github.com/1troitsky/photobunker-v3/actions/runs/43588630947/attempts/1): **92/93**, `p2-browser-viewer-return-context.spec.ts:30` created private folder, expected one `.browser-folder-item`, received zero after 15s.
2. [Same SHA attempt 2](https://github.com/1troitsky/photobunker-v3/actions/runs/43588630947/attempts/2): **92/93**, **different** `p1-contact-assignment-picker.spec.ts:43` after signed encrypted assignment create + Sync, expected a visible `.assignment-detail code`, none after 15s.

Both Playwright traces preserved in original workflow artifacts. The two failures may have different causes; a missing Vue node is **not** proof of lost ciphertext, authentication violation or a shared bug. Prior [#358 / Draft #360](https://github.com/1troitsky/photobunker-v3/pull/360) demonstrated that SPA `main.ts` mounts before asynchronous `resumeExistingDevice()` completes, and its **different** P2 tests pass 3 fresh real Chromium runs on its own SHA. This is not evidence #385's two paths are fixed.

## Exact owned files and fail-closed QA design

- `tests/e2e/p2-browser-viewer-return-context.spec.ts`: capture actual account/device at original signed registration; after hard `/browser` navigation, poll **real** active online session and authenticated `GET /identity/v2/me` for **exact account and device match**. Any different local/server identity fails (does not retry away). On folder create, additionally independently reload/decrypt actual local AES-GCM IndexedDB folder workspace and require exactly one named folder. Original rendered row, private audio handling, encrypted placement, File Viewer/Back and restored filter/search/anchor assertions unchanged.
- `tests/e2e/p1-contact-assignment-picker.spec.ts`: register real separate owner A/contributor B, preserve exact account/device, require verified real backend session after hard Contacts/Assignments/Browser navigation **before** network-sensitive actions. After create, explicitly verify one real durable owner-local E2EE draft; after explicit `Синхронизировать`, independently list server-authenticated signed assignments and require the matching original ID. Then still demand actual rendered `.assignment-detail code` and exact ID equality. All existing fingerprint confirmation, recipient invite, signed removal, crypto tamper denial, offline cached-policy invalidation negative tests unchanged.
- This test-only change neither calls `reauthenticate()` as a forced workaround nor sets `session.online`, installs mocks, artificially sleeps, silences errors or relaxes 15s UI checks. Session proof is a mandatory **precondition**, not the expected business outcome; a true UI/product bug must still FAIL.

No `src/`, no shared Playwright config, no other E2E, workflows, Laravel, main or foreign branches touched. Preflight confirmed #360, #375, #380, #383, #384, #377 do not change either claimed test path. #358 review/CHAT-V claim released; #382 earlier CHAT-AA claim released and remains blocked until separate independent acceptance.

## Mandatory evidence / interpretation

- **PENDING** fresh exact-code-HEAD 4/4 workflows, including PHP 8.4/8.5 frontend/unit, Security, UX, real PostgreSQL18/Garage/Chromium (all tests, not just focused paths). Failed original runs must stay documented.
- First real cold Chromium run cannot prove nondeterminism eliminated. A second independent cold runner test on the *same* exact HEAD is desirable if first PASS. Never modify a foreign file to make green.
- Physical iOS/Android permissions/sensors, 10k actual E2EE files, cryptographically signed cursor #254 (owner HOLD), production telemetry and complete PB3 release **NOT TESTED**.
