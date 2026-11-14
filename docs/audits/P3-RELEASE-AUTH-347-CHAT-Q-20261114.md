# PB3 #347 — post-merge PWA release authenticity preflight (CHAT-Q · 2026-11-14)

## Scope and provenance
- Accepted `main` base: `8ed66c438d090efd218efa80b027f0b2f854db4b`; Git tree `7f2026e3818cae77712d23433475369606f901b0`; new exclusive integration branch `integration/p3-347-release-auth-preflight-chat-q-20261114`.
- Source [Draft #299](https://github.com/1troitsky/photobunker-v3/pull/299) at `3789e67b0dc4c4b9e1ccddb1e8ea8f39cfd019d5`: standalone verifier `verify.mjs` and its original negative tests kept byte-identical; README adjusted only for current main status. Source `verify.mjs` Git blob `8fc30fca5765904dde76da04af8e669f28a7bac3`; source `verify.test.mjs` blob `3a34ecc7ba89497c72b4f173db61546b908b5fca`.
- Source [Draft #300](https://github.com/1troitsky/photobunker-v3/pull/300) at `e0bf685f67bb16e8843f311a1297e311e8250423`: exact existing threat model blob `469df580b69d7330896a7182a66c72313b32f3a6`, copied unchanged.
- Existing unsigned #196 generator already in main (`scripts/release-integrity/integrity.mjs` blob `1206c5555b3f036a53fcc8657283c3c1c71922fb`); historical source PR #250 NOT merged here.
- Changed paths only `scripts/release-auth/**`, dedicated `.github/workflows/p3-release-auth-230.yml`, imported `docs/security/PWA-RELEASE-TRUST-THREAT-MODEL-239.md`, this unique audit. No app boot code, Service Worker install/update, release manifest code, main, or original PR branches changed.

## Security proof obligations and current status
- `verifyRelease` validates canonical manifest v1, detached Ed25519 signature, independently supplied key fingerprint, monotonic sequence, optional exact external checkpoint. A matching signature is only `VERIFIED_WITH_PROVIDED_ANCHOR`, not a verified active release.
- New `integration.test.mjs` builds actual temporary HTML/JS/CSS/SW files using the **main** #196 generator, signs manifest with ephemeral Ed25519 test key, passes #230 verifier then independently hashes every on-disk file via #196 `verifyManifest`. Negative cases deliberately change CSS after signing while the signature still passes but asset check rejects, plus wrong pinned fingerprint, signed rollback, and external same-sequence equivocation.
- Workflow executes **both** baseline release-integrity tests and release-auth tests (isolated Node22 contract only). Source #299 previously recorded 41/41 tests PASS on its own immutable code HEAD. **This new integration HEAD needs fresh actual CI**, not assumed from source PR.
- **BLOCKED/NOT TESTED:** independent off-origin trust root distribution, protected signer custody, live signing service, persistent trusted release floor/checkpoint, external key rotation/revocation, atomic Last-Known-Good snapshot and crash recovery, hostile-origin first boot, browser SW lifecycle/activation, multi-device QA, physical iOS/Android/Safari. These tests use *ephemeral signing keys*, do not certify independent bootstrap.
- No runtime or deployment gates are relaxed. Do not merge this integration as a complete Signed PWA feature; #230 and #239 are still partial. #347 may be reviewed as a narrowly scoped build-time verifier dependency only.

## Acceptance evidence
- Main preflight: owner-authorized #336 integrated at `8ed66c438d090efd218efa80b027f0b2f854db4b`, post-main push Foundation / Security / real PG18-Garage-Chromium **3/3 PASS** per [audit #337](https://github.com/1troitsky/photobunker-v3/issues/337).
- Integration CI: **PENDING** on fresh draft HEAD; record only actual exact-SHA outcomes in #347 and PR conversation after they complete.
- Original historic QA: #299 source test [43495852271](https://github.com/1troitsky/photobunker-v3/actions/runs/43495852271) 41/41; #300 threat model docs-only security PASS, original inherited Laravel CVE and unrelated photo import failure do not transfer as proof to new HEAD.
