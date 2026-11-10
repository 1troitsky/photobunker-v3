# ADR-0002 — P1-03 authenticated recipient key envelopes

**Status:** IMPLEMENTATION CANDIDATE / not audited or production enabled.
**Source:** \`ts.md\` P1 key grants + issue #8. Never copy PB2's unfinished inter-account photo key sharing.

## Identity and encryption trust

- Account signing root is the existing immutable P-256 \`identity_accounts.account_spki\`. It is in the Recovery Key protected account package; no Recovery Key or raw AKEK is transferred.
- A **separate P-256 ECDH exchange key** is generated once per account. The account signer signs \`pb3.recipient-key.v1\n<canonical descriptor>\`, including \`version=1\`, account UUID, exchange SPKI and SHA-256 of the AES-GCM sealed private key envelope.
- The ECDH private key is stored **only as an AES-256-GCM envelope encrypted by the local account AKEK**. Backend stores public key, account signature and ciphertext envelope only. A trusted new device unwraps from its recovered account package.
- The directory is authenticated against the account signing key, but **first-contact account-key authenticity still needs an independent trusted fingerprint**. A compromised server could substitute an entirely new account record on first contact. Client must display a safety fingerprint for manual out-of-band comparison and pin it in indexed storage; silent first-contact trust is prohibited. No user-facing claim of absolute verification.
- Existing signed identity and media domain labels are immutable compatibility wire strings; brand may change without re-signing historic objects.

## Grants

Owner signs \`pb3.photo-grant.v1\n<canonical grant contract>\` using their account ECDSA key. Version 1 contract includes immutable grant UUID, owner/recipient account UUIDs, photo UUID, exchange directory SHA-256 digest, expiry (at most underlying photo TTL), and one envelope for every stored personal asset (\`master\` and \`metadata\`).

For each asset, owner unwraps the DEK locally, generates a fresh ephemeral P-256 ECDH key, derives a 256-bit AES-GCM wrapping key using HKDF-SHA256 with 16-byte random salt and scope-bound info (owner, recipient, grant, asset, photo, expiry), and encrypts just the 32-byte DEK with a fresh 12-byte IV and scope-bound AEAD associated data. Ephemeral SPKI, salt, IV and ciphertext (+16-byte tag) are transmitted; no raw DEK, private ECDH key, plaintext media or recovery key leaves the client.

Backend verifies account signing signature and all exact schema fields. It validates photo ownership, signed asset set, recipient key directory digest, recipient account readiness, immutable grant UUID/idempotence, state, photo TTL and grant TTL. Recipient API checks \`current account == recipient\`, unrevoked grant and unexpired underlying photo on **every** read of metadata and encrypted asset. Sender retains original ownership. No browser-supplied S3 paths.

Recipient verifies signed owner grant using independently pinned owner identity SPKI, and unwraps DEK with their AKEK-protected exchange key; decrypts the original ciphertext locally. A grant is not automatically public, nor can it extend media TTL. Owner revokes via signed \`pb3.photo-revoke.v1\n<canonical revoke command>\`, which immediately denies future server reads.

## Security bounds and OPEN items

- **No cryptographic recall of already downloaded ciphertext/DEKs**: revocation blocks future API reads, not data already decrypted/cached by a recipient.
- Manual safety number comparison requires an out-of-band trusted channel; do not auto-confirm or claim server directory is an independently trusted PKI.
- Pending grant outbox stores signed ciphertext envelopes only, never raw DEKs, plaintext files or AKEK. Grant send failures remain retryable.
- Initial scope: account-to-account read grants only. No team/assignment inheritance, editing, thumbnails-only downgrade, public URLs, arbitrary user-created Matrix rooms or server key escrow.
- Account key rotation, distributed trust-root, safety fingerprint UX in approved Fieldwork, audit logging, transparent key change detection and revocation after offline caching must be reviewed before release.
