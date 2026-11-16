# P1 #201 / child #393 — owner-signed Photo grant exact expiry boundary (CHAT-AB)

**Date:** 2026-11-14 Asia/Tbilisi. **Status:** code written, exact-head CI not yet evaluated.

## Source and bounded scope

Accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b`. Read normative `ts.md` §5.2 and §21.4, `AGENTS.md`, parent E2EE ACL #201, #199 Recovery and existing PhotoGrant / MediaGrant tests. Distinguish:
- Existing `PhotoGrantTest::test_grant_denies_key_substitution_bad_signature_and_expired_photo`: expires the underlying PHOTO, **not the independent shorter owner-signed recipient grant**.
- Previous own [#387 / Draft #389](https://github.com/1troitsky/photobunker-v3/pull/389) validates already-issued **MediaFile v1** grant exact 1 ms cutoff; it does NOT execute the separate Photo `shares/v1` controller/effective grant ACL. #389 branch remains unchanged and separate.
- Independent real device revoke remains blocked: existing `IdentityController::revoke` is not registered in accepted `routes/web.php`, documented #199; #222 requires security/ownership gate. **Not touched or claimed.**

## Claimed owned paths / no product mutation

1. NEW `apps/api/tests/Feature/P1PhotoGrantExpiryClock393Test.php`
2. NEW `docs/audits/P1-201-PHOTO-GRANT-EXPIRY-CHAT-AB-20261114.md`

No production code, existing `PhotoGrantTest.php`, routes/Identity, storage or shared test/workflows. Exclusive issue #393 CLAIM, branch `qa/p1-201-photo-grant-expiry-chat-ab-20261114`, Draft PR to accepted main (NO merge authorization).

## Acceptance performed by PHP feature test

- Disposable SQL identity accounts A(owner), B(recipient), C(outsider), actual fresh OpenSSL P-256 signers, `identity_devices`, session cookies/Origin, and genuine signed recipient exchange-key directory HTTP.
- Two distinct synthetic encrypted-looking asset objects (`master` and `metadata`) stored in disposable `Storage::fake('ciphertext')`, with real object rows and placement. The **source Photo TTL remains +2 days**; short grant expires after 5 seconds.
- Reject already-expired owner-signed Photo grant at admission: 422 and no persisted grant.
- Issue valid owner-signed personal v1 Photo grant and prove B lists, opens genuine owner-signed manifest and reads **both** ciphertext object routes before cutoff, checking SHA256 and `Cache-Control: no-store, private`.
- At `expiresAt - 1 ms` both objects and signed metadata remain accessible. At **exact signed `expiresAt`**, listing is empty and metadata and both objects reject with HTTP 410.
- Old signed replay cannot re-create expired grant (422); changing `expiresAt` without recomputing P-256 signature rejects 401.
- Fresh owner-signed independent grant permits B but old grant remains denied; C denied 404. Old DB history, photo and both encrypted assets preserved without physical deletion or grant resurrection.
- Test uses real `PhotoGrantController` and effective ACL; no mocked authorize function, secret key or crypto bypass, no arbitrary sleeps/retries.

## Exact HEAD evidence

| Gate | Outcome | Evidence |
|---|---|---|
| Laravel PHP8.4 + PHP8.5 + Composer Audit | PENDING | Foundation |
| Frontend Vitest / TypeScript / build | PENDING | Foundation |
| Security PHP8.4 + PHP8.5 | PENDING | Security |
| UX scope guard | PENDING | UX |
| Real PostgreSQL18 + Garage S3 outage/recovery + Chromium | PENDING | Real storage workflow |

**Limitations:** bytes are synthetically generated for the PHP test; this is NOT a new browser E2EE decryption test, real non-disposable S3, mobile Safari/Android, cross-origin CDN/browser cache, signed URL expiry or full Panic/Remote Wipe/release acceptance. The PG/Garage/Chromium standard workflow runs as regression, not as proof the separate PHP time-travel test ran against Garage. No Stage P1 or parent #201 full acceptance implied.
