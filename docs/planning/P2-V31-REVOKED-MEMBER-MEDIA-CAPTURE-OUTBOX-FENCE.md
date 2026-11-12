# P2 V-31 — local revocation fence for MediaRecorder and P2 E2EE submission

**Status:** Draft, exact-head CI pending. Parent [Draft #125](https://github.com/1troitsky/photobunker-v3/pull/125) @ `75298149a17ebcd2c3986c8a9fcc1087b3196266` (3/3 workflow PASS including actual A↔B Chromium Camera→P2 JPEG→owner decrypt). `main` unchanged. Matrix paused.

## Observed boundary

The independently verified owner-signed removal from V-27 (#122) persists an account+assignment-scoped local revocation tombstone and atomically invalidates cached invitation, owner policy and private summary. The P1 `signedCaptureBinding()` checked this tombstone, but the separate P2 MediaRecorder AV path `signedMediaCaptureIntent()` did not. After a contributor had already authenticated an owner removal, a stale AV recording could still be started using previously cached signed rules. Later server authorization would reject the new submission, but the app would consume recording/encryption/storage resources and display stale capture eligibility.

Additionally, `preflightAssignmentMediaGrant()` and `queueAssignmentMediaSubmission()` lacked a local tombstone check. They still require fresh server authorization and scoped cryptography, but locally known revocation should deny *before* an E2EE recipient envelope or new durable assignment submission is created.

## V-31 changes

- `signedMediaCaptureIntent()` reads the durable `db.revocations[accountId/assignmentId]` **before** cached owner policy access and **again after** asynchronous owner signature/requirements verification. Existing P1 photo `signedCaptureBinding()` keeps its own exact same double-check.
- On `MediaRecorder.stop()`, for an assignment recording, Camera checks the same revocation prior to converting the ephemeral buffer into an encrypted P2 MediaFile. If revoked while recording, only the recording is discarded; no media/OS gallery write is initiated. Personal AV recording remains independent.
- `preflightAssignmentMediaGrant()` checks the local tombstone before the network fetch and after online policy verification, AES-GCM private metadata decrypt and signed capture validation. The owner still cannot receive any file without a separate opt-in E2EE recipient grant; a compromised client cannot turn this local guard into server authorization.
- `queueAssignmentMediaSubmission()` checks before policy lookup and at the final commit point. The last check and the IndexedDB `operations.put()` occur **in one Dexie readwrite transaction** across `operations` and `revocations`. No asynchronous crypto or network I/O inside the transaction; a verified removal committed concurrently cannot interleave between the denial read and operation persistence. The queued item keeps normal signed consent, prerequisite grant ID, Lost ACK semantics and retry behavior.
- A removal **never deletes** contributor originals, AES-GCM media chunks, separate personally owned files, the existing encrypted outbox, or previous signed receipts. Existing queued entries remain recorded and the server stays authoritative for all grants. No local claim that we can revoke ciphertext already downloaded by another device.
- Tombstones are scoped to the exact authenticated account and assignment. An unverified notice cannot create this tombstone; only the already implemented owner P-256/fingerprint checked removal pipeline writes it. This feature does not change the proof verifier.

## Acceptance

- Vitest fake IndexedDB v4: a locally verified removal denies new AV `signedMediaCaptureIntent`, new P2 photo/video/audio assignment submission and preflight E2EE share offline, before any stale policy/network attempt. Personal local assignment/outbox remains intact. Other accounts and assignments are not blocked. No mock owner signature promoted to authority.
- Exact-head PHP 8.4/8.5, Vue TypeScript/Vitest/build, Security workflow and real PostgreSQL 18/Garage/Chromium full suite must pass.
- No physical Safari/iOS/Android acceptance, race across *independent* IndexedDB databases claimed to be atomic, or real hardware camera/GPS attestation. The final E2EE MediaFile encryption uses its own storage DB; server per-read access controls remain the definitive defense if removal happens after a media capture snapshot.

No deploy or merge to `main`. All PR Draft.
