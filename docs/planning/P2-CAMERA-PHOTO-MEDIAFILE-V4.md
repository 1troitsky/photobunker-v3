# P2 V-30 — direct Camera JPEG → encrypted P2 MediaFile → signed assignment photo v4

**Status:** Draft/code written; exact-head CI pending. Parent #124 @ `8fa6ab81ce6fa2c45418daff89fecb6d3fcaa2d6` (**3/3 workflow PASS**, including PG18/Garage/Chromium). All PR Draft; `main` unchanged. Matrix paused.

## Product gap

The approved P1 camera already captures a real JPEG from a browser `getUserMedia()` stream, encrypts before upload, supports GPS and signed photo assignment policy, and does not save to the OS gallery. The P2 Media Library supports encrypted JPEGs and separate assignment-scoped owner E2EE grants, but P2 **photo** assignment submissions v3 cover only imported photo files. Existing P2 `MediaCaptureIntent` had only audio/video; the attempted P2 camera-to-media path could not persist a signed photo capture record. The owner could independently validate imported photo consent, not an actual camera photo submitted through the P2 media path.

## Explicit camera choice

- Existing P1 camera photo path remains **default**, unchanged. Photo mode offers explicit `P1 — encrypted photo` vs `P2 — Media Library JPEG` selection.
- In P2, the same real browser video frame is rasterized to a JPEG entirely in volatile memory and encrypted using the existing P2 `encryptMediaFile()` 1 MiB AES-256-GCM chunks plus private AES-GCM metadata (category, description, GPS, tags and filename). Only ciphertext enters IndexedDB/S3. The app never calls OS gallery APIs.
- For a selected authenticated Fieldwork assignment, `signedCaptureBinding()` validates the cached independently owner-signed policy/schedule/requirements and any signed-removal tombstone. The application records the photo capture start/finish timestamps around Canvas JPEG creation, and independently signs `pb3.assignment-media-capture.v1\n` tying `assignmentId`, owner/contributor IDs, exact policy revision/hash, P2 MediaFile ID and SHA-256 of its encrypted signed manifest, `mediaType=photo`, and claimed client capture start/finish times. P1 and personal P2 paths do not change.
- **Important:** A contributor's account signature proves ONLY that the same account asserted this binding. It does not provide trusted-camera/TEE proof, uncontestable timestamp, EXIF/GPS authenticity, or protection against a compromised client forging those claims. Actual coordinates remain encrypted; capture contract contains none.

## V4 server-authorized submission

1. V3 remains **imported P2 photo** (no capture fields). V4 is the **P2 camera photo** with TWO contributor P-256 signatures: immutable submitted-consent `pb3.assignment-media-submit.v4\n`, and nested `pb3.assignment-media-capture.v1\n` signed claim. Legacy AV v1/v2 and P1 `photo_records` untouched. Sender uses an explicit, fail-closed signature-domain version map: a v4 contract must NOT accidentally sign under v1.
2. Server verifies exact canonical fields/signatures, photo-only type, same immutable encrypted manifest hash, owner/contributor identity, photo-supporting signed root policy revision **1** or a later signed amendment revision, bounded photo time claim (max 3 minutes, +2 minutes skew), schedule at both claimed times, accepted contributor membership, and applicable signed policy chronology. Root photo policy has the signed assignment creation time as lower bound.
3. Server **requires** a separately account-signed assignment-scoped v2 recipient E2EE photo-grant to the exact owner, exact ciphertext and live TTL; a personal media grant never substitutes for assignment consent. Live member removal, expiry and archive remain deny-by-default in the existing per-read grant layer.
4. Owner list displays `capturedInAssignment=true` based on immutable signed capture. Owner independently pins contributor account key, verifies both P-256 signatures and exact canonical contract/capture binding **before** showing verified consent, then decrypts photo only through the separately authorized E2EE recipient grant.
5. Lost ACK replay returns identical signed receipt without re-granting expired/revoked permissions. Original contributor media is never deleted, and owner cannot access the entire contributor library.
6. UX confirmation distinguishes P2 captured photo assertion from imported-photo consent and explicitly rejects marketing this as physical proof.

## Required QA

- PHP: root photo-only policy, real signed v4 consent and nested photo claim, exact owner E2EE grant, 201/200 idempotency, owner `capturedInAssignment=true` and photo progress, revocation stops listing/count, forged signature/policy/media/type/time denial.
- Vitest: independent pinned-account signature verification, v4 canonical scope and nested capture hash/ID/time integrity; AV v1/v2 and imported v3 compatibility. Explicit v1/v2/v3/v4 sender domain mapping with no future/invalid version falling back to v1.
- Chromium: real two enrolled accounts, authenticated owner photo advanced rules, accepted participant, browser camera fake device as actual Canvas frame, P2 opt-in JPEG AES-GCM metadata and signed capture, ciphertext-only chunks, sync, explicit owner consent, account-pinned dual-signature receipt verification, authorized owner decrypt/metadata and private GPS/category/tags.
- Must pass exact-head Laravel PHP 8.4.27+/8.5.12+, strict TS/Vitest/build, PG18/Garage+Chromium, Security. Native Safari/iOS/Android, physical GPS/device authenticity and independent owner acceptance **NOT TESTED**.

No release, public card, guest token, MediaFile plaintext leak, Matrix, physical GC, or merge to `main`. 
