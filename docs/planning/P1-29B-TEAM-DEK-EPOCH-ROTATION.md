# P1-29B — Team DEK Epoch Rotation

**Stack:** [P1-27 #50](https://github.com/1troitsky/photobunker-v3/pull/50) → [P1-28 #51](https://github.com/1troitsky/photobunker-v3/pull/51) → [P1-29A #52](https://github.com/1troitsky/photobunker-v3/pull/52) → **[P1-29B #53](https://github.com/1troitsky/photobunker-v3/pull/53)**. All Draft until independent QA and integration; main unchanged by this work. P1-29A MUST NOT be integrated without P1-29B.

## Security contract

The immutable v1 Team root stays signed as pb3.team-create.v1. Each owner-initiated rotation creates **a fresh CSPRNG 32-byte Team DEK** (never reused after exclusion), re-encrypts the current team title and description with AES-256-GCM under AAD:

- \`pb3.team-profile-epoch.v1\n{ownerAccountId}\n{teamId}\n{toEpoch}\n{membershipRevision}\n{previousEpochHash}\`

The new Team DEK is wrapped under owner's AKEK using a distinct AES-GCM AAD:

- \`pb3.team-owner-key-epoch.v1\n{ownerAccountId}\n{teamId}\n{toEpoch}\n{membershipRevision}\`

The owner signs canonical JSON with domain \`pb3.team-key-epoch.v1\n\`, fixed fields \`version, operationId, teamId, ownerAccountId, fromEpoch, toEpoch, membershipRevision, previousEpochHash, privateEnvelope, recipients\`. The contract includes sorted, unique recipients (max 100) with \`accountId, role, recipientKeyDigest, envelope\`. Each \`envelope\` uses fresh ECDH P-256 ephemeral secret → HKDF-SHA256 AES-256-GCM. Both HKDF info and AEAD AAD are domain-separated \`pb3.team-epoch-recipient-dek.v1\n\` + canonical JSON of team/epoch/owner/recipient/role/directory digest/membership revision/previous epoch hash. Neither Team DEK nor account AKEK is stored on the server or IndexedDB in plaintext.

## Atomic server commit

The owner must have an active team in quarantine (\`rotation_required=true\`). Laravel locks the Team row and verifies **exact** \`key_epoch\`, signed \`previousEpochHash\`, current membership revision, all and only currently accepted active non-owner members, their effective roles and current exchange directory hashes, with no missing/duplicate/surplus grant. No partial grant commit: epoch record, recipient envelope grants, retirement of outstanding old pending invitations and unblocking of the new epoch happen in one PostgreSQL transaction. Wrong recipient, missing survivor, stale directory digest, changed role, stale revision or wrong domain → fail closed. Exact signed Lost ACK replay is idempotent and cannot create a second epoch.

\`GET /teams/v1/{id}/epoch/owner\` is owner-only and includes the signed current contract. \`GET .../epoch/member\` checks active recipient membership and current digest, returns the signed new contract and only their individual recipient grant; original member endpoint refuses epoch > 1. \`GET .../epoch/history\` is paginated and authorized for active members/owner, allowing verification of every signed epoch back to the original root hash. During quarantine, even accepted survivors cannot receive old Team DEKs; incoming invitation inbox provides a **minimal suspended tombstone without envelope**. Revoked recipients receive only a minimal revoked tombstone. Outstanding old pending invites are revoked atomically with rotation (they cannot safely be accepted under a new epoch). The server continues to forbid v1 invitations and accepts after epoch 1.

## Client and UX

The owner selects “Обновить ключ команды” only when \`rotation_required=true\`. A visible confirmation explains that already downloaded data cannot be retracted. Client verifies the original signed root and epoch chain; verifies owner-signed roster, independently pinned current ECDH directory for every active member, then encrypts a new root and recipient envelopes. **Before HTTP**, the same signed operation is persisted as AES-GCM ciphertext under a hashed account-scoped IndexedDB key. Lost ACK repeats the **identical** contract/signature and key material. Only an exact matching server ACK marks it synced. Conflicts are explicit; no false confirmation.

After rotation, recipients independently verify owner fingerprint, initial signed invite, entire signed epoch hash chain, current membership, recipient-scoped signed envelope and role-change receipt before decrypting the new profile and storing the authorized view locally encrypted. Signed epoch history is never a substitute for server-side live ACL. A removed member can still have previously downloaded plaintext/old DEK; no remote claim can erase that knowledge or enforce deletion while offline. No automatic file/media/assignment access follows from Teams membership.

## Known boundaries / next phase

- **P1-29C must upgrade the invitations protocol** for epoch > 1, including root/epoch binding, new recipients, re-inviting a previously removed account, and independent consent. The current UI deliberately disables new invites in a rotated team instead of reissuing a stale v1 DEK.
- Changing an accepted member's role does not automatically rotate Team DEK, because role changes alone grant no file privileges; server effective role is independently signed. Removing any member always requires a new epoch.
- The system currently supports up to 100 active recipients per atomic rotation, fails closed beyond that. Large-team/batched rotation is future work.
- Key handoff to a new owner device depends on AKEK recovery; trusted cold-offline bootstrap remains blocked by design.
- **Native iOS/Safari/Android, production migration locks, real deployment, independent cryptographic review:** NOT TESTED.
- **No main merge/deploy** by this PR. Independent agent must QA exact chain and integration before any authorized merge.

## QA and evidence

Contract tests cover unauthorized recipient/exclusion/role/digest, version/hash/revision CAS, replay, owner vs member ACL, non-destructive downgrade and no implicit file grants. Vitest tests cover AES-GCM offline outbox, no plaintext identity/DEK, signed exact Lost ACK retry. Chromium three-account flow covers A owner, B removed, C surviving: independent pinned keys, role mutation, suspension, epoch rotation, C decrypting epoch 2 and B denied new epoch. All final-HEAD CI results must be recorded in Draft PR #53 and a sanitized independent QA audit; a passing API test alone does not complete this gate.
