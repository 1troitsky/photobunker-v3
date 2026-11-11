# P2 Matrix — Recovery Key rotation / append-only Matrix 4S escrow epochs

**Date:** 2026-11-11. **Evidence:** [independent audit PR #77](https://github.com/1troitsky/photobunker-v3/pull/77) @ `33d5c7fb8df55ccd86a3b5749a4476e9f1cf976e`; baseline product [Draft #75](https://github.com/1troitsky/photobunker-v3/pull/75) @ `e39b619dc9ec36eefc9ac322367e2d4348a1508e`. This product Draft is stacked after the narrow Vite fix PR #78. Neither PR is merged or deployed.

## Root cause / scope

The signed PB3 Recovery Key rotation changes `identity_accounts.revision` and keeps the underlying PB3 account AKEK + signing root unchanged in the **independently reproduced case**. The original `matrix_recovery_escrows_v1` contains a single immutable (accountId PRIMARY KEY) AKEK-encrypted 4S seed bound to an earlier revision; `GET /matrix/v1/recovery/ssss` correctly returns HTTP 409 after rotate, and `POST` a freshly signed newer envelope also returns HTTP 409 because replacement was forbidden. Never solve this by weakening the revision check or overwriting the only ciphertext.

## Versioned transition

1. Leave the **entire legacy v1 table unchanged**, preserving original signed ciphertext and rollback guard. Add `matrix_recovery_escrow_revisions_v2`: an **append-only** `(account_id,account_revision)` unique lineage with exact signed contract, operationId, hash, and `parent_contract_hash`. A populated v2 table refuses routine rollback.
2. `GET /matrix/v1/recovery/ssss` still **refuses stale revisions** with HTTP 409. Only `GET /matrix/v1/recovery/ssss/previous` may return the **highest historical signed encrypted envelope** to an authenticated PB3 account with a newer revision and matching operator Matrix binding. It is explicitly not a current recovery receipt.
3. The client validates the **previous contract's original PB3 account-root signature** (v1 or v2) and matching Matrix account; it must actually authenticate and decrypt prior AES-256-GCM ciphertext using **the current AKEK with the signed previous revision as associated data**. A changed AKEK or PB3 signing root fails closed and does not modify stored data.
4. The client derives a **fresh domain-separated v2 AES-GCM envelope** for the *same* 32-byte Matrix 4S seed at its current revision, includes `previousContractHash = SHA256(previous canonical contract)`, signs with the PB3 root and persists the complete signed v2 operation in AES-GCM-protected local IndexedDB **before POST**. No Matrix device bearer token or Matrix login is required for Recovery-Key-only new-device rewrap; account-authenticated PB3 owner session is required.
5. The server locks the current PB3 `identity_accounts` row before any write, re-verifies revision + signer, and requires an exact parent hash for the latest historical v1/v2 record and **strictly increasing revision**; alternate same-revision content/forks, unsigned payload, foreign owner and rollback are forbidden. New payload only appends an immutable row. POST retry of the **exact signed content** is idempotent.
6. The client must independently read back the exact current signed server receipt to promote/clear its pending row. Lost HTTP ACK leaves encrypted pending intent for retry. Successful rewrap enables normal new-device `recoverMatrixSecretStorageKey()` only after verified v2 GET and local decryption.

## Security boundaries / not proven

- **Does not handle root/akek-replacement rotation:** if the authenticated PB3 package's AKEK or signing root differs from the prior signed version, the previous escrow cannot be trusted/decrypted with the current material. **Fail closed; old ciphertext remains**. A separate authenticated pre-rotation handoff or owner-approved multi-key recovery contract is needed.
- This does NOT create Matrix accounts, new Matrix device token, cross-user SAS/QR trust, E2EE message send, revoked device/Panic logout or remote key erasure. Do not enable UI Send.
- A PB3 session with current Recovery Key can obtain the **previous encrypted** envelope for rewrap; only authenticated account-owner endpoints can serve it. Servers never see the 4S seed or AKEK.
- Server-side parent hashes constrain the append chain but are **not a substitute for independent post-recovery proof of Matrix secret-storage 4S MAC**. The already implemented `getVerifiedPB3Matrix4SKey` performs the SDK 4S key-ID/MAC check; integration with real new-device Matrix historical decrypt remains a separate acceptance gate.
- Changes are production code + regression tests, **not** an independently re-run two-browser PB3 signed rotate acceptance. That independent scenario must be repeated on the exact new Draft HEAD. Native Safari/PWA and concurrent remote Matrix membership are not tested here.

## Target verification

- PHPUnit: v1→v2→v3 monotonicity, identical Lost ACK replay, malformed/new-parent/fork/cross-owner/revoked-device, unchanged v1 row and populated-v2 rollback denial.
- Vitest: true WebCrypto decryption/re-encryption across revision increments with SAME account root/AKEK, fresh device without Matrix token, sealed pending retry after ACK loss, wrong AKEK/forged prior signed contract refusal.
- Full CI: TypeScript/Vue build, PHP 8.4/8.5, PostgreSQL18/Garage, Chromium and both real disposable Synapse jobs PASS on exact HEAD.
- **Independent agent** replays signed PB3 Recovery Key rotation (not SQL revision modification), confirms rev2 201/200 and historical rev1 bytes retained, checks original 4S MAC on the new browser and reports sanitized evidence. No `main`, merge/deploy or production secrets.

**Do not merge** while the independent audit's M-01 real user-to-user Matrix verification and M-03 remote revoke/Panic contracts remain blocked.
