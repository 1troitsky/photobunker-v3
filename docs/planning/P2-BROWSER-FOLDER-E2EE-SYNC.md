# P2 Browser — E2EE account folder sync, protocol v1

**Status:** code in Draft PR #86, stacked on #85. Not owner accepted or release-ready.
**Source:** `ts.md` §§4, 5, 10, 12, 23, 26; `AGENTS.md`.

## Scope and privacy

`folders/v1/snapshot` is **organizational metadata**, never physical asset placement.
Server stores one encrypted snapshot and an append-only signed operation ledger per
account. A plaintext folder name, parent, file ID, tag, GPS, plaintext index or
Recovery Key must never leave the client. A folder move must not alter S3 keys,
file owners, authorized sharing grants, media TTL, assignment constraints or GC.

Local writes remain encrypted immediately using the device's nonextractable
`encryptionKey` in the existing IndexedDB database
`pb3-browser-device-folders-v1`. The schema migration v1→v2 preserves all
existing ciphertext and adds a small **opaque** sync cursor / signed outbox.

## Cryptographic separation

For every new **account** revision, generate a fresh random 256-bit DEK and a
random AES-GCM IV, then seal the UTF-8 JSON workspace with AAD
(`domain,accountId,toRevision,purpose=workspace`). Wrap that DEK with the
account AKEK (only for key wrapping) using a separate IV and AAD
(`domain,accountId,keyRevision,purpose=dek`). The AKEK does **not** directly
encrypt folder JSON. Clear byte buffers after use; transport carries only
base64url ciphertext, wrapped key and authenticated version metadata.

The account P-256 signing key signs
`pb3.browser-folders.v1\\n<canonical contract>`.
The server verifies that signature against `identity_accounts.account_spki`,
requires an authenticated non-revoked device, checks `writerDeviceId` and
the account ID, then serializes writes by locking the account row. Other
devices independently restored from the same Recovery Key verify with the
account public key and decrypt using their recovered account AKEK. No Matrix
dependency or server-held content key is introduced.

### Transport contract

```text
GET  /folders/v1/snapshot
  => revision (0 if absent), contract (opaque signed JSON), signature
POST /folders/v1/snapshot
  <= {contract,signature}
     Signed contract:
     version=1, accountId, writerDeviceId, operationId,
     fromRevision, toRevision=fromRevision+1, keyRevision,
     envelope={version=1,iv,ciphertext,wrappedKey:{iv,ciphertext}}
  => revision, unchanged
```

The server enforces strict fields, canonical JSON, bounded ciphertext,
account-scoped revision CAS and an operation-ID ledger. A byte-identical
replay after a lost ACK returns the original revision even if a newer
revision has already been committed by another device. A **different**
operation at an old base gets HTTP 409. Requests using another device's
binding are not accepted.

## Conflict and offline behavior

1. Local writes commit immediately to device-encrypted IndexedDB.
2. Before any POST, persist the signed opaque operation in the local
   sync table, including the exact source local revision.
3. Network failure or unknown ACK leaves that operation for unchanged retry.
4. A server ACK updates the local base revision, but **never** erases more
   recent local edits. If a second local edit arrived meanwhile, it remains
   dirty until a subsequent operation is confirmed.
5. If the server revision advances while local state is dirty, return
   `conflict` without modifying either snapshot. No last-writer-wins,
   unsafe automatic merge, or hidden reset.
6. Only when local revision exactly matches its last confirmed revision may
   a separately signed, verified and AEAD-decrypted newer server state replace
   it. Installation is an atomic IndexedDB compare-and-swap.
7. If the server revision goes **backwards** relative to the locally pinned
   revision, fail with `browser.sync_remote_rollback`.

The initial UX exposes a manual sync action with authoritative
uploaded/downloaded/conflict/offline statuses. Work on background automatic
reconnect and explicit conflict resolution remains separate.

## Explicit security limitations and future gates

- A newly restored device has no independent pinned revision and **cannot
  prove a malicious server has never served an older valid signed snapshot**.
  A separate monotonic transparency / independent trust-anchor protocol is
  required before making a universal anti-rollback guarantee.
- If an account key rotation changes the AKEK, an older wrapped folder DEK
  can become unavailable; the client **fails closed** and must not replace
  or erase either local/remote ciphertext. A signed versioned rewrap/escrow
  path with independent Recovery Key rotation acceptance is still needed.
- This is **not** a folder ACL or authorization mechanism for media:
  all media read/write still checks the original backend permissions.
- Do not classify the feature as owner accepted before real two-device
  registration/recovery, signed exchange, offline conflict and Lost ACK
  E2E checks, plus the independent native browser review.
- The archive and permanent deletion remain **disabled** until approved
  retention, tombstone and verified multi-location GC contracts are built.
