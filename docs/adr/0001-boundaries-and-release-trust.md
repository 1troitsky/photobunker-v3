# ADR-0001 — modular boundaries and signed-release trust (P0)

**Status:** PROPOSED (implementation constraints accepted by specification; cryptographic design not yet verified).

- Backend, E2EE client, StorageManager, Matrix adapter, Recovery Vault, Billing, Admin and PWA release verifier are separate modules; no provider-specific S3 calls from business controllers.
- The account Recovery Key does **not** become a Matrix identity private key. Use dedicated, versioned account/device/media/message keys and explicit envelopes.
- A file's logical identity remains stable across App S3, user-owned S3 and replica S3. Placement and deletion are lifecycle-recorded, idempotent operations.
- A SHA-256 manifest downloaded with executable code from the same potentially compromised origin is *not* independent verification.
- The proposed release model uses a canonical manifest, Ed25519 signature created by a release signing key isolated from hosting, pinned verifier public key via an independent trusted distribution channel, cache quarantine and last-known-good rollback.
- Before declaring Self-Auditing PWA independently trustworthy, define the bootstrap anchor (installed trusted app, extension, separately downloaded verifier, or comparable out-of-band method), downgrade protection, and compromised signer recovery. Remains `OPEN`.
- IPFS is not designed or included in this version.

**No keys, sample private secrets, or fabricated integrity-success UI belong in this foundation.**
