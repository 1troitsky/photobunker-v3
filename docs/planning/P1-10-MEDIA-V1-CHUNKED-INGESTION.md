# P1-10 — MediaFile/v1 encrypted chunk ingestion (Draft)

**Base:** [P1-09 PR #26](https://github.com/1troitsky/photobunker-v3/pull/26)
@ `e1e8d08d287271db760fbc0acb7159527520b953`.
Independent local QA [PR #27](https://github.com/1troitsky/photobunker-v3/pull/27)
passed exact PR24 SHA. Product branches, QA branch and `main` remain separate.

## Vertical delivered

User selects one photo/video/audio file explicitly in the existing Browser,
including while the already-loaded SPA is offline. The file is split into
**1 MiB plaintext chunks**, independently encrypted on the device with
AES-256-GCM, random 96-bit nonce and immutable AAD binding:
accountId, mediaId, mediaType, expiresAt, totalPlainBytes, chunkBytes,
totalChunks, index, kind and current chunk plaintext length.

The whole media uses an **independent random 256-bit DEK**, wrapped locally by
the account AKEK using the accepted PB2/PB3 key hierarchy. The canonical
`pb3.media.v1\n` signed device contract includes only opaque IDs, a coarse
mediaType, byte counts, chunk indices, SHA-256 ciphertext hashes, IVs, wrapped
DEK and expiration. Original filename and MIME are an additional separately
AEAD-encrypted **metadata chunk** (last index) authenticated by the same
DEK and a distinct `kind='metadata'` AAD domain. The application never
persists raw media or filename into IndexedDB; the OS gallery is not
automatically written.

The data plane uses the existing `StorageManager` and `AppS3Adapter`
with a dedicated `media_chunk_locations_v1` placement table. Old
`photos/v1` keys, grants, signed policies and S3 objects are unchanged.
New scoped endpoints:

- `POST /media/v1/reserve` — device-signed creation and idempotent replay
- `PUT /media/v1/{mediaId}/chunks/{chunkId}` — checks Content-Length,
  authenticated owner/ACL and exclusive chunk lease; writes via StorageManager
  then independently re-reads S3 and verifies byte size and SHA-256
- `POST /media/v1/{mediaId}/finalize` — all chunks verified, independent
  storage readback, transactional active state and deterministic receipt;
  repeat after lost ACK always returns the same receipt
- `GET /media/v1` — bounded owner-only cursor list
- `GET /media/v1/{mediaId}/manifests` — original canonical signed
  immutable upload contract and server receipt for owner only
- `GET /media/v1/{mediaId}/chunks/{chunkId}` — authorized ciphertext stream
  with SHA header, never browser-accessible unwrapped DEK or provider URL

Browser can decrypt its locally queued file offline and retrieve/verify from
Garage on another device restored with the same Recovery Key, without
persisting plaintext on that device.

## Limit, accounting, isolation and failure semantics

- P1 Free bootstrap: file 128 MiB max, 1 MiB chunks (1–128 data chunks plus
  a metadata chunk, 129 objects total); network upload is per chunk.
  MIME is syntactically restricted on the client, NOT a server attestation
  of genuine media bytes. Server sees coarse `photo|video|audio`.
- Existing Free 50-file / conservative 1,000,000,000-byte bootstrap cap
  now counts `photos/v1` and `media/v1` together under **the same
  authenticated identity-account row lock**. Catalog's unresolved
  GB-vs-GiB product accounting remains OPEN; never infer that the
  conservative byte cap is a commercial entitlement.
- Independent technical media rate limit from
  `config/operational_limits.php`: 480 requests/minute per authenticated
  account, 40/min per unauthenticated IP; never a substitute for Free quotas.
- Durable outbox stores encrypted chunks *before* an optional network
  attempt; bounded pending retry/replay, no fake sync success, no deletion of
  ciphertext on HTTP rejection. Chunk SHA mismatch is not a verified receipt.
  A signed contract may be replayed only with exactly the same bytes/IDs.
- Private filename and MIME are readable by the authenticated owner after
  AEAD-decryption. Coarse type, total byte count and timing remain visible to
  the server by design. Metadata and ciphertext are not public shares.
- No `shares/v1` or assignment grant access is automatically provided to
  new media; v1 photo sharing still uses `photos/v1` only. Integrate
  grant scopes and assignments for video/audio through a later independently
  reviewed signed contract, not by broadening old photo ACLs.
- No cold-offline installed PWA claim. An already-loaded SPA can encrypt
  without network; signed Service Worker trust anchor remains unresolved.
- Physical TTL/GC is implemented in `MediaLifecycle`,
  `MediaCleanupJob` and `pb3:media-maintain`: record deletion intent,
  keep an **immutable permanent tombstone plus opaque S3 key list**,
  perform provider deletion with independent absence checks, delete DB
  placement pointers **only after every physical removal succeeds**,
  regularly sweep tombstones to remove delayed in-flight S3 PUTs,
  and reconcile stale unexpired chunk leases without deleting media.
  Both scheduler AND worker are **DISABLED by default**, require explicit
  `PB3_ENABLE_MEDIA_CLEANUP=true`, and need independent operator
  acceptance before deployment. A successful in-process unit test does not
  replace production S3 outage and recovery simulation.
- This is a **functional P1 bootstrap vertical**, NOT Editor 3.2, Camera 1.2
  video/audio, large multi-gigabyte streaming, multi-replica BYO S3, billing,
  public downloads or a production-ready MediaFile service.

## Gates

- PHPUnit (PHP 8.4 and 8.5): three media types, correct device signature,
  corrupted ciphertext retry, same signed reserve after lost ACK, exact
  finalization receipt replay, authenticated owner read, 404/410, content
  length, share Free file limit and expiry fail closed.
- Vitest: actual AES-GCM photo/video/audio encrypted chunk roundtrip,
  1 MiB boundary, changing IV, corrupt block and foreign account fail closed,
  encrypted local-only filename/metadata and offline account isolation.
- Lifecycle PHPUnit: default-off maintenance gate, two-stage
  expiry + verified deletion, permanent no-resurrection tombstones,
  late S3 write resweep, stale chunk reconciliation, and retryable
  reference retention. No destructive production operations performed.
- Playwright Chromium: offline 1+ MiB video, encrypted IndexedDB,
  real Laravel/PostgreSQL18/Garage2.5 chunk reserve/PUT/finalize, separate
  Recovery-Key device cloud decrypt, unrelated account 404, audio upload
  and cloud decrypt; existing P1 E2E remain green.

Do not claim native Safari/GPS or destructive lifecycle acceptance from
Chromium smoke. Do not merge/rebase or alter `main` without owner instruction.
