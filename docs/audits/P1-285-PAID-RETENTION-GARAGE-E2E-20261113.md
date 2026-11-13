# P1 QA #285 — real Go/Pro Chromium→Laravel→Garage paid signed TTL acceptance

**2026-11-13. Evidence awaiting final exact-head CI.** Child of gated [parent #203](https://github.com/1troitsky/photobunker-v3/issues/203); no unresolved policy rewritten or granted. Ordered descendant of verified [Draft PR #284](https://github.com/1troitsky/photobunker-v3/pull/284) @ `e4acbb571937f22658cb049e4a00435e3def3f1f` (4/4 CI PASS, original Chromium79/79, PHP244, Vitest446, real PG18/Garage). Earlier Free browser proxy QA did not prove paid browser S3 journey.

## What is new

All changes strictly **QA-only** and additive:

1. `apps/api/tests/integration/p1-paid-browser-entitlement-fixture.php`: deliberately isolated CI-only tool, NEVER a public endpoint. Requires exact `GITHUB_ACTIONS=true`, `PB3_ISOLATED_STORAGE_SMOKE=1`, `APP_ENV=testing`, PG host=127.0.0.1/db=pb3_ci_p0, Garage endpoint=127.0.0.1:3900/bucket=pb3-ci-p0, session=file and migrated schema. Refuses any other environment or non-fresh/non-enrolled/revoked account, accepts only synthetically verified Go/Pro and rev1 Free head. Calls existing `EntitlementLedger::advanceTrusted` with a **TEST-ONLY event hash**, no real settlement proof; outputs `realPaymentVerified:false`.
2. `tests/e2e/p1-qa-paid-retention-garage.spec.ts`: two independent live Chromium, Key-Only PWA registrations. Read real Free rev1. Test-only PHP process activates verified test Go/Pro rev2. On reload new authenticated browser fetches `/billing/v1/me` through real same-origin proxy and creates **new AES-GCM Photo and audio MediaFile** from synthetic MIME-labeled bytes; verifies Go29/Pro89 signed `expiresAt`, every Photo manifest, Media contract AAD, E2EE-only local blobs, **real authenticated signed reserve, S3 PUT, finalize and cloud list via unchanged backend**. Independently read back ciphertext through Laravel/Garage and decrypt with client keys, verify all byte values and private filename. Re-send the *same signed contracts* as an HTTP Lost-ACK replay, verify actual active receipts and unchanged signed deadlines.
3. This audit. No production PHP, Vue, TypeScript, test modifications, CI workflows or destructive schedulers changed. The existing Chromium suite automatically discovers additional `p1-*.spec.ts` tests without modifying its configuration.

## Acceptance criteria

| Assertion | Evidence required |
|---|---|
| Authentic Go/Pro plan rather than client-provided plan | Browser enrolment Free rev1, CI-only genuine PG ledger transition, same-origin authenticated readback of verified Go/Pro rev2, immutable snapshot hash and server limit 30/90 |
| Local-First and E2EE | Photo and Media crypto executed in actual Chromium; signed content expiry Go29/Pro89; encrypted IndexedDB outbox, exact Photo asset manifests, only ciphertext to server |
| Real storage | Real Garage 2.5, live PG18 and Laravel API; signed reserve, object/chunk PUT, finalization, account-scoped list, decrypt-from-cloud original bytes |
| Idempotence and no extension | HTTP replay of original device-signed contract after finalization returns active receipt, exact original `expiresAt`, no extra quota charge |
| Isolation | Distinct accounts across Go/Pro; fixture refuses non-CI/different DB and any non-fresh identity, no HTTP route or actual checkout |
| Regression gate | All 4 original GitHub Actions workflows PASS on immutable HEAD: PHP8.4+8.5, Vitest TypeScript/build, Security, UX, real PG18/Garage fault matrix + 5/5 independent quota races, Chromium including both NEW E2E and existing suite |

**Not proof:** production payment/settlement, real 29/89 elapsed-day retention, physical iOS Safari/Android PWA, default operator deployment ingress, certificate/time authority, user-visible retention chooser, Unlimited+ auto-renew, post-grace GC/re-signing, cross-device sharing or real camera/microphone sensor recording. Synthetic photo/video/audio bytes are intentionally not media-device captures. Existing bytes in Garage represent authenticated E2EE ciphertext; no plaintext media is stored server-side.

## Hold/ownership

The parent #203 remains `backlog` while minimum short TTL, owner-approved Unlimited renewal/grace and irreversibly destructive retention migration are OPEN. This QA child does not change those policies, storage GC or `main`. Its only intended disposition is independent `review` after 4/4 PASS, Draft PR remains unmerged.
