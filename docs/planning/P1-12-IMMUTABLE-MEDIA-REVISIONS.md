# P1-12 — immutable signed MediaRevision lineage

**Status:** Draft (code + CI required), based on
[P1-11 PR #29](https://github.com/1troitsky/photobunker-v3/pull/29)
@ `9f066faa32be7fb7b60887975c56c1bcd9297838`.
Do not merge/rebase, deploy or edit `main`.
Independent Round 3 local QA PR27 covered older PR24 only.

## User contract

The owner uploads a **new full MediaFile** (photo, video or audio) with
P1-10's separately randomized DEK, ciphertext chunks, metadata and TTL,
then explicitly selects that already synced file as the next version
of an existing synced original. Each version preserves its own immutable
UUID, ciphertext, original metadata, receipt, expiry and recipient grants.

P1-12 is **not** an in-place metadata or photo edit, diff upload, delta
sync or automatic thumbnail generation. No original version is overwritten
and no recipient E2EE grant is propagated to a new version: the owner must
explicitly authorize each media grant separately. A signed lineage is a
version history, not an ACL, public share or assignment submission.

The signed owner command `pb3.media-revision.v1\n` has exactly:
`{version:1,linkId,operationId,accountId,rootMediaId,previousMediaId,
newMediaId,rootContractHash,previousContractHash,newContractHash,
fromRevision,toRevision}`. The three hashes are SHA-256 over
**exact, previously server-finalized MediaFile upload contracts**.
No filename, MIME, descriptive text, unwrapped DEK or private GPS is
included.

Server under the same authenticated account row lock and a PostgreSQL
transaction:
- checks signer is the same root account and contract is exact;
- serializes link operations, checks all three original/previous/next
  media exist, belong to same account, are finalized, unexpired and
  the same coarse media type;
- verifies exact immutable root/previous/new contract hashes;
- independently validates the previously accepted entire account-signed
  chain, revision continuity, owner binding and previous head/hash;
- allows only the current tip to add a new revision; forbids forks,
  reusing previous files, separate roots starting at an existing version,
  cycles, cross-type/file swaps or aliases to another account;
- preserves a previously committed identical signed operation's ACK,
  including after subsequent revisions were appended;
- leaves all media bytes/keys/provider objects unchanged.

GET `/media/v1/{rootMediaId}/revisions` is owner-only and returns the
original contract hash, ordered signed revision contracts/signatures and
current head. The client re-verifies **EVERY** signature, hash, owner,
revision, predecessor and no-cycle condition against the account key
already unlocked by the Recovery Key. An account-scoped IndexedDB cache
holds **public signed references only**; warm-offline history is reverified
on read. New offline links can be queued from a previously authenticated
cached chain only when all selected file ciphertexts are locally synced.
Unverified first-time history cannot be guessed offline. Actual server
acceptance is reported only after its signed POST succeeds.

## Retention and privacy

`media_revision_links_v1` intentionally keeps opaque UUIDs and signed
audit contracts without **cascading media file FKs**. Otherwise an
unexpired new revision would block old MediaFile TTL deletion, leaving S3
ciphertext undeletable. The existing operator-gated
`PB3_ENABLE_MEDIA_CLEANUP` machinery continues to delete expired
media bytes and keep permanent tombstones independently. Once root
media is expired/deleted, active owner lineage GET returns HTTP 410.
Preserving/treating old version history after root TTL requires future
data-retention policy and cannot be assumed from this pilot.

No new network authority is assumed for offline/recovered devices;
signed history verifies past version ownership but not a fresh sharing
ACL or live recipient permissions. The existing `media-shares/v1`
E2EE grants remain independently version-specific.
Server sees coarse media type, sizes and opaque version link IDs but
never private filenames/content or key material.

## Test gates

- PHP8.4/8.5: strict owner signature, two revisions in order,
  identical lost-ACK replay, unexpected fork/type/cycle/successor-as-root,
  crossed account, alias or mutated hash, and exact unchanged
  MediaFile/S3 placement references.
- TTL cleanup test: deleting expired root media is not FK-blocked,
  newer revision stays active and the signed lineage/tombstone persists.
- Vitest: reconstruct owner-signed version chain, corrupted
  signature/hash, reordering, missing history, wrong key, rollback
  and signed cycles fail closed.
- Chromium/PostgreSQL18/Garage2.5: original plus two separately
  encrypted revisions, full upload and receipts, real browser UI link,
  none of the old media overwritten, no implicit recipient grants;
  another recovered device verifies signed history and decrypts all
  three immutable cloud versions. Existing P1-10/11+photo/assignment
  E2E remain green.
- Native Safari, physical devices, large delta version upload,
  original/edit/safe asset-specific per-version ACL and public
  MediaRevision remain NOT IMPLEMENTED / NOT TESTED.

Future assignment video/audio submissions need their own signed
requirements/pre-grant validation and cannot infer authorization from
these lineage links.
