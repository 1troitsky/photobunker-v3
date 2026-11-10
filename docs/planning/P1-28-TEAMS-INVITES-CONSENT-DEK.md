# P1-28 — Signed Teams invitations, consent and E2EE Team DEK

**Base:** Draft PR #50 @ `157909c9b414f7d4ea8591b683b69913946a42c3`. **Delivery:** stacked Draft PR #51; not merged or deployed.

## Protocol and trust

The inviter MUST select a previously independently fingerprint-confirmed Contact, not just a directory result. The immutable owner Team DEK is unwrapped from the signed team root only transiently, and re-wrapped using recipient-specific ECDH P-256 + HKDF SHA-256 + AES-256-GCM. The HKDF info and AEAD AAD are domain-separated as `pb3.team-recipient-dek.v1` and include exact teamId, inviteId, owner/recipient account IDs, role, recipientKeyDigest, immutable teamContractHash, expiry and fileAccess none. No account AKEK or plaintext profile is sent to the server.

The owner signs canonical `pb3.team-invite.v1` JSON. Server validates exact signed shape, immutable Team root hash, current recipient exchange key digest, roles curator/contributor/viewer, maximum seven-day invitation lifetime, and explicitly requires fileAccess none. One outstanding or accepted invitation per team/recipient in v1; role changes/re-issue require new versioned contracts.

Recipient inbox is only visible to authenticated recipient and returns signed invitation with owner public key. Browser cryptographically verifies it, but explicitly flags independently unconfirmed owners and DISABLES Accept until the owner fingerprint is pinned. The recipient independently verifies the DEK envelope, then signs canonical `pb3.team-accept.v1` JSON including the invite contract hash, teamId, inviteId, recipientAccountId and unique operationId.

Server stores signed receipt and creates an authoritative team membership transactionally **only** after authenticated consent and expiry/key checks. Replaying exact signed operation after a lost ACK is idempotent, mismatched operation ID/signature is rejected. A team role NEVER grants automatic file, assignment, Matrix or media E2EE access. All future grants remain separate, explicit and scope-bound.

Once accepted, member requests GET `/teams/v1/{teamId}/member`, which is denied unless an actual active membership and accepted invitation exist. Client validates the owner root signature, teamContractHash, signed invitation, current pinned identity and recipient's own exchange key before decrypting the Team DEK and team profile. A previously decrypted copy cannot be remotely retracted.

## Local-First behavior

Signed owner invites and recipient acceptances are stored as AES-GCM ciphertext in `pb3-encrypted-team-members-v1`; no plaintext team title, account IDs, role or signed contract in IndexedDB index keys. Network errors preserve exact signed bytes for retry; a 409 is kept as conflict, not false success. Offline accepted team list is an encrypted cached view and explicitly NOT presented as current authoritative access. Identity/device/key changes fail closed across async steps.

## User journey

Single «Контакты и Команды» page. Owner selects a synchronized team, confirmed Contact and role, sees server-verified pending/accepted roster; recipient sees received signed invite and role, confirms owner fingerprint through Contacts, signs acceptance and decrypts joined team profile after the server ACK. Roles Curator/Contributor/Viewer are initially membership-only, with zero implicit media grants.

## Current limits and next steps

- Team key/role revocation, Blacklist, key rotation after member exclusion, role updates, file scopes and re-inviting an existing recipient remain NOT IMPLEMENTED; all require a separate security-reviewed contract. Do not expose a fake Revoke button.
- Real native Safari/iOS/Android, trusted cold-offline bootstrap, production migration locks and production deployment remain NOT TESTED.
- Preserve signed invitation/consent history during downgrade; the new migration refuses dropping a nonempty team invitation table.

## Evidence

PHP 8.4/8.5: owner/recipient ACL, signed invite/accept, replay, expiry, wrong team root/directory, wrong signer/domain, no phantom grants, protected downgrade; frontend TS/Build and Chromium two-account E2E verify independently pinned A↔B keys, member DEK read and offline encrypted cache. Current test and CI evidence belongs to the exact Draft PR head, not the older base. Final green CI and independent local-agent audit required before agent merges.
