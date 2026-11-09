# P1-14 — signed, local-first audio/video recording for assignments

**Status:** Draft, automated CI and physical Safari/hardware acceptance required.
Based on P1-13 [Draft PR #31](https://github.com/1troitsky/photobunker-v3/pull/31),
immutable commit `c6d0acbe635c44d016e8f420f47eef5b842b7d6d`.

## User-visible vertical

The existing camera route now permits a mode switch: Photo, Video, Audio.
Photo preserves its existing independent photo capture and signed historical
policy. Audio requests **microphone only**; video requests camera+microphone.
The browser chooses a supported MediaRecorder MIME and rejects unsupported
platforms, without silent fallback to a different unvalidated file type.
A contributor can open Camera from an already accepted assignment and
record audio or video directly. The chosen type must be **explicitly**
enabled by owner-signed `pb3.assignment-policy.v3`.

Recordings are collected briefly in browser process memory only; after Stop
they become a new immutable MediaFile/v1 with independent AES-GCM DEK,
encrypted metadata, chunks, TTL, signed device manifest and a **durable
local ciphertext outbox** before network upload. Never write to the OS
gallery or MediaStore. A user leaving the page, changing account/device,
switching mode or cancelling midway discards unencrypted transient data and
stops microphone/camera tracks; a failed encryption or browser crash may
lose unsaved recording and must not be mistaken for a synced file.

Pilot recording limit: 175 seconds and 128 MiB. Future production
streaming encryption / progressive recording to encrypted OPFS is a
separate larger-media task; current MediaRecorder plaintext chunks exist
in volatile browser memory until AES-GCM encryption finishes. The
application cannot guarantee physical RAM erasure by browser GC.

## Explicit signed capture scope

New immutable `pb3.assignment-media-capture.v1\n` signed by **contributor
account key** (not a mutable server key). Exact canonical fields:
`{version:1, assignmentId, ownerAccountId, contributorAccountId,
policyRevision, policyHash, mediaId, mediaContractHash, mediaType,
startedAt, finishedAt}`.

- `policyHash` is the SHA-256 of the **verified, pinned, owner-signed
  current v3 amendment**. An offline session may use only previously
  authenticated cached owner policy, not an untrusted server lookup.
- `mediaContractHash` is SHA-256 of the exact independent,
  immutable device-signed MediaFile/v1 manifest. No in-place changes to
  the existing media crypto or private metadata format.
- The signed capture scope is created as part of media encryption and
  committed **atomically to the same IndexedDB row as the ciphertext**.
  No network is required to save the local recording.
- No GPS/category/description is introduced into the server-visible scope.
  Recording timestamps are **client-declared**: a signature binds a
  declaration, but DOES NOT prove the real recording time, physical camera
  hardware, location, or immunity to a malicious/modified client.

The contributor later sends the file to the assignment owner's E2EE
recipient through a distinct, fingerprint-confirmed explicit grant and
signed `pb3.assignment-media-submit.v2\n` receipt, including the exact
`captureContract` and `captureSignature`. The older personal-media
submission v1 remains valid. A personal recording without an assignment
is simply personal media and has no submission capture proof.

Server verifies **both account signatures independently** and the exact
submission/capture/file/policy identity, type, version, hashes, server
policy acceptance timestamp (bounded clock skew), assignment start/end,
signed duration, accepted membership, active unexpired MediaFile and
recipient live E2EE grant. The receipt preserves the original signed
proof; the owner sees only a `capturedInAssignment` indicator alongside
the file grant, not decrypted media, filename, GPS or account recovery key.
An old accepted signed receipt can ACK idempotently even after
revocation/expiration without recreating access. Server live counts
continue to reflect actual readable grants rather than offline queues.

## Deliberate limits / follow-up

- Current v3 policy authorizes media type. It does NOT yet define
  per-kind video/audio target counts, recording instructions or
  photo-equivalent independently verifiable per-kind category/GPS
  requirement rules. No statement that audio recording proves GPS.
- No assignment video/audio in-place editing, thumbnails, streaming upload,
  pause/resume across reload, background recording on iOS, hardware
  attestation, secure physical memory scrubbing or original/safe
  version-specific sharing scope.
- Native Safari/physical iOS PWA MediaRecorder compatibility and microphone
  permission behaviors remain **NOT TESTED**. The simulated Chromium
  MediaRecorder flow and PHP signed protocol tests are necessary but
  not a substitute for hardware/device QA.
- Existing P1-10 MediaFile, P1-11 E2EE grants, P1-12 MediaRevision,
  P1-13 personal-media assignment submissions and photo-only
  assignment policies remain byte-for-byte backward compatible.

## Acceptance checklist

1. PHPUnit PHP 8.4/8.5: correct original signed v3, contributor role, E2EE
   grant, media digest and server policy acceptance, v2 signed proof,
   idempotent replay and revoke; reject foreign assignment/policy,
   wrong media hash, malformed/forged proof and unrealistic timestamps.
2. Frontend TypeScript/Vue build + Vitest and previous tests.
3. Real PostgreSQL18 / Garage2.5 / Chromium E2E: two independent
   identities, owner-signed video/audio policy, contributor records
   real MediaRecorder audio in the assignment with browser fake
   microphone, ciphertext persisted with a signed capture proof,
   encrypted media uploaded, owner independently decrypts via grant,
   signed v2 receipt counted; previously sent personal media and
   revoke tests stay green.
4. Real Safari/iOS microphone and camera device QA separately with
   sanitized evidence; no automatic handoff to a quota-limited QA
   agent for routine GitHub CI.

Keep Draft. Do not merge, deploy or modify `main`.
