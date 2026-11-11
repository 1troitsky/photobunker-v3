# P2 V-17 — Owner-side verification of independently signed assignment media receipts

**Status:** Draft, untested exact-head (CI queued). Stacked on #111 at `8a9d8f58aba1b7143986c968792101e3205a3e5f`; unrelated defense-in-depth #112 remains independent. Matrix paused. No merge or deployment.

## Problem

The owner MediaFile submission list previously contained server-reported `mediaId`, `contributorAccountId`, `capturedInAssignment` and a live recipient grant. The backend checked an independent contributor-account signature on submission, but the **owner device could not verify the immutable consent signature**. The UI must never imply independently verified provenance merely from a server row, a grant or a green server count.

## Bounded implementation

- Authenticated owner-only `GET /assignments/v1/:assignmentId/media-submissions` also returns the immutable original `contract`, `signature` and `mediaContractHash` already stored on the server. It does **not** return plaintext photo/AV, private tags, description, GPS or any DEK.
- The owner checks canonical strict contract fields and binding of `assignmentId`, contributor identity, media and grant IDs, media hash, policy revision/hash, media type, and actual declared `capturedInAssignment` mode. Photo MediaFile v3 is strictly an **imported-personal-photo consent receipt**, not a P2 camera capture.
- The owner requires an **independently confirmed, unchanged contributor root key** using existing `pinnedPeer`, then verifies the ECDSA submission signature for the exact version-specific domain. Historical AV v2 also verifies its nested signed capture *claim*. This is an account assertion, **not hardware/GPS/time attestation**.
- Unpinned peers, changed keys, invalid signatures, noncanonical JSON, extra fields or identity/asset mismatches are shown as **NOT VERIFIED**. Server-authoritative counts remain separate from cryptographic provenance; no optimistic success from cached drafts.
- No new public links, anonymous access, album sharing, original transfer, metadata release, policy widening, Matrix dependency or physical GC.

## Tests/gates

- PHPUnit: owner receives exact immutable signed receipt/hash, outsider still gets 404; live grant and revocation checks from #111 remain in place.
- Vitest: valid imported-photo v3, legacy AV v1, self-signed capture v2; wrong grant/media/policy/type, extra fields, bad nested signature, absent peer pin, forged account signature.
- Must run exact-head PHP 8.4.27+ / 8.5.12+, PostgreSQL18/Garage+Chromium and security CI, with **no skips**, before integration claims. Also independently verify A→B owner display after contributor fingerprint confirmation and key rotation, offline return, revocation and assignment retention. Native Safari/iOS/Android are NOT TESTED.
- Until tests pass: **CODE WRITTEN / NOT VERIFIED**. Even after checks, device signature verification does not prove camera-origin or GPS authenticity.
