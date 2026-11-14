# P2 #404 — Browser catalog offline import, signed session bootstrap QA

**Author:** CHAT-AH · 2026-11-14 · **Scope:** test-only, no production change.

## Original failure and preserved evidence

Accepted main: `8ed66c438d090efd218efa80b027f0b2f854db4b`.
Immutable QA source: [Draft PR #386](https://github.com/1troitsky/photobunker-v3/pull/386) at `6fa8a579242e90de1176266f650fb7ee17c98eac` (owner CHAT-AA / Issue #385, different claimed tests).

- First real PostgreSQL18/Garage/Chromium [#43590829463 attempt 1](https://github.com/1troitsky/photobunker-v3/actions/runs/43590829463/attempts/1): **93/93 PASS**.
- Second independent cold runner on **same source** [#43590829463 attempt 2](https://github.com/1troitsky/photobunker-v3/actions/runs/43590829463/attempts/2): **92/93 FAIL**, job `132436987250`. Existing unchanged `tests/e2e/p2-browser-catalog.spec.ts:24`: offline import did not show text `Файл зашифрован и сохранён` in 15 seconds. Original Playwright failure-trace artifact `14112388448` retained.
- Both new #385 tests modified by CHAT-AA passed on the second runner; this is another independently observed old-test failure, not evidence #385's own two tests are wrong.
- Catalog test was executing `goto('/browser')` followed by DOM-mounted assertions, immediately switching offline, then using account-scoped `enqueueEncryptedMedia()`. The app remount asynchronously resumes the signed client session after mounting; a mounted Browser view does not prove the device is unlocked or server-authenticated. **The observed log does not prove bootstrap timing as the root cause**; genuine new runner validation is mandatory.

## Bounded change

OWN branch `qa/p2-404-browser-catalog-bootstrap-chat-ah-20261114` starts from immutable PR #386 SHA above. The only existing file modified is `tests/e2e/p2-browser-catalog.spec.ts`; this report is the only new file. No #386 branch edits, no changes to #385-owned viewer-return-context/contact-picker specs, Identity, Media outbox, Browser, PHP, GitHub workflows, or Playwright configuration.

- Immediately after anonymous Key-Only registration, capture `accountId/deviceId` from the actual active device; require `online=true`.
- After each hard Browser navigation and before flipping offline, bounded polling requires local `activeSession.online` for that same account/device **and** authenticated live `GET /identity/v2/me` binding. A mismatch throws; unauthorized or missing proof cannot become a simulated PASS.
- First offline import additionally checks actual Dexie encrypted media row: same account and signed contract account, original 8192 plaintext-byte count, queued status, at least data+metadata encrypted Blob chunks each with 16-byte AEAD overhead, blob size equal to declared size, valid checksum hashes and no private file name serialized in the public row. The existing user-facing success text and original file Viewer, privacy filter, sort, reload and independent second-test byte-size checks remain intact.
- After an online document reload, proves signed session before flipping offline again, rather than conflating signed PWA cold-offline bootstrap with local encrypted cache availability.

## Boundaries and security invariants

This is test precondition/observability strengthening, not a change in runtime login logic or proof that all session races are fixed. No forced online status, sleep, fake ACK, test skip, blanket Playwright retry, increased timeout on original success assertion or production crypto modification. Original failed SHA/artifact remains evidence. Signed cursor #254 remains HOLD. No physical iOS/Android acceptance.

## Final CI evidence

**PENDING:** exact owned HEAD / Foundation, Security, UX, PostgreSQL18+Garage+Chromium will be recorded in #404 and Draft PR. A green single run cannot conclusively eliminate an intermittent defect; preserve further real failures and report separately. No merge/deploy approval.
