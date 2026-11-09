# P1-04 — Assignment A → B (implementation slice 1)

**Status: BACKEND FOUNDATION ONLY** · Draft PR stacked on P1-03 @ `c0026b0b`. Not owner-accepted, not production-deployable.

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

## Tests
- Laravel Feature tests: signed creation/idempotency, owner-only visibility, explicit invite + recipient signed consent, forbidden outsider, active photo/grant association, revoke hides submission, contributor personal media remains.
- P1-01 through P1-03 feature/browser and isolated PostgreSQL 18 + Garage tests remain required.

## Remaining before completion of #10
- Client-side assignment AES-GCM + ECDH encrypted metadata envelopes, fingerprint confirmation, local-first persisted create/invite/accept/submit operations, camera binding/policy snapshots and sender automatic proposal (not automatic grant) UX.
- Real A→B→A Chromium workflow with actual encrypted assignment instructions, offline capture, signed photo grant, acceptance, successful decrypt and revocation.
- Revision transitions, historical policies for captured-at offline replay, reviewer roles, full four-tab approved assignment editor, retention/paywall and media extensions; keep these as required future work.

**No production access and no merges into main.**
