# P2 V-24 — owner-signed Fieldwork participant removal

**Status:** Draft, code written; exact-head CI not yet verified. Combined with closely coupled P1/P2 membership ACL alignment in Draft #119 (ancestry #118→#117→#116→#115→#114→#113→#111). No `main` merge, deployment, Matrix, guest Public Card, DEK transport changes or physical GC.

## Problem

Signed invited/accepted contributor membership was already required to upload assignment photos and media, but Fieldwork lacked an explicit owner-side **remove participant / cancel invitation** operation. Existing grant-read validators from V-22/V-23 did not yet have a real, authenticated membership transition to exercise. A server-only state flip would be insufficient: the recipient and independent devices must be able to prove that a removal was authorized by the owner, and retries must not turn a revoked member back into a participant.

## Signed consent protocol

1. Owner signs exact canonical P-256 ECDSA domain `pb3.assignment-member-remove.v1\n` and a v1 contract: `version, action='remove', operationId, assignmentId, inviteId, ownerAccountId, recipientAccountId` (no private instructions, key material, GPS or media content).
2. Owner-only authenticated endpoint `POST /assignments/v1/:assignmentId/invites/:inviteId/remove` validates the signature and all scope fields, locks assignment and invitation, accepts existing `pending`/ `accepted` membership, persists an immutable revocation event (new `assignment_member_removals_v1` table), and sets the invitation to `removed` atomically.
3. One exact replay with the original signed command returns `unchanged=true` even after assignment completion or retention cutoff. Different operation IDs, tampered contracts, non-owner requests and re-accept attempts are rejected; a replay cannot grant access.
4. The owner-only roster preserves the immutable original signed invitation and appends `removalContract` plus `removalSignature`. The owner client independently verifies the removal against its known original owner P-256 SPKI before showing **«Исключён владельцем»**. A plain server-provided `removed` flag without matching cryptographic proof is rejected.
5. Local-first: the owner Fieldwork editor includes an explicit **«Исключить»** control with confirmation wording about irreversible membership removal. The command is signed and durably queued offline; its UI never claims successful server removal before a `sent` ACK. Online it refreshes only the verified authoritative roster.
6. The removal immediately closes any still-live assignment-scoped P1 photo and P2 media grants through accepted-membership ACL; owner confirmed photo/video/audio counts and P1/P2 receipt lists also stop including removed contributors. Contributor-owned originals and **independent personal v1 E2EE recipient grants** remain intact.
7. Rollback of the removal evidence migration is forbidden after actual removal records exist. No bulk data wipe, S3 key deletion, social/team side effect or automatic rekey is claimed.

## Explicit limitations

- **Re-inviting a removed recipient to the same assignment is not implemented in V-24.** The existing unique invite-per-recipient rule prevents silent re-acceptance; a future signed re-invitation lifecycle needs explicit separately reviewed versioned consent and history semantics. UI warns before confirming removal.
- Existing client-side access to **already decrypted or offline cached plaintext** cannot be retrospectively erased by a server ACL. Future access to server-provided ciphertext is denied; automatic remote cache wipe and re-encryption are not implied.
- A signed removal is not an invitation to publish original contributor media. Existing imported-photo provenance remains account-signed consent, not camera/GPS hardware evidence.

## Required checks

- PHP tests: owner-only signature scope, cancel pending, revoke accepted, immutable signed event, replay after finished assignment, reject alternate operation, reject old acceptance, hide recipient inbox/list.
- Vitest: original signed invitation plus signed removal accepts only exact P-256 owner proof; forged flags, extra fields or misbound recipient/invite fail closed.
- Chromium E2E: real A/B identity, independently confirmed contact, invitation/acceptance, explicit owner removal in participants editor, independently verified removed roster and recipient server-list denial.
- Exact-head CI must pass PHP 8.4.27+/8.5.12+, PG18/Garage+Chromium, TS/Vitest/build and security. Native Safari/iOS/Android and owner acceptance **NOT TESTED**.
