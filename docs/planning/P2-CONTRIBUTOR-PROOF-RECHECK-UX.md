# P2 V-21 — Owner receipt fingerprint confirmation from the row

**Status:** Draft / code written, exact-head CI pending. Stacked on P2 V-20 Draft #116 at `b89d0ffa3246edb8f8d5372fb3260a6139565038`. `main` unchanged. Matrix paused.

## Problem / scope

P2 V-17 independently verifies P2 MediaFile signed consent, and V-20 performs equivalent P1 photo receipt verification. A receipt can correctly remain **not verified** when the owner has never independently confirmed that contributor's P-256 signing key. However, owner rows exposed only an 8-character contributor ID. The owner needed to find the full UUID manually, visit the separate participant panel and then explicitly refresh all materials. This obscured the critical last security step and made an already-confirmed key appear ineffective until manual refresh.

## Implemented UX

- Every unverified P1 photo and P2 MediaFile submission row offers **«Сверить ключ автора»**. The button copies the complete contributor UUID only into the owner participant verification form and initiates `inspectPeer`; it NEVER confirms trust, signs a grant, changes an assignment, opens ciphertext or downloads a DEK.
- The UI scrolls to the actual fingerprint panel. The existing explicit independent fingerprint checkbox remains mandatory before `confirmPeer`. If an unpinned key changes, the established fail-closed behavior is kept; button interaction never silently trusts the server's directory.
- After the owner explicitly confirms the fingerprint, the client reruns BOTH P1/P2 receipt verification for only that contributor's already-loaded rows, across all visible pages. Per-contributor P-256 signatures, contracts and hashes are still checked individually; an invalid signature remains **not verified**, regardless of key confirmation.
- Reverification updates status in place without resetting page cursors or fetching/decrypting user media. A failed proof never decreases server-authoritative confirmed counts, and no local queued event is presented as a confirmed submission.
- `receiptProofEpoch` invalidates obsolete page and signature responses when assignment, account or trust context changes. Initial load and subsequent P1/P2 continuation pages share the barrier; stale responses cannot overwrite a newer explicit fingerprint verification.
- Generic wording `Подпись ... не проверена` deliberately does **not** assert the reason (missing pin, changed key, invalid contract or signature all possible).

## Safety/regression checks

- Real P1 camera → signed contributor submission → owner explicit E2EE grant and receipt E2E is extended: delete **only disposable browser's local owner contributor peer pin**, refresh owner materials (signature unverified), click its row's fingerprint action (full correct contributor UUID), independently confirm key, and expect the existing receipt to become verified without another manual server page refresh. No server grant or file is deleted. Existing owner decrypted-photo and AV journeys continue after this check.
- Requires exact-head strict TypeScript, Vitest, PHP 8.4/8.5, PostgreSQL18/Garage/Chromium and security jobs, including the modified P1 two-account real-browser journey.
- No native Safari/iOS/Android or independent owner acceptance performed. No Public Card, anonymous E2EE, proof of physical camera/GPS integrity, Matrix or archive/physical GC in scope.

Only a verified account signature is claimed, **never physical-world evidence**.
