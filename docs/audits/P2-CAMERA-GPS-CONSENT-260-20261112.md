# Camera: GPS consent lifecycle — Issue #260

Date: 2026-11-12. Product branch `fix/p2-camera-gps-consent`, based on verified integration [#187](https://github.com/1troitsky/photobunker-v3/pull/187) @ `7a309508cc140897ae6dd75f8d473a89c7296be2` (7/7 checks successful). No main merge/deploy; no edits to upstream QA or Product branches.

## Defect and correction

[Issue #260](https://github.com/1troitsky/photobunker-v3/issues/260) records genuine revoked browser permission followed by reuse of an earlier fix in an offline AES-GCM photo. `obtainGPS()` previously set only `gpsError` after failure, leaving `gps.value` available. Freshness validation is not consent validation.

`CaptureView.vue` now invalidates the previous fix **before** every explicit request, clears it on failure, bounds native requests to 12 seconds and passive Permissions API reads to 1 second, and detaches/cancels its observer and request on cancellation, account/device/key changes, assignment/route/mode changes and teardown. Equivalent online-session hydration preserves ownership. The sole observer is a PermissionStatus listener, never a location watcher; camera mount, shutter and background events cannot trigger geolocation prompts.

At shutter and after asynchronous JPEG rendering, coordinates are checked with existing `normalizeGPS` and a fresh non-prompting permission read. Denied/prompt/unsupported/rejected/timed-out permission reads cannot authorize attaching coordinates. Optional captures can proceed without GPS. Existing independently verified signed `requiredGps` policies reject absent GPS before enqueue. After signing, consent or context changes cancel the operation rather than reinterpret its evidence. Video/audio check at start and finalization; revoked GPS-bearing recordings are refused.

Both existing encryption entry points accept an optional volatile caller assertion, checked before crypto and before/inside the atomic IndexedDB transaction, including after `put`. A changed consent/context aborts the **new** write even if revocation arrives while encryption or the transaction is pending. Real AES-GCM + fake-indexeddb tests prove rollback at each boundary; already durable ciphertext is retained. No ciphertext contract, key hierarchy, policy signature, TTL, server code, migration, gallery-write behavior or network privacy invariant changes.

## Verification

Machine-readable sanitized record: [evidence JSON](evidence/P2-CAMERA-GPS-CONSENT-260-20261112.json).

| Gate | Result | Reproducible command / evidence |
| --- | --- | --- |
| Frozen dependencies | PASS | `pnpm install --frozen-lockfile`, exit 0 |
| Strict TypeScript | PASS | `pnpm typecheck`, exit 0 |
| Vitest | PASS | `pnpm test:web`, exit 0, **386/386** across 76 files |
| Production build | PASS | `pnpm build`, exit 0 |
| UX lane unit rules | PASS | `node --test docs/ux-integration/check-pr-lane.test.mjs`, exit 0, 5/5 |
| Accepted UX source integrity | PASS | `node docs/ux-integration/verify-source.mjs`, exit 0, 117 baseline files |
| Browser discovery | PASS (discovery only) | `pnpm exec playwright test --config tests/playwright.config.ts --list`, exit 0, **66** tests |
| Full PHP8.4/8.5 + security + PG18/Garage + Chromium CI | PENDING | Required before reporting verified completion; no skips/retries or gate changes |
| Native iOS Safari / Android Chrome-PWA / actual GNSS | NOT TESTED | No physical-device execution or hardware provenance claimed |
| UX aesthetics / performance | NOT VERIFIED | No visual change or performance claim; no invented baseline |

### Negative tests retained

`tests/e2e/p2-browser-camera-gps-permission.spec.ts` is copied **byte-for-byte** from [QA #258](https://github.com/1troitsky/photobunker-v3/pull/258) @ `16ecbfa5720e93ebc0ebb2fd12ab4a5c0e3a5283`. All four assertions, including revoked-consent UI and decrypted-GPS negatives and the stale-provider rejection, remain unchanged. Its SHA-256 is recorded in JSON. QA #258 itself is untouched.

Two additional Chromium tests revoke permission between fix and shutter **without another GPS request**, checking optional photo decrypted metadata and genuine owner-signed required-GPS offline rejection. They use real Key-Only registration, browser permission changes, camera/Canvas and local AES-GCM. Unit cases additionally cover repeated denial and retry, prompt/denied events, delayed events, unsupported/rejected/stuck permission query, bounded native timeout, account/device/key/context/cancel/teardown callbacks, equivalent-session hydration, signing/Canvas/encryption races, P1/P2 guards, AV finalization and real encrypted-write rollback.

## Integration ownership

At first inspection Issue #260 already had another agent's claim. During this independent implementation [Product Draft #262](https://github.com/1troitsky/photobunker-v3/pull/262) appeared @ `01d10f9b4fa7cef51993e80d730e6e48e03928e7`, modifying the same Camera/test files on a separate QA-derived base. **These are alternative implementations; do not merge both.** This branch adds atomic outbox cancellation and broader independent regressions on the verified #187 baseline. Neither #262 nor #258, other open PRs, `main` or `ts.md` is modified. Parallel Matrix/storage/Editor lanes are excluded.

## Limits

Chromium geolocation uses synthetic coordinates and browser network-offline fixtures. This proves consent and encrypted metadata handling, not GNSS authenticity, physical airplane mode, native iOS/Safari or background OS reliability. Unsupported permission introspection conservatively makes GPS unavailable for a new capture; it does not bypass signed policy. A deliberately stale provider value still displays until the existing shutter freshness gate rejects it, preserving the original QA negative test.

Browser permission checks and IndexedDB are not an atomic OS transaction. The final synchronous guard rejects all permission/context invalidations observable before commit; an OS transition that the browser has not exposed cannot be attested by JavaScript. Permission listeners never erase previously durable media. Mobile/native owner acceptance remains a separate gate.
