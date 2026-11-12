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

## CI evidence so far

- First exact-head `d78f314d`, [real PG18/Garage+Chromium run 43204580615](https://github.com/1troitsky/photobunker-v3/actions/runs/43204580615): **63/64 PASS**. The explicit real GPS, signed required-policy denial/recovery and 181s stale-fix tests all PASS. The revoked-permission scenario failed at a `getByRole('alert')` expectation after `context.grantPermissions(['camera'])`. That alone does **not** prove a stale GPS was persisted (error could be absent due to browser permission fixture semantics).
- Revised on `cb191ed0`: first require `navigator.permissions.query({name:'geolocation'}).state==='denied'`, then deliberately test no old GPS status; **continue** to take a new real encrypted photo and decrypt its metadata to assert no stale `gps`. No production changes or relaxed privacy assertion; the browser alert label is no longer treated as the sole evidence.
- **Current status: QA HOLD / exact-head Chrome rerun required.** Do not infer a product defect solely from the previous missing alert. A failure after verified permission revocation plus decrypted stale GPS would establish the real security bug.

## Revocation permission fixture correction (second Chromium run)

- On `6082e457`, [run 43205592632](https://github.com/1troitsky/photobunker-v3/actions/runs/43205592632) was again **63/64 PASS**. The negative test explicitly queried `navigator.permissions.query({name:'geolocation'}).state` after `context.grantPermissions(['camera'])`, and received **`granted`**, not the required `denied`. Browser permission was **not** actually revoked by that fixture update. This outcome is **not product-bug evidence**.
- Updated `ab56e0e7`: perform `context.clearPermissions()` first, then `context.grantPermissions(['camera'])`, require the real browser permission state is **not `granted`**, and preserve negative UI + AES-GCM decrypted metadata assertions. Permission `prompt` is not considered approval and must not authorize reuse. Third exact-head full CI required.
- If browser state transitions but decrypted photo still contains earlier location after an explicit failed re-request, mark Product **FAIL** and link a separate scoped Camera remediation. No Camera source modifications in #208 QA branch.

## Confirmed product FAIL — verified permission revoked, old GPS reused

Final QA head `d8a31ca373e0ed256a5f79c0e68bb19d87eb2dbf` [run 43206754883](https://github.com/1troitsky/photobunker-v3/actions/runs/43206754883):

- **64 real Chromium E2E executed; 63 PASS, 1 FAIL**, exactly the revoked-permission privacy regression at `p2-browser-camera-gps-permission.spec.ts:192`.
- Browser permission was truly no longer granted: `context.clearPermissions()`, then explicit camera-only permission, followed by the passing `navigator.permissions.query({name:'geolocation'}).state !== 'granted'` browser assertion.
- On explicit repeat request for GPS without permission, UI **retained** “GPS получен”: `expect.soft(...).toHaveCount(0)` **FAIL** (received 1).
- After an offline real JPEG capture into the local AES-GCM store, readback through real `readLocalPhotoMetadata()` showed **the previous GPS fix still present**. Hard negative assertion `expect(data.gps).toBeUndefined()` **FAIL**. Coordinates in this CI are synthetic; real device permissions are NOT TESTED.
- **Root cause:** `CaptureView.vue` `obtainGPS()` resets `gpsLoading` and `gpsError` but does not clear `gps.value` before or after failed reauthorization, and `capture()` snapshots `gps.value` as metadata. `normalizeGPS()` validates age/range but does **not** validate live permission state. The file is properly AES-GCM encrypted, yet consent revocation is bypassed by reusing a once-permitted location. This is a **real client privacy defect**, not a failed permission fixture or crypto failure.
- Other three new scenarios **PASS**: explicit opt-in high-accuracy position and no plaintext GPS in HTTP/contract, signed GPS-required policy denies without fix and accepts consent offline, 181s stale provider fix rejected.
- Same SHA: PHP8.4+8.5, TypeScript/build, **354/354 Vitest**, Security and UX lane guard **PASS**. Full quality gate therefore **HOLD**, not all green.
- **Policy of QA-only #208:** Do not “fix” by weakening the negative assertion, mocking permission approval, increasing timeout or touching Camera. Create a separate product-owner issue; rerun this exact regression on its integration descendant. Keep #208 open and blocked until product fix, full 64/64 E2E, real-device acceptance.

## Gates & limitations

- Required: exact-head PHP8.4/8.5, strict TS/build/Vitest, security and UX lane guard, real PostgreSQL18+Garage and full Chromium incl 4 new scenarios. No skip, fake consent, timeout relaxation, CI allowlist changes or privacy bypass.
- Browser's `permissions`, `geolocation` and `setOffline` are disposable Playwright **test fixtures**; they do not attest to real GPS hardware or mobile OS. Negative stale-provider fixture is intentionally simulated, but runs actual frontend production logic.
- Genuine permission events from physical Safari/iOS/Android and actual high-accuracy GNSS hardware: **NOT TESTED**. Flight mode is represented by a real browser network-offline flag; a radio-level airplane mode is NOT TESTED.
- Permission revocation after a previously acquired fix must be a negative gate rather than merely observing an error label.
- No writes to `main`, accepted `docs/ux/**`, Camera, GPS policy implementation, session, photo sync, Matrix, other agents' branches or PRs.
