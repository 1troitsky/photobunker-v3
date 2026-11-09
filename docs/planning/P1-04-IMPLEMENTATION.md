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

## Follow-up: signed capture policy integration (Draft PR #12)

The original P1-04 UI and durable assignment operations listed above were implemented and CI-verified in PR #11. Earlier notes listing those same operations as pending were outdated and have been replaced.

PR #12 adds account-authenticated owner-signed policy snapshots, per-account offline cache, camera assignment selection, device-signed photo v2 capture binding, server reservation and submission verification, and negative authorization tests. It also addresses an intermittent offline→online hydration refresh race seen in Chromium CI. See [the scoped protocol and acceptance gaps](P1-04-CAPTURE-POLICY-V2.md).

**PR #12 is not yet accepted:** latest head must pass Chromium + PostgreSQL/Garage as well as PHP/TS/unit checks. The parallel QA agent is testing the fixed PR #11 baseline independently.

## Remaining before completion of #10

- Confirm latest PR #12 real-browser integration and independent local/hardware A→B→A acceptance (especially iOS Safari/PWA camera, IndexedDB and offline recovery).
- Signed historical policy revisions, explicit revision transitions and authorization for offline captures under older policies; immutable per-capture evidence and clock/expiry semantics.
- Full approved Camera 1.2 capture presets and required category/GPS/description; accepted four-tab Assignments 5.0 / Editor Media 2.2 and a final Assignment Detail design.
- Owner/curator reviewer scopes, editor permissions, team/contact integration, retention/tariff enforcement and photo/video/audio extensions; account key rotation and security audit remain additional planned gates.

**No production access, no merge into main, no production cleanup activation.**
