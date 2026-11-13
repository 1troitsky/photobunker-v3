# P2 Issue #211 — Public Card: isolated privacy preflight (2026-11-13)

## Claim / base / coordination
- CLAIM in Issue #211. Owner: independent ChatGPT lane. Branch: `p2/211-public-card-policy-preflight-20261113`.
- Base: audited #297 security HEAD `60407676c7cb9bdb649f5017cf9450aff25eedab` (unmerged, Laravel v13.42.0); stack PR on its branch so unrelated security lock changes do not enter #211 diff.
- Remote `main` remains `6565a0fe852882ea5fc26e493df81affed687eee`.
- #198 Notifications owns `apps/api/routes/web.php` and multiple controllers; #230 Signed PWA owns independent release trust work. Neither lane, any shared route nor existing preview controller was edited.
- Historical #108/#109/#110 enforce signed owner-only `publication=disabled` preview policies and no anonymous data access. Preserve this invariant.

## Implemented safe subset
1. `apps/api/app/PublicCard/SafeCardProjection.php`: pure **private preview minimizer** that accepts only a strict safe JPEG data subset and already-verified owner preview ceiling. The class is intentionally NOT a verification of signature, ownership, token, public scope or live DB state. It will never grant publication.
2. Exact nested field and action allowlists; deny all unknown keys including GPS, original URL, DEK, storage keys, unauthorized HTML, invalid MIME and stale expiry; derive min(safe media TTL, signed ceiling TTL).
3. `apps/api/tests/Unit/PublicCard/SafeCardProjectionTest.php`: success, absent optional values and negative attempts to escalate view/download, enable publication, inject GPS/DEK/original URL, alter expiry or untrusted fields.
4. No route, bearer token, anonymous endpoint, trust anchor, media read or permissions changed.

## Required follow-up before a real Public Card
- A separate signed **explicit publication** operation binding owner account, original asset hash, safe derivative hash, scope, expiry and opaque random capability ID.
- Durable server-side revocation and deny-by-default ACL on *every* public read; media deletion/archive/owner revoke must invalidate token.
- Real safe flatten/export of allowed JPEG, no GPS, source/original bytes or DEK exposure; cache-control no-store and negative E2E.
- Independent anonymous browser client tests for expired/revoked/unknown/token-race accesses. No dependency on Notifications or Signed PWA release route.
- No public route should be activated by this preflight-only slice.

## Acceptance status
- Contract code and negative unit tests written. One-shot security-floor PHP 8.5 workflow committed removal of its own workflow as commit `8df5e5f1e445dbbaa9015789715afa1e28b38279` only after `composer validate --strict`, `composer audit --locked`, Composer install and `php vendor/bin/phpunit tests/Unit/PublicCard/SafeCardProjectionTest.php` commands. This is evidence of successful command-chain completion, **not independently retrieved stdout/test-count evidence**. Standard PR workflows on subsequent authored HEAD must be checked separately. This is **PARTIAL / preflight**, never full #211 PASS.
- Real iOS/Android NOT TESTED; anonymous grant/read NOT IMPLEMENTED; user-facing public page NOT IMPLEMENTED.
- No merge, deployment or main updates.


## 2026-11-14 — Independent real owner-signature preflight extension

CLAIM addenda: Issue #211 comments `6863817088` (code) and `6863885179` (unique new CI). Same Draft PR #301, no additional competing PR.

### New runtime contract (not an active publication)
- `apps/api/app/PublicCard/SignedPublicationIntent.php` verifies a canonical strict-field JSON v1 intent with actual P-256 owner-root ECDSA signature, domain-separated `pb3.public-card-publication-intent.v1\n`, not an unverified device/client permission.
- Intent binds immutable `accountId`, source and separate safe `mediaId`, both signed ciphertext contract hashes, flattened-safe JPEG digest, SHA-256 opaque-token hash, operation UUID, expected revision, explicit `safe-photo-view-v1` scope, expiration and chosen visible fields/actions.
- Inputs `$trusted` MUST be a trusted live server snapshot (not supplied by a browser): active account/media and PHOTO type, non-archive/non-tombstone, source/safe/assignment TTL, assignment and file preview ceilings and field/action intersections.
- Narrow scopes intentionally allow only **safe photo view**, description and capture date with policy approval. GPS, arbitrary metadata, original, copy, download and share all remain denied until separately designed/audited.
- A successfully verified intent is **not** a public capability, a safe-image inspection, a publication action, a durable grant, or permission to bypass the existing `publication=disabled` preview. There is **no** new route, token issuer, public blob, persistent read ledger or anonymous response. Safe derivative digest is a binding assertion, **not** proof that the JPEG is actually EXIF-free; that proof still needs a real client flatten/export and server acceptance gate.

### Verified exact-head CI evidence
- **CODE HEAD `f2b9b8e8967b5317d336f1ddc1b8b7e050e09ce4`** — [Public Card PHP 8.4 + 8.5 dedicated workflow run 43500838120](https://github.com/1troitsky/photobunker-v3/actions/runs/43500838120) **2/2 PASS**. Both [PHP8.4 job 132145871290](https://github.com/1troitsky/photobunker-v3/actions/runs/43500838120/job/132145871290) and [PHP8.5 job 132145870779](https://github.com/1troitsky/photobunker-v3/actions/runs/43500838120/job/132145870779): `composer validate --strict --no-check-publish` PASS, `composer audit --locked` **0 advisories**, real PHPUnit `tests/Feature/PublicCardSignedPublicationIntentTest.php` **39/39 PASS, 381 assertions**.
- [Security workflow 43500838163](https://github.com/1troitsky/photobunker-v3/actions/runs/43500838163) **PASS**, [UX scope 43500838236](https://github.com/1troitsky/photobunker-v3/actions/runs/43500838236) **PASS** on same code HEAD.
- Original run [43500716848](https://github.com/1troitsky/photobunker-v3/actions/runs/43500716848) initial PHP8.4 **FAIL BEFORE TEST EXECUTION**: test helper `json()` collided with inherited Laravel TestCase method. Fixed by renaming ONLY test helper to `canonicalJson()`. Original failure preserved; **no weakening/deleting original negative assertions or product validation**.
- This is a stacked PR into #297, not `main`. Full generic Foundation and PostgreSQL18/Garage/Chromium **NOT TESTED on this exact #211 code HEAD**, and actual anonymous Public Card E2E remains **BLOCKED** until real publication API and safe-image delivery exist.
- `main`, Notifications #198, Signed PWA #230 and every foreign branch untouched.

### Remaining acceptance for full Issue #211
Server-keyless flattened EXIF/GPS-free JPEG deliverable; verified owner-signed publication persisted with uniqueness and atomic revocation/tombstone state; opaque random token issuance and read-time SHA-256 digest comparison; anonymous restricted URL and cache-control/no-store; live read-time policy intersection `assignment ∩ file ∩ public grant ∩ TTL ∩ media scope`; full negative DB+Garage+two-device Chromium tests for stale grants, expiry, lost ACK, cross-account and deletion; native devices and owner UX confirmation. None of these are falsely claimed by the current contracts.
