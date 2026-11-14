# P1 / #378 — browser anti-forensics persistence and logout boundary

**Date:** 2026-11-14 · **Executor:** CHAT-AB · **Base:** `main@8ed66c438d090efd218efa80b027f0b2f854db4b` (confirmed before CLAIM).  
**Scope:** security QA only, **not** a completed secure-vault/Panic/remote-wipe implementation.  
**Normative:** `ts.md` §5.3, plus #201's explicit residual gap for offline cached plaintext.  
**Evidence source:** `tests/e2e/p1-qa-persistent-storage-anti-forensics-chat-ab.spec.ts` on this Draft PR's exact HEAD; final CI status must be read from the PR run, not inferred from the test source.

## Grounded code preflight

- `apps/web/src/features/identity/application/session.ts`: `logout()` clears the in-memory session and durably marks the device signed out; it does **not** delete encrypted outbox files.
- `apps/web/src/features/identity/infrastructure/storage.ts`: device/identity keys are stored as non-extractable browser `CryptoKey` objects and key envelopes; the original Recovery Key should not be durable.
- `apps/web/src/features/media/application/media-outbox.ts`: `pb3-encrypted-media-outbox-v1` stores AES-GCM ciphertext chunks and encrypted metadata; `readLocalMedia` decrypts for an authenticated local session.
- `MediaImportPanel.vue` and `PhotoBrowserView.vue`: session watchers clear visible decrypted previews on account/device switch/logout; `FileViewerView.vue` has its own identity-watcher purge.
- `tests/playwright.config.ts` includes `p1-*.spec.ts` in the default real Chromium suite. The native Service Worker, physical platform cache, crash dumps, device OS Gallery and independent trust-root behavior are not covered here.

## Exact automated acceptance scenario

1. Register an actual key-only account and retain the Recovery Key only inside the test runner; no secret is printed, traced, screenshotted or placed in a committed fixture.
2. With already-loaded PWA shell **offline**, import a unique synthetic WAV byte payload with private filename/category/description/tag through genuine browser UI into the durable encrypted MediaFile outbox.
3. Open the actual locally decrypted preview. Enumerate and read the current browser origin's **IndexedDB object-store values and Blob/ArrayBuffer bytes**, `localStorage`, `sessionStorage`, accessible `document.cookie`, and JavaScript Cache Storage entries. Fail on any raw marker/recovery key/private text; require a real durable encrypted media row and inspected bytes. Bound object-depth/blob-size so the test cannot silently skip an unbounded record.
4. Call the **real** `identity.logout()` while still on Browser route and genuinely offline. Require the decrypted preview to disappear, the previously issued `blob:` URL to be unusable, and encrypted IndexedDB outbox rows to remain.
5. Restore connectivity, reload, verify the signed-out device does not auto-login and no raw secrets are found in the same origin's stores. No auto browser download should fire.

**Isolation:** two ADD-only paths in this PR; no production, existing tests, shared workflows, secrets, foreign branches or `main` modified. **No fabricated Garage or authentication ACK.** Existing real PostgreSQL18/Garage/Chromium workflow and Foundation/Security/UX must be checked on the *new PR HEAD*.

## Evidence ledger

| Gate | Status | Evidence/qualification |
| --- | --- | --- |
| Exact-source static preflight | PASS | Inspected source at immutable base `8ed66c43`; own new test included by `p1-*.spec.ts` pattern |
| New Chromium origin-storage/logout test | PENDING CI | Must inspect actual exact-head PG18/Garage job and test count |
| Full Foundation / security audit / UX | PENDING CI | No PASS until workflows complete |
| Private OS media gallery, true HTTP disk cache, OPFS eviction, heap remnants | NOT TESTED | Browser JS APIs cannot establish a device-level anti-forensics guarantee |
| Physical iPhone Safari and Android PWA | NOT TESTED | No physical hardware evidence |
| PIN/Panic/dead-man-switch and remotely signed wipe | NOT TESTED | Not implemented by this QA-only PR |
| Production encryption and full PB3 release | NOT ACCEPTED | Evidence here is bounded regression coverage |

A FAIL or infrastructure block requires an updated issue/PR evidence record; never weaken security assertions for a green check.
