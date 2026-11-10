# P1-06 — приватные метаданные снимка (категория / описание / GPS)

Status: **Draft PR #22; CI and owner/mobile acceptance are separate gates.**
Base: signed policy revisions PR #21 at `06cff85c9e04565af50d30da417f7309b3d2112b`.

## Vertical

1. Camera offers an optional category (maximum 64 characters), description
   (maximum 4000 characters) and one-shot GPS permission **only after a user
   button click**. No background geolocation watcher or automatic upload.
2. The one-time GPS fix includes latitude, longitude, accuracyMeters and
   recordedAt. Invalid coordinates, accuracy or fixes more than two minutes
   older than capture time are rejected **before durable persistence**. 
3. Private fields are normalized in browser memory and encrypted into the
   existing `kind=metadata` AES-256-GCM asset with a unique per-asset DEK.
   The asset is stored in encrypted IndexedDB then in encrypted Garage/S3.
   Existing master JPEG, encrypted outbox, signed photo v1/v2 contracts,
   account-root keys, S3 authorization and TTL are unchanged.
4. Account-owned Browser can decrypt a local or remote metadata asset after
   verifying its AEAD frame digests, wrapped DEK, scope and ciphertext size.
   Category, description and GPS are displayed only inside the opened private
   photo preview; they are wiped from the preview state on close/logout.
   There is **no remote geocoding/map request**.
5. `metadata.version=1` remains the legacy photo format with type,
   capturedAt, source and optional signed capture binding.
   `metadata.version=2` adds nonempty category and/or description and/or
   GPS. Signed assignment binding matches the decrypted capturedAt.
   This **metadata version is distinct** from signed photo contract v2:
   adding private GPS does not change server contract version or permit a
   different capture policy.

## Privacy invariants

- No plaintext metadata in photo outbox DB row, signed photo contract,
  asset manifest, S3 object, request path, server event or application log.
  The server does see ciphertext sizes, digests, object IDs and existing
  signed assignment capture binding (including a claimed capture time).
- GPS is **optional and explicit** in this increment. Current owner policies
  only edit the photo goal; **required GPS/category/description and minimum
  description lengths are not yet active**. Later signed rules must be checked
  before capture and again before owner-directed submission without revealing
  coordinates/description to the server. Do not claim backend plaintext
  validation is possible under Zero-Knowledge.
- Location is a browser-provided measurement, not hardware geolocation
  attestation, cryptographic proof of presence or a trusted clock.
  Native Safari/iOS permission and background behavior remain NOT TESTED.
- The private metadata is not automatically revealed to an assignment owner
  by receiving a photo grant; explicit grant scope for metadata requires
  separate authorisation design.

## Regression gates

- Domain Vitest for legacy v1, v2 normalization, malformed/old GPS,
  control characters, unknown fields and capturedAt signature binding.
- Real WebCrypto + fake-indexeddb test verifies ciphertext-only stored row,
  signed contract, encrypted asset bytes, local decrypt, validation before
  any write.
- Camera component tests verify zero automatic geolocation calls, explicit
  user gesture, stale callback ignored after account/keys switch.
- Two-browser Chromium with Garage validates opt-in fake GPS, offline v2
  capture, encrypted outbox without plaintext, sync, Garage metadata readback,
  and private Browser display alongside existing assignment state and grant
  flow. Fake geolocation is *not* device acceptance.

No merge/deploy, no changes to main, no Service Worker registration.
