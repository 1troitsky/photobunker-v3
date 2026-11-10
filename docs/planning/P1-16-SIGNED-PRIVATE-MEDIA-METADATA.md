# P1-16 — signed media requirements and E2EE-only private metadata

Status: **Draft; CI pending**. Stacked on P1-15 [PR #33](https://github.com/1troitsky/photobunker-v3/pull/33) at `f136d29cab9fe405c53c16fbd064a14592010f0f`. Never merge or touch `main` without owner approval.

## Vertical: owner → contributor → ciphertext → E2EE grant → receipt

1. Owner's append-only account-signed policy v5 contains `videoRequirements` and `audioRequirements` objects separately, each with PUBLIC flags `requiredCategory:boolean`, `descriptionMinLength:0..4000` and `requiredGps:boolean`. The v5 signed envelope also retains immutable root/previous hashes, photo-only original root, independent optional v4 progress goals and photo requirements. Disabled media types must carry default-false requirements. Neither actual category text nor GPS is in the public policy. Old policy versions v1–v4 remain valid and imply **no mandatory video/audio metadata**.
2. Contributor chooses a signed assignment, a type, enters ephemeral category/description, explicitly requests GPS, and presses Record. Before starting MediaRecorder, client verifies the pinned owner-signed policy and validates the actual input, including GPS range and a recent fix. Failure creates **no recording ciphertext and no assignment recipient DEK grant**.
3. At Stop, the EXACT snapshot of fields used at pre-recording check becomes a v2 encrypted metadata record in the existing AES-GCM media `metadata` chunk. No plaintext fields or filename are stored in the persistent media outbox, owner policy, media manifest, API, analytics, or trace. The pre-existing device-signed MediaFile/v1 public envelope, account-signed MediaCapture/v1 sidecar and recipient grants remain compatible. v1 encrypted media metadata is still supported. The metadata chunk has a bounded **8 KiB** cap to support up to 4000 description characters plus other fields. Server can verify only ciphertext length, digest, signature and access, NOT decrypted private metadata.
4. For imported personal video/audio, optional category/description/GPS can be set prior to encryption; imported GPS always means **current device position**, never verified location of original imported file. Existing personal v1 files remain usable except where an assignment now mandates absent fields.
5. Before sharing ANY media key with the assignment owner, the client requires online owner-signed policy retrieval (including paginated listing); independently checks the pinned key, assignment/role, allowed media kind, expiry, sender's local media, AES-GCM-decrypted metadata and category/description/GPS requirements. For in-assignment recordings, it also verifies the exact assignment, owner, media-contract digest and contributor-account signature/policy revision. The E2EE DEK is not released on a missing/stale/offline/invalid policy or metadata. After preflight, a separate user confirmation remains mandatory for personally imported media.
6. Live recipient grants and server-derived counts remain separate: passing a metadata field does not prove that GPS/time or camera is authentic, and it cannot allow server plaintext access.

## Security and scope

- **Private actual fields**: metadata `version:2` and `category?`, `description?`, `gps?` encrypted with the same independently wrapped asset DEK and per-chunk AEAD AAD. Metadata v1 remains exact and backward compatible. CreatedAt for in-assignment media denotes claimed **recording start**; time and location remain unaudited client claims.
- **Public signed policy**: v5 exact fields, domain `pb3.assignment-policy.v5\n`, owner-account signature, 1000-event append bound, no downgrade, monotonic parent hashes/revisions, idempotent lost-ACK replay.
- **Server**: verifies signed owner flags only. Never trust or claim to validate the private metadata; never log category, description or GPS. Upload and submission authorization still requires contributor membership, current signed allowed kind, existing E2EE grant and live ciphertext.
- **Grant preflight**: online freshness is deliberately required when releasing a DEK. Previously encrypted offline recordings remain durable; their sharing is deferred until online. A recording bound to an outdated policy revision cannot be newly shared under a changed policy without explicit future migration support. Fail closed.
- **Not included**: per-kind tags/category allowlists, cryptographic GPS hardware attestation, external import file-exif authenticity, offline recipient-grant transfer under policy changes, automatic live re-encryption, Fieldwork editor parity, native Safari and physical-device acceptance, or production deployment.
- **No new DB table or plaintext storage**. Media contract remains v1; its AEAD metadata payload optionally upgrades to v2. The new policy is an append-only event, so no schema migration.

## Verification targets

- PHPUnit: valid v5 signed requirements, canonical nested flag shape, invalid disabled fields/values, old-version downgrade forbidden, lost ACK, legacy v1–v4 compatibility, metadata chunk byte bound.
- Vitest: media v1/v2 metadata round-trip, AES-GCM tampering rejected, no ciphertext/contract/IndexedDB plaintext leakage; invalid/missing fields rejected; old signed requirements default and new requirements independent per kind.
- Chromium two-account E2E: owner activates v5 audio category/description/GPS flags; prior imported audio has no private fields and cannot obtain a new grant; contributor microphone Record fails before collecting bytes until the requirements are met; after explicit GPS, local encryption and sync, owner decrypts the three fields over an authorized grant; video/legacy photo flows still work.
- Postgres 18 + Garage 2.5 smoke, production frontend build, PHP 8.4/8.5 and security floor all green.

Native Safari/iOS hardware and location trust remain **NOT TESTED**, regardless of headless Chromium results.
