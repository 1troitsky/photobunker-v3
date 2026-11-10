# P2-02D1 — PB3 Recovery Key → encrypted Matrix 4S seed escrow

**Date:** 2026-11-11. **Parent:** verified P2-02C [Draft #70](https://github.com/1troitsky/photobunker-v3/pull/70) at `e2ac226583ce12a3f0a01c9d57643df523ec7e17`.
**Scope:** server-blind immutable recoverability of one **existing** 32-byte Matrix secret-storage private key (4S seed) from a PB3 account's AKEK. Not yet Matrix room-key backup or cross-signing.

## Threat boundary and data flow

1. The user's **single PB3 Recovery Key** opens the existing PB3 recovery package (P0). That package contains the account signing key and 256-bit AKEK, including on a newly enrolled PB3 device. The Matrix secret-storage seed is *never* itself a second password the user must remember.
2. Only after the PB3 device is online and has a server-confirmed Matrix device/account binding from P2-02A can the browser deliberately call `escrowMatrixSecretStorageKey(raw32)`. This accepts **only an existing Matrix SDK secret-storage key** (32 bytes). It deliberately does **not** generate or rotate Matrix cross-signing/backup keys.
3. The browser makes a fresh `keyId` (16-byte random), `operationId` (UUID), nonce (12-byte random). It derives AES-256-GCM encryption key by HKDF from the PB3 AKEK with domain-separated Matrix `ssss` scope and authenticated context including PB3 account UUID, Identity revision, trusted Matrix homeserver+MXID and keyId. It seals exactly 32 raw bytes to a 48-byte ciphertext/tag; it signs the **entire canonical envelope** with the PB3 *account signing key* (ECDSA P-256).
4. **Local-First durable intent:** before the first POST, the entire signed and sealed envelope is itself AES-GCM-encrypted to an account-scoped IndexedDB pending record (hash-indexed; no plaintext UUID/MXID/Matrix seed in row). A failed POST or lost ACK leaves the same operation for retry. Account/key revision changes fail closed.
5. Server `POST /matrix/v1/recovery/ssss` requires session, CSRF+Origin, current PB3 root account signature and current account revision, a matching existing Matrix account binding, canonical fixed fields/lengths, exactly 48 bytes ciphertext, and a transactional account row lock. It stores **only** immutable `contract_json`, `account_signature`, `contract_hash`, UUID operation and revision; never token, plaintext SSSS seed, PB3 Recovery Key or AKEK. Identical retries are idempotent; differing payloads or cross-account reuse conflict.
6. After write, browser independently GETs `/matrix/v1/recovery/ssss` and compares exact signed bytes. Only that explicit receipt permits deletion of its encrypted pending intent.
7. On a **different PB3 device**, the same PB3 Recovery Key provides the same account package/akek; `recoverMatrixSecretStorageKey()` checks authenticated server response, verifies the root signature against the current PB3 account signing key, validates immutable binding/identity revision, derives the same HKDF key and decrypts the seed locally. Caller must zero the returned raw buffer after handing it to Matrix SDK's `CryptoCallbacks.getSecretStorageKey` / 4S flow.

## Important limits / fail-closed behavior

- This is an **escrow transport**, not `bootstrapSecretStorage()`, `bootstrapCrossSigning()`, key backup activation, `m.megolm_backup.v1` restore, trust verification, logout/revoke or proof that the key matches the current Matrix SSSS key. There is deliberately **no misleading “Recovery complete” UI**.
- Do not call `escrowMatrixSecretStorageKey` until the actual Matrix SDK SSSS key exists and is validated. Integration must verify Matrix 4S key ID against the Matrix server's public secret-storage key metadata, and establish/cross-sign new devices securely. No independent Matrix backup password should be required of users.
- Once stored, escrow v1 is **immutable**; it forbids overwrites/rotations without an audited versioned recovery migration. Key mismatch, current PB3 Identity revision change, restored AKEK mismatch and server binding changes deny access. The future audited rotate/rewrap must take place before changing PB3 keys when possible; an irrecoverable old key may require a new Matrix 4S backup with explicit owner consent.
- Matrix backup seed is *not* exported or logged server-side. DB rollback refuses to drop live escrow. Encrypted seed is private to the owner (new device authenticated via Recovery Key), **not** shared with contacts or team roles.
- This architecture does not solve a compromised same-origin JS bundle, server compromise causing rollback, physical Safari/device API differences, or remote Matrix token invalidation.

## Verification gates

PHP: 2 independent PB3 accounts, signed owner-only stored envelope, exact replay, wrong signature, wrong MXID, ciphertext length, immutable conflict, new registered PB3 device reading encrypted envelope, revision/revoked device denial, non-destructive migration.

Frontend: actual 32-byte seed sealed/unsealed on a new PB3 device with the *same* recovered account package; stored API and IndexedDB contain no raw seed, AKEK or Matrix token; Lost-ACK replay is identical; wrong account/key revision/signature/ciphertext fails closed.

Full existing PostgreSQL 18/Garage 2.5/Chromium and disposable actual Synapse + RustCrypto two-user E2EE integration must remain green at exact HEAD.

**NOT CLAIMED:** working account provisioning from a single PB3 key, Matrix cross-signing/verified recipient devices, real 4S bootstrap/recovery/room-key restore. These remain P2-02D2+ gates. User Send stays disabled. No merge/deploy.
