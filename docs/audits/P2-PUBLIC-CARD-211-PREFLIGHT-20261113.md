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
