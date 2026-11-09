# P1-04 — owner-signed assignment finish/resume

**Status:** incremental P1 feature in **Draft PR #14**, stacked on Draft PR #12. No production access, no merge; CI and device verification remain safety gates.

## What is permitted

An assignment has an **immutable original** owner-root-signed policy from P1-04. This change adds two explicit, separate, owner-root-signed, optimistic revision-controlled operations:

- `finish` transitions `active -> finished`, revision `N -> N+1`.
- `resume` transitions `finished -> active`, revision `N -> N+1`, only if the hard configured `endsAt` has not passed.

The signed command binds `assignmentId`, `ownerAccountId`, `policyRevision`, SHA-256 of original signed policy JSON, previous/new revision, action, next state, and immutable operation UUID. Server locks the assignment row before verifying revision, state, owner, signature and replay. Idempotent retries of the same command do not create another state event. Each accepted transition is retained in `assignment_state_events_v1`. A distinct operation with stale revision is a conflict.

The owner and accepted participants obtain the **latest owner-signed state** in their authorized listing and verify it against an independently pinned owner account SPKI (or the owner's own account key). The latest signed command authenticates the displayed current state; the append-only event table retains all server-side history. Full client-verifiable historical chain/proofs and policy-edit revisions are a **separate future feature**.

## Data safety and access

- Finishing does **not** delete contributor-owned photos, queued ciphertext, original encrypted assignment metadata, accepted invitation key envelopes, existing grants, or audit history.
- Finishing prevents new invitations/consent, new version-2 assignment photo reservations and assignment submissions. Active photos/grants already shared remain subject to their own ACL and TTL, not silently revoked by the assignment state.
- Offline devices retain ciphertext and previously verified signed state snapshots, but the server is authoritative. An offline photograph captured against a stale active policy may be refused on subsequent reservation. Refusal must never delete its local encrypted copy.
- Signed state operations are placed in the durable local outbox; `409` revision/state mismatch is a permanent conflict, **not** a silent retry loop. A later manual reconciliation with server is required.

## Verification / remaining gaps

- Feature tests: owner signed lifecycle, idempotent replay, revision conflicts, unauthorized signer, corrupt signature, expired deadline, unchanged accepted envelope and preserved data.
- WebCrypto unit tests: independently validate latest state signature/hash and reject a server-edited state/revision or an unsigned state transition.
- E2E: A→B→A encrypted photo, owner finishes, B loses camera capture option, previously submitted photo stays readable, owner resumes, B regains capture option.
- Remaining: full Fieldwork 5.0 finish/archive/delete confirmation flows; multi-revision capture policy edit/history and device-clock attestations; owner-curator roles, notification events and real-device/iOS Safari acceptance.

This is a **lifecycle permission** state, not physical deletion, global revocation or an asserted production feature.
