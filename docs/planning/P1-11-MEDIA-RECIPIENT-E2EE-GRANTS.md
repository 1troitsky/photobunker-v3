# P1-11 — explicit recipient grants for personal MediaFile/v1

**Status:** Draft. Stacked on P1-10 [PR #28](https://github.com/1troitsky/photobunker-v3/pull/28)
at immutable `9485e549ef4d269bb49e0448b7c9856913444b0d`.
The separate independent Round 3 QA [PR #27](https://github.com/1troitsky/photobunker-v3/pull/27)
covered PR24 only. This is not owner acceptance, native Safari acceptance,
a production share scope or a public link.

## Scope and security boundary

P1-10 personal photo/video/audio files are signed by a **device**, encrypted
in immutable 1 MiB AES-GCM chunks, with one random 256-bit per-media DEK
wrapped in the account's AKEK; the original filename and MIME are a separate
encrypted metadata chunk. The P1-11 grant is a new **account-signed**
`pb3.media-grant.v1\n` envelope, issued explicitly by the owner only after
the recipient's independently verified fingerprint has been pinned.

Signed grants contain an exact immutable set:
`{version:1, grantId, mediaId, ownerAccountId, recipientAccountId,
recipientKeyDigest, mediaContractHash, scope:"read", expiresAt, envelope}`.
The `mediaContractHash` is SHA-256 of the exact owner-uploaded,
device-signed canonical MediaFile contract; neither the server nor a
recipient may relabel assets or their ID/type/chunk SHA digests without
failing client signature/hash/AEAD checks. The ECDH/P-256 + HKDF + AES-GCM
recipient envelope wraps **one DEK only**, using a new
`pb3.media-recipient-dek.v1\n` KDF/AAD context that binds both accounts,
grantId, mediaId, mediaContractHash, exact expiry and read-only scope.
No unwrapped owner AKEK, Recovery Key, plaintext GPS, audio or filename is
ever posted to the API.

Recipient performs, in this order:

1. Requires online session for live server ACL; rejects foreign/expired
   grantId/account/mismatched contract.
2. Requires pinned owner account signature public key verified independently,
   checks the account-signed immutable grant bytes and signature.
3. Requires its own account-signed ECDH directory and exact key digest.
4. Hashes the immutable MediaFile contract and compares with signed
   `mediaContractHash`; checks expiry, account/media binding and server
   receipt's deterministic SHA-256.
5. Decrypts the one-time wrapped DEK with its account-scoped ECDH secret,
   never puts raw bytes in local storage, erases the transient buffer.
6. Requests **every ciphertext chunk via live recipient grant ACL**;
   validates Content-Length + SHA response, checks each AES-GCM tag and
   immutable AAD before revealing filename/MIME/bytes to the media preview.

Backend `/media-shares/v1` has distinct owner-signed grant, recipient-only
received page, signed details, per-chunk read and owner-only signed revoke
endpoints. Both recipient detail and physical ciphertext reads re-check
the active grant, underlying active media, expiry, and the exact MediaFile
contract hash. A revoked grant produces HTTP 410; a foreign account sees
404 and no listing. Grant ID replay with exactly the same signed contract
is idempotent while active; changed contract or key digest is rejected.
**No grant is implied** by a friend/contact, assignment, team membership
or current device session. Grant scope is only `read`, not the product's
future separate explicit download/original/public scopes.

`MediaSharePanel.vue` requires visible manual fingerprint confirmation on
both send and receive. A user can send only a confirmed locally
synced file. The new media grant outbox is account-scoped durable ciphertext
containing only public signed contract and recipient-wrapped DEK. Original
owner media remains available after grant revoke. The recipient may
already have copied a decrypted result: revoke only blocks future
server requests, not already downloaded plaintext.

## Implementation notes and explicit exclusions

- Media grant tables are separate from photo grants and have immutable
  `media_id`, owner/recipient and revision-1 contract hash. This avoids
  silently widening the signed `photos/v1` ACL, bypassing photo pregrant
  or changing existing historical photo share contracts.
- The accepted MediaFile v1 has **one immutable version**. Future
  `MediaRevision`, optional original/edit/safe asset scopes and
  per-file metadata revisions must introduce separately authenticated
  signed contract versions, separate rights, and safe concurrent
  migration rules. **Those features are not yet implemented.**
- Grants for new media are **personal**: no assignment submission,
  re-share, public photo cards, chat attachments or share of entire
  assignment is included. Assignment video/audio will require a
  server-side signed media-binding submission contract plus pregrant
  checks; merely having this grant does not imply assignment acceptance.
- The current P1-10 whole-media read assembles all encrypted chunks before
  returning a Blob. Large multi-gigabyte stream playback and bounded-memory
  decrypted media seeking are NOT implemented; 128 MiB bootstrap cap stays.
- Native Safari, hardware, signed cold-offline PWA trust, physical S3
  deletion QA and production compliance are untested, unchanged. No
  automatic media cleanup enabled.

## Acceptance evidence to check (not approval)

- PHPUnit PHP8.4/8.5: independently created recipient exchange
  directory, strict signed grant, changed hash/key/signature, idempotent
  lost ACK, recipient-only manifest/chunk GET, outsider/owner 404,
  revoke HTTP 410 for future reads, no deletion of original file,
  expiry 410.
- Vitest: read-only scope, strict wrapped DEK envelope, no raw key,
  existing MediaFile AES-GCM and Local-First tests unchanged.
- Real PostgreSQL18/Garage2.5/Chromium: owner imports encrypted audio,
  separate account publishes ECDH key, independent manual fingerprints,
  owner sends one-DEK grant, recipient decrypts audio and original
  filename locally, server sees neither, revoke blocks future HTTP
  reads while owner's same ciphertext remains.
- Existing P1-10 owner-only video/audio and photo/assignment E2E remain
  green. No `main` changes, merge or production release.
