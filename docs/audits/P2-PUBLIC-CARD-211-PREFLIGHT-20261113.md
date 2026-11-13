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


## 2026-11-14 — CHAT-B durable STAGED/REVOKED audit ledger (no publication)

### Coordination and exclusive paths
- Shared cross-tab START: [Issue #302 comment 6864030274](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6864030274). Fresh owner-only CLAIM [#211 comment 6864068478](https://github.com/1troitsky/photobunker-v3/issues/211#issuecomment-6864068478) before any code. Other tabs CHAT-A (#198) and CHAT-C (#232) have different scopes.
- Existing Draft #301 still stacks ONLY on #297 security PR #298; no `main` updates, merge, deployment, changes to other agents or shared routes/controllers.
- New `apps/api/database/migrations/2026_11_14_000211_create_public_card_publication_ledger_v1.php`: separate tables for current STAGED/REVOKED heads, append-only signed audit events and never-reused token hashes, with uniqueness on revisions/events. No media FKs: an expired/deleted media row does not delete revocation evidence; nonempty audit down migration fails closed.
- New `apps/api/app/PublicCard/PublicationLedger.php`: verifies actual owner P-256 signed intent using the pre-existing `SignedPublicationIntent`, requires locked real identity account and BOTH active photo media rows, matches the source/safe contract hashes and expiry to trusted data, rejects current media tombstones/archived media; no dependency on client-submitted TTL. Stages one operation only using account-level transaction lock, monotone per-safe revision and unique token reservation. Duplicate signed requests (including ECDSA re-signing) return idempotent state without resurrecting revoked records.
- Owner-signed canonical revocation uses separate `pb3.public-card-revocation.v1\n` domain, checks prior event hash, revision+1, token hash and owner key under account lock; retains original signed audit events; identical lost ACK safe to retry. Revocation still possible after media expiry.
- No branch ever writes `state=published` or returns a public capability/secret/URL: `published=false` even in the success result. SQLite/PG migration enum values explicitly exclude `published`. **These are internal private audit primitives; NOT a public read or authorization service.**
- New `apps/api/tests/Feature/PublicCardGrantLedgerTest.php`: real Laravel SQLite-backed transactional integration, real OpenSSL P-256 signatures, duplicate/lost ACK, revocation replay, token-hash reuse, old signature, stale revisions, tampered account DB status, expired/invalid media records, archived media entry, permanent tombstone and invalid signed revoke.
- Updated ONLY owned `.github/workflows/p2-public-card-signed-intent-211.yml`: full Laravel Foundation PHP8.4+8.5, private preview unit tests and disposable PostgreSQL18 migration plus DB-verified unique token hash.

### Exactly tested code commit and Actions
- **CODE HEAD `0a98a55a540312176ce571e033c4b89b69181e58`**: [owned CI run 43503251582](https://github.com/1troitsky/photobunker-v3/actions/runs/43503251582) **3/3 jobs PASS**:
  - [PHP8.4 job 132154197523](https://github.com/1troitsky/photobunker-v3/actions/runs/43503251582/job/132154197523): `composer validate --strict` PASS, `composer audit --locked` **0 advisories**, full Foundation **296/296 tests, 4,281 assertions PASS**; private preview `SafeCardProjectionTest.php` **19/19 tests, 28 assertions PASS**.
  - [PHP8.5 job 132154196853](https://github.com/1troitsky/photobunker-v3/actions/runs/43503251582/job/132154196853): same **296/296 / 4,281 assertions** and **19/19 / 28 assertions**, Composer validation/audit PASS.
  - [Disposable PostgreSQL18 job 132154197420](https://github.com/1troitsky/photobunker-v3/actions/runs/43503251582/job/132154197420): actual `php artisan migrate --force` across all migrations including new ledger migration **PASS**, confirmed real PG server version 18, new schema exists, duplicate token-hash insertion rejected by real SQL `23505` uniqueness; **PASS**. It is a PG migration/uniqueness smoke, NOT a PG version of every PHPUnit data-race test.
- [P0 security 43503251536](https://github.com/1troitsky/photobunker-v3/actions/runs/43503251536) **PASS** and [UX scope guard 43503251425](https://github.com/1troitsky/photobunker-v3/actions/runs/43503251425) **PASS** on same exact code SHA. **3/3 workflows PASS**.
- Earlier [run 43502693801](https://github.com/1troitsky/photobunker-v3/actions/runs/43502693801) **PASS (293/293 tests on each PHP)** before adding three archive/tombstone/revoke negative tests; [run 43503090090](https://github.com/1troitsky/photobunker-v3/actions/runs/43503090090) **PASS** established PG18 schema earlier. No CI assertions removed or weakened.

### Exact acceptance limits for Issue #211
- **PASS:** private signed canonical intent validation, state transition and idempotent owner-root signed revocation ledger, SQLite feature/integration gates, PG18 fresh migration and DB unique token fence, PHP floor / Composer audit.
- **NOT IMPLEMENTED:** actual flattened EXIF/GPS-free JPEG validation/readback, safely delegated live assignment+file signed policy chain resolver (current ledger accepts a *trusted server snapshot* but cannot independently validate its assignment source), owner-authorized true grant activation, bearer issuance, anonymous no-store URL/API, read-time ACL/TTL/revocation/identity checks, UI integration and Local-First submission/retry outbox.
- **NOT TESTED:** actual concurrent PostgreSQL processes and duplicate publish races; PG18 end-to-end ledger transaction test with independent devices, Garage media bytes, Chromium anonymous browser, iOS/Android physical devices.
- **State: #211 IN PROGRESS / PARTIAL.** Do NOT mark review/accepted, do NOT merge. Future work must not treat STAGED head as a public authorization or enable any anonymous route based on this code.


## 2026-11-14 — CHAT-B independently verified signed Preview ceiling event chains

### Coordination and exclusive paths
- Shared START [#302 comment 6864426853](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6864426853); own exact CLAIM [#211 comment 6864462031](https://github.com/1troitsky/photobunker-v3/issues/211#issuecomment-6864462031). Current main still `6565a0fe852882ea5fc26e493df81affed687eee`. Draft PR #301 remains stacked on unmerged #297 PR #298. #198 Notifications, #210 Contacts/Teams, #230 PWA, #232 BYO S3, and all foreign branches untouched.
- NEW **apps/api/app/PublicCard/SignedPreviewCeilingAudit.php** verifies owner account and ACTIVE source/safe photo pair, TTL, archive/tombstone, the complete 1..100 item P-256-signed media file preview policy event chain, canonical JSON, SHA-256, immutable IDs/contract hashes, previous event links, revision monotonicity, and materialized head equality. For assignments it independently verifies signed immutable root creation policy and read-only signed preview ceiling chain, matching current root hashes, current assignment state, effective retention deadlines, signed event chain and current head. All in existing tables, no extra migration or existing controller/route edits.
- NEW **apps/api/tests/Feature/PublicCardSignedPreviewCeilingAuditTest.php** provides real OpenSSL P-256 signatures and SQLite-backed Laravel tests: valid multiple signed revisions for both file and assignment, owner signature/hash/history tampering, noncanonical/public activation with a *valid* new signature, signed view action escalation, head rollback, wrong account, expired media/assignment deadline and tombstone.
- UPDATED only owned **.github/workflows/p2-public-card-signed-intent-211.yml** to include the new Feature test in PR and push path triggers. Existing full Foundation suite already discovers the new tests.

### Trust boundary
- Existing file and assignment preview contract formats intentionally require **publication=disabled** and all actions including view to be false. A signed ceiling where a field like GPS is marked true is NOT public permission. The verifier returns only private scope, revision, effective expiry, boolean ceiling fields/actions, and fixed disabled/published=false. No URLs, bearer capability, images, GPS coordinates, original or keys.
- Existing assignment root signature is verified and retention state checked, but *signed assignment state/policy amendment history and assignment-to-source media membership are not fully replayed by this audit*. Media original upload signature history is not replayed here either; persisted hashes are checked against signed preview links. Do not use this preview audit as full Public Card ACL proof.
- The earlier STAGED-only PublicationLedger accepts a trusted server snapshot, which cannot safely come from any client. Real public access remains deliberately unavailable until complete assignment/file/public grant intersection, safe flattened EXIF/GPS-free derivative verification, atomic revocation and every-read authorization are fully verified.

### Exact SHA and Actions
- Code SHA **f6369f0dcae2c57f319f04e90e3197eb5379559d**: [dedicated run 43504608036](https://github.com/1troitsky/photobunker-v3/actions/runs/43504608036) **PASS 3/3**. PHP8.4 **304/304 Foundation, 4,470 assertions**; PHP8.5 **304/304, 4,470 assertions**. Private unit **19/19, 28 assertions** on each PHP. Strict Composer validation PASS, Composer locked audit **0 advisories**. Disposable PostgreSQL18 migrations and unique token-hash SQL constraint PASS; **NOT** real multi-process PG acceptance.
- Same code SHA: [P0 Security 43504608106](https://github.com/1troitsky/photobunker-v3/actions/runs/43504608106) **PASS**, [UX guard 43504608247](https://github.com/1troitsky/photobunker-v3/actions/runs/43504608247) **PASS**.
- CI-trigger-only commit **226e7cf0fd6880f1c8be48d0d509a596c1f03948**: [PublicCard 43504766122](https://github.com/1troitsky/photobunker-v3/actions/runs/43504766122), [Security 43504766576](https://github.com/1troitsky/photobunker-v3/actions/runs/43504766576), [UX 43504766455](https://github.com/1troitsky/photobunker-v3/actions/runs/43504766455): **all PASS**.
- Issue #211 remains **IN PROGRESS / PARTIAL**. Public anonymous endpoint, persisted active public grant, safe image bytes, real owner grant policy, UI/outbox, Garage/Chromium public journey and mobile Safari/Android are **NOT IMPLEMENTED / NOT TESTED**. No merge/main mutation.
