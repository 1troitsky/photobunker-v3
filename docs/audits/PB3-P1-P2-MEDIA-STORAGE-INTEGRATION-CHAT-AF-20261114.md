# PB3 P1 + P2 MediaFile / Data & Storage cross-feature integration (CHAT-AF)

**Status:** PRE-MAIN DRAFT / exact-head CI must be checked after commit. Not a release acceptance.

## Sources and provenance
- Accepted unchanged main: `8ed66c438d090efd218efa80b027f0b2f854db4b`.
- P2 user Data & Storage + authenticated manual outbox replay: source PR #397 frozen `53ae9ec2aa0af0bc10934349f33c3fa548169b32`; original exact-head 7/7 workflows SUCCESS (PG18/Garage/Chromium included).
- P1 Camera MediaFile automatic encrypted outbox retry: source PR #392 frozen `49221175dd4a520d64f2a3cc6ee12383be9182a9`; original 4/4 workflows SUCCESS.
- Two source branches have ZERO overlapping changed filenames relative to accepted main. Five source #392 blobs imported unmodified with second commit parent, and no other source code modified. Branch is not main and not a merge approval.

## Own integration acceptance
Unique new `tests/e2e/p1-media-storage-queue-integration-chat-af.spec.ts` exercises real key-only account, offline AES-GCM MediaFile audio enqueue on Camera, account-scoped Storage queue listing/disabled offline manual action, genuine Garage encrypted PUT whose response alone is replaced with HTTP503, automatic in-app replay without Browser or a manual click, independently authenticated cloud manifest and recovered/decrypted exact bytes, and returning to Storage with zero pending. No plaintext filename in public manifest.

**Exact integrated HEAD:** to be recorded after creation.

## Explicit limitations
- UI manual retry path and HTTP-fault Photo readback are tested in the original #397 E2E; global MediaFile automatic retry/lost ACK in original #392. The new test covers their shared app shell and one real user journey.
- This does not assert iOS/Android background delivery, Service Worker, true OS anti-forensics, full Recovery Vault/S3 failover/Matrix, or completed P1–P4 release.
- A red or incomplete workflow remains FAIL/IN PROGRESS; no skipped tests or fake ACKs.
