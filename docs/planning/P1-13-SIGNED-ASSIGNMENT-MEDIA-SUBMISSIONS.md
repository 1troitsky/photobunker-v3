# P1-13 — explicit signed video/audio assignment submissions

Status: **Draft; CI and owner acceptance pending**.
Base: [P1-12 PR #30](https://github.com/1troitsky/photobunker-v3/pull/30)
at immutable `603ab03b0d940269842833e7ecb930f5fba9baa1`.
QA agent's Round 3 [PR #27](https://github.com/1troitsky/photobunker-v3/pull/27)
covers P1-08 PR24 only. No `main` change.

## The protected boundary

Existing signed assignment creation is `pb3.assignment.v1\n` with
`allowedMedia:['photo']`. Existing photo capture/grant/submission and
historical photo policy v1/v2 **remain valid and unmodified**.
Neither accepted invitation, contact/team membership, upload to Browser,
nor personal MediaFile grant implies a right to attach video/audio to any
assignment.

Owner first explicitly opts into video/audio using the append-only
`pb3.assignment-policy.v3\n` signed amendment. The only valid public
canonical ordered sets are:
- `['photo']`
- `['photo','video']`
- `['photo','audio']`
- `['photo','video','audio']`

v3 retains v2's *photo-capture-specific* `requiredCategory`,
`descriptionMinLength`, `requiredGps` and the photo target. Those
requirements **cannot be attested or enforced against uploaded video/audio
by this pilot**. The product must not claim that an uploaded audio/video
satisfies GPS or other camera-photo capture rules. Once owner upgraded to v3,
an older v1 or v2 client cannot silently downgrade policy. Every owner
amendment still verifies root/previous signed hash and concurrent revision,
and a new v3 amendment must change an actual permission, requirement or
photo target.

Contributor must separately:

1. Be an *accepted*, current contributor to an active, unexpired
   assignment, with valid start/end dates.
2. Independently pin and confirm the owner's signed account/ECDH
   fingerprint, verifying fresh or previously trusted owner-signed policy.
3. Already own an independently AES-GCM-encrypted, server-finalized
   MediaFile/v1 of the allowed `video` or `audio` type, using the
   existing 1 MiB ciphertext chunk pipeline.
4. **Explicitly consent** to sharing this personal file's entire
   E2EE DEK, original filename, MIME and encrypted private metadata
   with the assignment owner. This does not imply access to other media,
   a public link or an OS gallery export.
5. Issue/queue a separately account-signed recipient MediaFile grant,
   destination = assignment owner. Only after this grant is confirmed
   can a signed assignment media submission be accepted.

The submission domain is `pb3.assignment-media-submit.v1\n`, with
`{version:1,submissionId,operationId,assignmentId,
contributorAccountId,mediaId,mediaGrantId,mediaContractHash,
policyRevision,policyHash,kind:'video'|'audio'}`.
`policyRevision` must equal the **current** owner policy revision,
not merely a revision formerly enabling a media type; `policyHash`
must equal the canonical current signed v3 amendment. This prevents
laundering an old video grant into a changed/closed assignment or
attaching personal media to an unrelated assignment. The backend
checks ownership, immutable MediaFile contract digest, medium,
active media TTL, exact live explicit owner recipient grant,
accepted contributor membership, and current signed allowed type.
It never reads the unwrapped DEK, private filename, content or GPS.

DB `assignment_media_submissions_v1` stores immutable receipt per
media (unique ID and operation) separately from legacy
`assignment_submissions_v1` photos. Same authenticated signed operation
returns exactly the previous ACK even after finish/revoke/expiry (no new
access created). A changed/colliding operation fails closed. Server
counts videos and audios using full owner-scoped SQL queries with
**currently active media and grants**: first 50-row UI pagination
must not be confused with total counts. Revoke/expiry reduces
currently readable counts/listing, but does not delete original
contributor files nor the historical signed receipt.

## UI/local-first semantics

Owner: two explicit opt-in checkboxes; no defaults. Photo goal remains
a progress-only number. After policy v3 is verified the contributor
sees eligible *already synced* audio/video and a button to send;
unsynced encrypted local files remain available in Browser for upload.
Independent manual fingerprint approval and a distinct browser
confirmation are mandatory before wrapping the recipient DEK.

Local durable assignment outbox tracks media submission signed commands,
with a strict prerequisite to a separately confirmed MediaFile grant.
A pending operation or offline cached policy **never** claims server
acceptance; stale signed owner policy at flush is rejected by server
rather than overridden. Owner's list uses only currently readable
grant receipts, and owner can play media by the existing E2EE
recipient flow. Legacy photo/metadata/camera flow is unchanged.

## Test gates and OPEN boundaries

- PHPUnit PHP8.4/8.5: original photo-only denied, signed opt-in
  v3 accepted, old v1 downgrade denied, accepted invite only, wrong
  signed policy/media type/hash, old policy revision, wrong signature,
  revoked grant denied, stable Lost ACK receipt, owner-only list,
  accurate live authoritative video/audio counts, original preserved.
- Vitest: only canonical photo-first type lists, previous v1/v2
  photo-only, v3 capture flags remain strict.
- Chromium real PostgreSQL18 + Garage2.5: two distinct accounts,
  independent ECDH fingerprints, owner signed policy change,
  video/audio Browser ciphertext upload, explicit consent,
  signed grant then assignment media submission, owner independent
  decryption, server live counts, revoke 410 without loss of
  contributor's media. Earlier photo/media scenarios remain green.

Not delivered: *native camera* video/audio assignment capture,
independent per-kind target counts (1..9999), per-kind
category/description/GPS instructions and validation, recording-time
signed assignment scope for video/audio, large streaming playback,
physical device/Safari QA, general MediaEditor, production PWA trust
or public sharing. The v3 policy is **type authorization only**, not a
claim that all accepted Fieldwork assignment UX has shipped.

No merge/deploy, no `main` mutation. Keep Draft.
