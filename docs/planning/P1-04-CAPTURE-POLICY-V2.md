# P1-04 — signed assignment capture policy v2 (incremental vertical)

Status: **CODED IN DRAFT / CI & REAL DEVICE VALIDATION PENDING**. This change is stacked on the unchanged P1-04 branch. It does not imply completed P1/Fieldwork scope.

## Protocol

- Personal camera captures continue with signed photo contract **v1** and remain usable as personal photos.
- An assignment camera selection requires a previously server-authorized listing whose original owner-root-signed creation contract is verified against the owner's **independently pinned** account SPKI (or the local account's SPKI).
- Only verified policy snapshots are cached per account in IndexedDB. The cache contains signed public policy and encrypted private envelope, **not** plaintext instructions, an assignment DEK or a recovery secret. Capture must be within the policy's local effective interval.
- Offline camera captures use the cached verified snapshot. The photo stays contributor-owned. Encrypted metadata includes a copy of the capture binding and the encrypted photo outbox stores a small public identifier/revision/hash binding.
- The eventual device-signed photo contract **v2** contains `capture = {assignmentId, ownerAccountId, policyRevision, policyHash, capturedAt}` (SHA-256 over the exact owner-signed creation policy JSON), in addition to the normal encrypted asset manifests.
- During `/photos/v1/reserve`, Laravel verifies the device-signed canonical contract, hash against stored owner policy, assignment state, policy revision, effective capture time, owner/contributor role and accepted membership **before** reserving storage. Personal v1 is unchanged.
- During assignment submission, a v2 photo cannot be rebound into a different assignment or policy. Explicit per-photo grant to the creator is **still required**. Personal v1 photos remain explicitly attachable with a grant for the existing P1 workflow.
- The client and server do not trust cached membership for authorization. Offline capture is local only until server ACK; subsequent revoked access, expired effective time, or changed policy can lead to a clear upload conflict while ciphertext remains recoverable locally.

## Explicit limits and next gates

1. `capturedAt` is a **device-signed client-clock claim**, not a tamper-proof trusted timestamp; the backend bounds clock skew and age and rechecks authorization. A malicious enrolled device can lie about time. Historical server-signed policy snapshots and clock attestation need separate design.
2. Current assignment schema only permits immutable policy revision 1, photo-only capture, active/accepted membership. Future policy revisions, effective-time transitions, review and curator rights must preserve immutable historical policy and revoked-access semantics.
3. Ended/revoked assignment policies can be locally cached, but subsequent server reservations are refused; rejecting server-side does not delete an unsynchronized encrypted local photograph. Offline acceptance without a prior server ACK is not treated as active membership.
4. The P1 camera selector is a functional vertical, **not** the approved Camera 1.2 / Assignments 5.0 / Editor 2.2 UX. Full controls, private name display, GPS, category, description, media types and revised capture rules remain mandatory.
5. No hardware phone/iOS Safari validation, independent security audit, production cleanup, migration to main or P2 activation is implied.

## Verification scope added

- PHPUnit positive signed v2 reserve and idempotent replay, wrong policy hash, wrong owner, future timestamp, revision mismatch, inactive assignment, nonmember refusal, and cross-assignment submission rejection.
- Vitest contract regression for personal v1 versus scoped v2.
- Chromium E2E now selects the authenticated assignment **before** going offline, checks the v2 binding in local ciphertext outbox metadata, then uploads, grants and submits.

All verifications must be **run** and passed on the latest commit before declaring the code integrated. The parallel local agent's external acceptance report is independent of this Draft PR.
