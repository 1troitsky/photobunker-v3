# P1-04 — Assignment A → B (implementation slice 1)

**Status: SERVER + ENCRYPTED CLIENT + REAL UI VERTICAL CI-VERIFIED; FULL FIELDWORK UX INCOMPLETE** · Draft PR stacked on P1-03 @ `c0026b0b`. Not owner-accepted, not production-deployable.

## Normative references
- `ts.md §11` Assignment list/editor and four tabs. Do **not** mistake this narrow backend slice for the full UI/feature.
- PR #56 accepted Assignments 5.0 + Editor Media 2.2 (read-only), PB2 `AssignmentContract`, `AssignmentGrantContract`, `CaptureBinding`, migrations as evidence, not copied wholesale.
- P1-03 signed recipient directory + explicit owner-created photo grants, including first-contact fingerprint pin requirement.

## First server slice
- Assignment creation is **signed by owner account root** and carries `privateEnvelope` (client AES-GCM ciphertext + AKEK-wrapped key). Name/instructions are never provided as plaintext to Laravel. Server-visible capture policy: `allowedMedia=['photo']`, optional `photoGoal=1…9999`, start/end, active state and revision 1.
- Owner-signed invitations target one explicit recipient and carry an encrypted assignment DEK envelope, digest of recipient's pinned key and 7-day acceptance deadline.
- Recipient confirms invitation via **their own account-root signature**; owner cannot force acceptance. Invitation acceptance and creation are idempotent with immutable signed operation IDs.
- Contributor-owned photos remain under the contributor account. Submission is a separate signed association to a verified **active P1-03 photo grant addressed to assignment owner**. A team/assignment member does not automatically receive ciphertext or key material.
- Owner's submission listing returns only items with currently active photo and grant. Revocation removes subsequent server-mediated visibility; no deletion of contributor-owned photos.
- Permission checks use server authoritative state and policy revision, not client labels; bounded list pagination is used where implemented.

## Client cryptography implemented
- `assignment-crypto.ts`: AES-256-GCM encrypts private title/instructions, wraps an independent assignment DEK under the owner's AKEK with assignment- and account-bound AAD, and wraps that same DEK into an independently scoped recipient ephemeral ECDH + HKDF envelope. Raw key buffers are cleared after use.
- Decryption requires the correct owner account / assignment / recipient / invitation / expiry. The recipient caller must additionally verify the owner's signed invitation and manually pinned fingerprint before using the decoder.
- `assignment-crypto.test.ts`: genuine WebCrypto positive/negative cases, owner-key mismatch, AAD tamper, recipient key mismatch and expiry tamper.

## Tests
- Laravel Feature tests: signed creation/idempotency, owner-only visibility, explicit invite + recipient signed consent, forbidden outsider, active photo/grant association, revoke hides submission, contributor personal media remains.
- P1-01 through P1-03 feature/browser and isolated PostgreSQL 18 + Garage tests remain required.


## Real Vue vertical (latest)
- \`AssignmentsView.vue\` replaces the P0 placeholder at \`/assignments\` using the shared 64px/82px Fieldwork shell. Renders encrypted local drafts immediately, signed assignment list, basic cards/counters, invitation security-number verification, explicit acceptance, contributor photo selection, signed E2EE grant submission, owner-side decrypt viewer and durable operations. Local-first UI never calls an unverified HTTP ACK \`sent\`.
- A thin P1-only functional create form exposes **photo** target 1–9999 and encrypted name/instructions; **it is NOT the accepted final four-tab Editor Media 2.2**. No false archive/progress calculations or synthetic owner permissions are shown as server facts.
- Account-bound IndexedDB operations for \`create / invite / accept / submit\` are signed and durable; no plaintext metadata, recovery key or DEK is persisted in those requests. Invite requires pinned recipient identity and receiver consent. Submission requires a separate P1-03 recipient photo grant for each image.
- Security bounds: participant first-contact fingerprint is manually confirmed; pending/expired acceptance, server-protected grants and downstream authorization remain authoritative. Already-cached decrypted photos cannot be recalled on revoke.

## CI on \`28aab729\` (2026-11-09)
- [Chromium + PostgreSQL 18 / disposable Garage 2.5](https://github.com/1troitsky/photobunker-v3/actions/runs/42603942203): **PASS, 4/4 tests**. Includes **real UI** owner create / contributor invitation / fingerprint confirmation / recipient consent / offline capture / ciphertext sync / separate E2EE grant / signed submission / owner decrypt. Also retains earlier recovery, photo/outbox, outsider rejection and revocation tests.
- [PHP 8.4/8.5 PHPUnit + Vue TS/unit/production build](https://github.com/1troitsky/photobunker-v3/actions/runs/42603943404): **PASS**.
- [Version/security/tariffs floor](https://github.com/1troitsky/photobunker-v3/actions/runs/42603942480): **PASS**.
- Real phone/hardware, final Fieldwork UI 5.0 / Editor 2.2 and the entire feature matrix have **NOT** been owner accepted.

## Remaining before completion of #10
- Client-side signed assignment create/invite/accept/submit **durable outbox and UI wiring**, explicit owner fingerprint confirmation, camera policy binding/snapshots and sender proposal (not automatic grant) UX. Client AES-GCM/ECDH primitives now exist but are not yet integrated into the user flow.
- Real-phone manual A→B→A acceptance (Chromium with synthetic photos has passed) and full P1 owner/contributor signed camera-context policy; subsequent user-facing scopes and revocation UI.
- Revision transitions, historical policies for captured-at offline replay, reviewer roles, full four-tab approved assignment editor, retention/paywall and media extensions; keep these as required future work.

**No production access and no merges into main.**
