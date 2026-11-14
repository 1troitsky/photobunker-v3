# P2 #400 — explicit Recovery Key save during onboarding (CHAT-AG)

**Date:** 2026-11-14 (Asia/Tbilisi). **Source:** `ts.md` §5.1/§5.3 and accepted `docs/ux/security-privacy/README.md`. **Status:** implementation candidate; exact-head CI evidence must be checked before review.

## Source and trust boundary

- Accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b`, untouched.
- Separate new branch from already verified source [Draft #397](https://github.com/1troitsky/photobunker-v3/pull/397) `53ae9ec2aa0af0bc10934349f33c3fa548169b32`; retains GraceStatusPanel and real AccountView registration.
- Only the initial registration screen already knows the generated PB2 recovery secret **in volatile memory**; `beginRegistration()` expressly does not persist it. Neither the server nor any after-login screen has a plaintext source for existing key.
- The user's explicit `Сохранить на устройство` button invokes `showSaveFilePicker` when present, with a `.txt` file choice. If unavailable, a **click-only** browser download is requested. No file or blob is created merely on rendering or registration.
- Plaintext security warning appears immediately next to the save action. No secret enters URL, server API, app IndexedDB, localStorage, analytics, background sync, or logs.
- Browser picker cancellation is a no-op; failed write aborts partial output as best effort and does not claim success. Download fallback reports only that a download was requested; it cannot attest physical disk safety or completion.
- Generated key remains visible until existing `finishRegistration` succeeds; its normal clearing behavior and identity proof flow are not changed.

## Exact file scope

- `apps/web/src/views/AccountView.vue`: explicit action, warning, no race between saving and finishing registration; existing signed flow unchanged.
- NEW `apps/web/src/features/identity/application/recovery-key-export.ts`: file picker, fallback download and no-persistence contract.
- NEW matching unit tests: exact serialization, cancel, successful write, best-effort abort/failure.
- NEW `tests/e2e/p2-settings-recovery-key-export-chat-ag.spec.ts`: genuine Chromium download after click, key bytes compared as **boolean only** so failure output does not print the key, normal signed registration/clear; separate picker-API shim while actual key generation/DOM remain real.
- Own audit file only.

## Required exact-HEAD gates

1. Node/Vitest for new unit suite; Vue strict TS and build; PHP8.4 + 8.5 baseline & Composer Audit; security and UX workflows.
2. Real Playwright Chromium with actual registration / PG18 + Garage. Validate original offline/identity, encrypted media and S3 outage suites unchanged. No new testMatch, skip, mocking of registration or security.
3. Verify latest `main` remains unchanged and `#397` source ancestry preserved; target only Draft PR, no merge.

## Deliberate NOT IMPLEMENTED / NOT TESTED

- Post-registration **Show/Download existing Recovery Key**: no existing recoverable plaintext is retained. Never synthesize a key from account/device public material.
- Changing/rotating Recovery Key on trusted device, re-encryption of old envelopes, revocation of other devices: requires its own security protocol.
- Real native macOS/iOS/Android save-picker UX, user-chosen filesystem permissions, OS-level file confidentiality, cloud backup/sync of a downloaded file and physical security are **NOT TESTED**.
- A browser-initiated download is not a verified OS file-write acknowledgment. The user must confirm storage before finishing registration.
- No claim that the full Security & Privacy settings screen or PB3 release gates are ready.

## Evidence

Fill exact immutable HEAD and workflow PASS/FAIL after GitHub Actions completes. Do not convert test counts from ancestor #397 into evidence for the child.
