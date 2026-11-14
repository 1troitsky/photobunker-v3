# PB3 P1 #204 / QA child #387 — exact signed MediaGrant expiry at read boundary

**Owner:** CHAT-AB · 2026-11-14 Asia/Tbilisi · **Status:** implementation, CI pending

## Provenance and non-duplication

- Accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b`; no merge authorization.
- Parent [#204](https://github.com/1troitsky/photobunker-v3/issues/204) / prior Draft #255: real lost-ACK, malformed ciphertext and replay exercised. Explicit remaining criterion: an **expired signed grant/session token** with controlled time. This scoped test proves **already-issued MediaFile recipient grant expiry**, and **expired server session age**, not external JWT or raw timed S3 URLs.
- Existing `MediaGrantV1Test::test_three_millisecond_media_grant_clock_boundary_without_ttl_widening()` is read-only and already checks the **upper admission bound**, not transition of an active grant across its lower expiry.
- Code inspected read-only: `MediaGrantController::contract()`, `MediaGrantEffectiveAccess::requireReadable()`, `PhotoSync::actor()` and `PhotoSync::nowMs()`.

## Exclusive scope

1. NEW `apps/api/tests/Feature/P1MediaGrantExpiryClock204Test.php` — actual Laravel HTTP endpoints with fresh P-256 OpenSSL account keys and canonical owner-signed v1 MediaFile grant, genuine recipient exchange directory, real identity session, SQL recipient ACL and fixed Carbon clock.
2. NEW `docs/audits/P1-204-MEDIA-GRANT-EXPIRY-CHAT-AB-20261114.md` — this bounded acceptance record.

NO changes to production controllers, crypto, StorageManager, existing `MediaGrantV1Test.php`, tests owned by other agents, shared workflows, main or foreign branches. Claim [#387](https://github.com/1troitsky/photobunker-v3/issues/387), coordination #302.

## Test case: actual signed grant at millisecond cutoff

- Admission rejects already-expired and precisely-now owner-signed grants with HTTP 422, persists zero grants.
- Legitimate recipient gets grant in `/media-shares/v1/received`, signed manifest/detail and ciphertext chunk read (with digest) before expiry and exactly **1 ms before** cutoff.
- Exactly at **signed `expiresAt`**: listing excludes the grant; detail/manifest HTTP 410; ciphertext chunk HTTP 410.
- Attempt to idempotently recreate an already expired signed contract is 422. Mutating the signed `expiresAt` without owner re-signing is HTTP 401.
- A new distinct, newly owner-signed grant remains valid and lists once, but cannot resurrect the former grant.
- Unrelated account cannot read new grant; server-side identity session issued more than 24 h ago cannot read an otherwise active grant (HTTP 401); valid recipient session can.
- Old grant row and source media remain stored, with unchanged ciphertext bytes; **denial is access control, not destructive deletion**.
- No skips, arbitrary sleeps, fake signature validation, mock actor or changed production clock. Uses a disposable test database and `Storage::fake('ciphertext')` **with synthetic encrypted-looking bytes only**; does NOT claim browser AES-GCM, real Garage network or full server-to-client E2EE.

## Evidence ledger

| Gate | Exact HEAD | Outcome | Evidence |
|---|---|---|---|
| Laravel feature test (PHP 8.4/8.5) | pending | NOT YET TESTED | Foundation workflow, direct test name |
| Security PHP 8.4/8.5 | pending | NOT YET TESTED | Security workflow |
| Frontend Vitest/TS/build | pending | NOT YET TESTED | Foundation workflow |
| PostgreSQL 18 / Garage / real Chromium | pending | NOT YET TESTED | Real storage workflow |
| UX lane | pending | NOT YET TESTED | UX workflow |

**Release boundaries:** physical iOS/Android, native browser E2EE owner/recipient decryption, real user-facing grant expiry UI, clock drift across hosts, signed S3 pre-signed URLs, independently issued JWT token TTL, background scheduler and entire P4 release gate **NOT TESTED**. An isolated QA PASS does not authorize any merge, production activation or release.
