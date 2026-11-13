# P1 QA #287 — verified Go/Pro→Free downgrade, immutable paid file TTL and ciphertext safety

**2026-11-13** · child [#287](https://github.com/1troitsky/photobunker-v3/issues/287) · parent [#203](https://github.com/1troitsky/photobunker-v3/issues/203) `backlog`.

## Provenance and scope

- Base is last fully accepted [QA PR #286](https://github.com/1troitsky/photobunker-v3/pull/286) at `de2c63fa5701d88c4fb4929cd571218fb0920a95`, 4/4 exact-head PASS, Chromium81/81 including genuine Go29/Pro89 signed Photo+Media→Garage→decrypt.
- **Exclusive new QA files only**: `apps/api/tests/integration/p1-paid-downgrade-fixture.php`, `tests/e2e/p1-qa-paid-downgrade-retention.spec.ts`, this audit. No production changes, CI alterations, existing test churn, destructive GC, public payment/admin endpoint, or main updates.
- This narrow child is permission to independently test existing code, **not** authorization to solve parent #203's pending security/commercial policy by guessing. The actual Free14/Go30/Pro90 server verified cap and 13/29/89 PWA buffer were developed in #282/#284; no unilateral policy changes.

## Actual test semantics

Each of **two separate real Chromium accounts** is enrolled via real Key-Only session and receives a test-only synthetic paid Go or Pro entitlement using the existing gated fixture from #285 in disposable PostgreSQL 18. The browser then creates and AES-GCM encrypts a Photo and an audio MediaFile, with 29 or 89 days bound to original signed contracts and Photo manifests/Media AAD. It uses actual Laravel signed reserve + Garage ciphertext storage + finalize, and verifies original decrypted bytes.

Next, an isolated process runs NEW test-only `p1-paid-downgrade-fixture.php`, **refusing to execute** unless exact disposable GitHub Actions PG18+Garage env, `APP_ENV=testing`, `SESSION_DRIVER=file`, valid enrolled nonrevoked account and currently verified active paid plan rev2. The fixture calls existing append-only `EntitlementLedger::advanceTrusted(account, free, expectedRevision=2, SHA256(test-event), admin_mfa_approved, now−1 minute, endsAt=null)`. The result is the real immutable server ledger's Free revision 3. Both test output flags `realPaymentExpiryVerified:false` and `realAdminMFAVerified:false`; **NO actual merchant, expiry/grace clock change, operator MFA or administrative authority is tested**. No browser route can activate plans.

The original browser reloads, authenticates same account, reads fresh `/billing/v1/me` and confirms Free rev3, disabled paid privileges and Free14 effective server limit. It must:
- still list and decrypt both *previously accepted* Go/Pro AES-GCM ciphertext objects from real Garage, verifying exact original bytes/private filename before the signed expiry;
- send the original signed Photo/Media reserve contracts again: backend must return existing `active` receipts with unchanged original `expiresAt`, not re-evaluate paid max or allocate another file/bytes quota;
- retain original ciphertext/manifest and prior timestamps, not mutate existing signed expiry or physically destroy it on Free transition;
- create **new** signed Free13 Photo and Media with entirely new ciphertext, upload and read back through the same real signed HTTP/Garage service; both files are listed and decrypt correctly.

This is a safety guard for *existing files under a deliberate trusted plan switch*, not a policy approval allowing perpetual paid-time retention: the original immutable signed expiry remains the absolute ceiling. The server still rejects expired/tombstoned media independently.

## Required full CI and evidence

Require **4/4 exact immutable HEAD CI**: PHPUnit PHP8.4 + PHP8.5 (244 tests, 3651 assertions each on base), Vitest 446 tests, TS/build, Security, UX; full PG18/Garage outage/restart and 5/5 independent two-process quota races; full Chromium **83 tests expected** (81 base + 2 new Go/Pro paid→Free). No test disables, mocking Garage, manual fake success, or retargeting foreign PRs. Preserve any negative results and root-cause fixes on a descendant SHA.

**Remaining NOT TESTED/BLOCKED:** true payment settlement or natural paid expiry/grace (this uses a synthetic trusted Free transition), days/weeks of elapsed time, physical iOS/Android, remote API proxy deployment, signed Unlimited revision/autorenew, post-grace physical GC, backups/replicas and full archive/assignment/public-link TTL intersection. Parent #203 stays `backlog` awaiting owner decision. Child #287 can move to `review` after 4/4 success; no merge to main.
