# P1-19 — Signed, append-only E2EE assignment title/instruction revisions

**Status: Draft / CI pending.** Branch stacked on [P1-18 Draft PR #36](https://github.com/1troitsky/photobunker-v3/pull/36) exact head `4bb56771910fac9e95b84aa6f8529528a9dfbbfe`. Never change or merge `main` or deploy.

## Goal / proven security boundary

Fieldwork Editor 2.2 **Основное** now edits name and instructions in a real independent end-to-end encrypted, **versioned** operation. The immutable root creation record and existing account-signed root policy MUST NEVER be changed. The owner uses the **same existing assignment content DEK** and a fresh random 96-bit AES-GCM nonce to encrypt an exact `{version:1,title,instructions}` plaintext; only the new sealed envelope goes into signed event transport. Retaining the DEK allows **already accepted ECDH invitations** to decrypt the new revision with their original issued recipient key. This is deliberate continuity, NOT forward secrecy or revocation.

Backend never receives or persists plaintext titles, instructions, keys, GPS or filenames. All policy fields, photo/audio/video E2EE grants, server ACLs and original signed capture history remain unchanged.

## Protocol

- Immutable creation v1 `privateEnvelope` is the root of trust, remains root-signed and unchanged in `assignment_records_v1.private_envelope_json`.
- Private edit domain: `pb3.assignment-private.v2\n`, signed by the OWNER ACCOUNT private key, exact fields in canonical order: `version=2`, `operationId`, `assignmentId`, `ownerAccountId`, `rootPrivateHash=SHA256(JSON.stringify(rootEnvelope))`, `previousPrivateHash=SHA256(previous signed private amendment contract or canonical rootEnvelope JSON)`, `fromPrivateRevision`, `toPrivateRevision=from+1`, `privateEnvelope`.
- `privateEnvelope` remains v1 but gets a fresh `iv` and new AEAD `ciphertext`; `wrappedKey` MUST equal the immutable root `wrappedKey` exactly. Clients sign actual ciphertext, not a title. Server validates owner signature, envelope schema, encrypted byte ceiling, root and parent hashes, CAS monotonic revision, accepted state, signed nonce unique among ALL revisions plus root, and lost-ACK idempotence. No-op plaintext validation is client-side only (server cannot see content).
- New durable `assignment_private_events_v1` contains signed ciphertext contract, signature, revision, hash, IV uniqueness and receipt instant; root table gains `private_revision` and latest signed event ONLY. No root envelope migration or changes to historical invitation envelopes.
- Protected routes: POST `/assignments/v1/:id/private`; GET `/assignments/v1/:id/private-history` accessible only to owner or **accepted** participant, never pending invitee. The normal assignment list returns latest `privateRevision`, `privateAmendmentContract`, `privateAmendmentSignature` plus immutable `privateEnvelope`.
- Client verifies independently pinned account signing key and original immutable root, exact version/field shape, latest owner signature and parent, **complete signed append-only history** for fresh online listings, nonce uniqueness, monotonic cached revision and equivocation. Offline reads only a previously verified cached snapshot; replaying older signed content cannot override a newer cached revision.
- Editor saves private edits explicitly alongside any independent signed v6 capture-policy edit. Both operations are queued durably as ciphertext only. Online freshness checks BOTH policy and private revisions before signing. A partial two-operation failure must surface pending/conflict, not claim atomic server success.
- Owner sees the current version by unwrapping original DEK through owner AKEK and decrypting current envelope. Already accepted contributor uses previously ECDH-wrapped DEK + verified effective envelope. Local encrypted offline summary cache is scoped by *private amendment contract* when present; a revision change invalidates an obsolete summary. No plaintext IndexedDB names; in-memory UI only.
- **No silent overwrite** after account/session switch, stale server view or new private revision. Owner changes bind to the exact cached independently signed record.

## Security limitations

- Invited recipients who previously obtained the DEK can potentially decrypt future title revisions while they still obtain ciphertext; **revocation/rekeying, forward secrecy, and per-revision audience changes are not part of P1-19** and require a separate access/key epoch protocol. They do not gain other media grants: assignment invitation does NOT grant photo/video/audio access.
- Encryption/owner signature do not attest the veracity of user-supplied instructions; zero-knowledge server cannot detect semantic no-op.
- Some legacy text may remain in a participant's authorized previous device/cache until TTL or explicit cleanup, even after title change. No claim that overwriting encrypted content erases former local plaintext already read.
- Physical Safari/iOS/Android testing and production deploy are not included. Cold offline PWA bootstrap remains blocked by design; warm verified offline cache is supported.

## Verification checklist

- PHPUnit: root immutable; owner signed edit; idempotent lost-ACK; CAS rejection of stale edits; IV unique across root and **all** previous events; wrappedKey cannot change; invalid canonical shape/signature; unauthorized member cannot read private revision history until accepted; accepted member can read signed ciphertext event. Existing policy, state, media receipts, quotas unaffected.
- Vitest: owner encrypts new title with same DEK and unique IV; existing recipient invite decrypts it; rotated-key attempt or wrong AAD fails; exact signed version/private-history tampering rejected; private cache remains AEAD-only.
- PostgreSQL 18/Garage 2.5/Chromium: full two-account photo/audio/video journey plus **two real private title/instruction amendments after invitation was accepted**; recipient sees new text on each refresh with original ECDH invite, and can open verified encrypted local summary offline; signatures, exact revisions and absence of plaintext in server contract asserted.
- PHP 8.4 / 8.5; TypeScript production build; security CI.

## Follow-up

The remaining approved Fieldwork Editor 2.2 features needing real versioned contracts include schedule/deletion/retention, independent roles and scopes, teams, permitted imports/NAME-ID, and Public Card ceilings. P1-19 does not turn these into cosmetic toggles.
