# P2 Camera GPS permission & privacy acceptance — Issue #208

**Date:** 2026-11-12  
**Scope:** independent QA-only E2E + evidence, no production camera/policy/crypto modifications.  
**Base:** verified combined [Draft PR #187](https://github.com/1troitsky/photobunker-v3/pull/187) @ `7a309508cc140897ae6dd75f8d473a89c7296be2` (not old main).  
**Status:** exact-head CI PENDING.  
**Tests:** `tests/e2e/p2-browser-camera-gps-permission.spec.ts` (the proposed `p2-camera-*` name would not be discovered by the repo's existing `tests/playwright.config.ts` `testMatch`; `p2-browser-*` is the active whole-suite acceptance gate).

## Requirements from repository sources

- `ts.md` §14 and §25.3 require signed assignment GPS rules, browser consent, offline local-first E2EE, no OS gallery, device permission verification.
- `CaptureView.vue` only calls `getCurrentPosition` after an explicit **Получить GPS** action, with `enableHighAccuracy:true`, `maximumAge:0`, `timeout:12000`. Geolocation is not auto-started on camera mount.
- `capture-metadata.ts` rejects invalid/out-of-range or older-than-120s fixes. Client-side signed assignment enforcement rejects `requiredGps` with no valid `gps` before any encrypted file is saved.
- GPS is private metadata inside a separate AES-GCM encrypted asset; server-side signed capture **policy** is not a hardware/GNSS timestamp attestation. No test can prove genuine physical location from Chromium synthetic coordinates.

## Independent browser cases (all use real Key-Only session, real Canvas and E2EE)

1. Real Chromium geolocation, synthetic fixed coordinates, explicit click only. Instrument **the real browser API** to verify options and no background calls; save an offline encrypted photo and decrypt metadata; compare coordinate accuracy and timestamp. Neither visible signed contract nor recorded network URLs/bodies may contain coordinates.
2. Owner creates a **real signed revision-2 required-GPS assignment** using the product UI. Geolocation denied -> explicit error + `assignment.gps_required` and **zero local ciphertext photos** even offline. After explicit browser permission grant, same verified signed policy can create a local AES-GCM photo; decrypted private metadata and signed capture policy revision/capturedAt must match; no plaintext GPS in public contract.
3. Negative fixture: stale position returned with a 181-second-old timestamp (Chromium's `setGeolocation` cannot set arbitrary timestamp). Existing real capture pipeline must reject `capture.invalid_or_stale_gps`, produce zero encrypted files.
4. **Security regression / known code-level risk:** grant geo, receive fix, revoke geo while retaining camera, click GPS again (denied). The Camera must remove prior location status **and must not reuse earlier fix** in a new local encrypted photo. `CaptureView.vue` currently clears `gpsError`/sets `gpsLoading` in `obtainGPS()`, but on error sets only `gpsError` and does not explicitly reset `gps.value`. The test deliberately preserves both negative assertions; if fail, treat as real product vulnerability and **QA HOLD**. No production camera changes permitted by #208. Request separate authorized product correction, keep the failed evidence.

## Gates & limitations

- Required: exact-head PHP8.4/8.5, strict TS/build/Vitest, security and UX lane guard, real PostgreSQL18+Garage and full Chromium incl 4 new scenarios. No skip, fake consent, timeout relaxation, CI allowlist changes or privacy bypass.
- Browser's `permissions`, `geolocation` and `setOffline` are disposable Playwright **test fixtures**; they do not attest to real GPS hardware or mobile OS. Negative stale-provider fixture is intentionally simulated, but runs actual frontend production logic.
- Genuine permission events from physical Safari/iOS/Android and actual high-accuracy GNSS hardware: **NOT TESTED**. Flight mode is represented by a real browser network-offline flag; a radio-level airplane mode is NOT TESTED.
- Permission revocation after a previously acquired fix must be a negative gate rather than merely observing an error label.
- No writes to `main`, accepted `docs/ux/**`, Camera, GPS policy implementation, session, photo sync, Matrix, other agents' branches or PRs.
