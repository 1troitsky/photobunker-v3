# P4 #233 — Storage placement ciphertext preflight (2026-11-14)

**Status: PARTIAL, CANDIDATE READBACK ONLY. No real storage placement switch, no replication, no user-managed S3 registration or credential validation.**

## Source and ownership

- Source of truth: `AGENTS.md`, `ts.md` §§4.4–4.5, 7.2, 25.20, Issue #233.
- Base: immutable verified `main@6565a0fe852882ea5fc26e493df81affed687eee`.
- Exclusive CHAT-H CLAIM in #233; branch `feat/p4-233-placement-readiness-20261114`.
- Exactly six new own paths: `apps/api/app/Storage/Placement/PlacementReadiness.php`, `apps/api/tests/Feature/StoragePlacement/PlacementReadinessTest.php`, `apps/api/tests/integration/p4-placement-real-two-garage-233.php`, `scripts/p4-placement-provision-two-garage-233.sh`, `.github/workflows/p4-placement-readiness-233.yml`, this report.
- No edits to `StorageManager`, `StorageAdapter`, BYO guard #232 / Draft #303, `storage_locations`, `media_chunk_locations_v1`, migrations, `composer.lock`, Identity, routes, production config, existing storage records or user data.

## Read-only behavior

Internal service `PlacementReadiness` verifies a proposed **PhotoObject** or **MediaChunk** source/target pair, using **existing real DB ownership/locations** (no request-side object paths). It requires a ready owner account and active live parent, non-expired TTL, no tombstone, active/verified logical asset, two distinct verified/active registered location IDs and provider names, matching bytes/SHA-256 against the canonical logical object, a separately registered server-side adapter binding with distinct declared failure-domain IDs and positive credential revisions, and **complete physical ciphertext readback with SHA-256 for BOTH source and target**. Missing, short, altered, unverified, foreign-owned, expired, tombstoned or in-flight data fails closed.

After physical readback it checks that the two DB locations have not changed. The return state is explicitly `physical_preflight_only` and `switchAuthorized=false`; **no persistent pointer, replication status, physical write, active grant, account permissions, payment or blob deletion** is changed.

The PHP unit tests use **separate in-memory ciphertext stores** implementing `StorageAdapter`. In addition, the new integration test uses two **real, separate Garage v2.5 Docker processes and real S3 HTTP operations**, as documented below. Both run on a single disposable GitHub Actions VM; this does **not** establish independent physical infrastructure/failure domains or production BYO TLS/credential trust. Real production integration must supply a trusted provider registry bound to genuinely separate credentials, endpoint/TLS pinning and live health/readback receipts. This service is not registered as a public route and cannot be invoked by a client.

A physical preflight is also **not a signed receipt or an atomic promotion permit**. Future actual switch must repeat validation under a versioned/CAS transaction with a concurrent-upload barrier, latest tombstone/TTL checks, trusted receipt/signature and safe rollback. No live primary/secondary promotion code is added in this stage.

## CI and scope of acceptance

- New focused negative tests cover PhotoObject and MediaChunk, cross-account/asset ownership, missing/degraded locations, ciphertext size/SHA corruption, pending upload, expiry, tombstones, unconfigured or same failure-domain providers and a location mutation during a physical read.
- The dedicated CI uses the **read-only audited** #297/#298 Laravel v13.42.0 lock at SHA `60407676c7cb9bdb649f5017cf9450aff25eedab` **only inside a disposable CI checkout**. It enforces PHP8.4.27+/8.5.12+, Composer strict validate/audit (no bypass), full Laravel PHPUnit and focused tests on **real PostgreSQL 18** (by overriding the root forced-SQLite test configuration in a disposable copy). The production branch does not modify `composer.lock`; inherited main security advisory in regular Foundation CI remains an independent #297 integration blocker.
- **Exact code+workflow HEAD `64d30d9824d8473c50d1fdc6b4ec8fef75e57198`**: [PR-triggered scoped run 43542958627](https://github.com/1troitsky/photobunker-v3/actions/runs/43542958627) **3/3 jobs PASS**, and [separate push run 43542951586](https://github.com/1troitsky/photobunker-v3/actions/runs/43542951586) **3/3 PASS**. On patched PHP 8.4.27 and PHP 8.5.12, full Laravel PHPUnit **256/256** (3,704 assertions each), focused placement PHPUnit **11/11** (43 assertions). Real PostgreSQL18 test database with forced-pgsql PHPUnit config **11/11** (43 assertions), physical adapters still synthetic independent in-memory stores. Composer locked audit **0 advisories** with reviewed #297/#298 security lock read-only and local to disposable CI working copies. PHP syntax PASS.
- Other exact tested SHA workflows: [P0 security 43542958649](https://github.com/1troitsky/photobunker-v3/actions/runs/43542958649) PASS; [UX scope 43542958703](https://github.com/1troitsky/photobunker-v3/actions/runs/43542958703) PASS. Standard [Foundation 43542958648](https://github.com/1troitsky/photobunker-v3/actions/runs/43542958648) FAIL inherited #297 vulnerable main Composer lock before PHPUnit; [broader PG18/Garage/Chromium 43542958675](https://github.com/1troitsky/photobunker-v3/actions/runs/43542958675) IN PROGRESS at last evidence checkpoint; NOT claimed PASS. No audit bypass, main/foreign lock edit or merge.
- **Original failures preserved**: initial [workflow 43542814868](https://github.com/1troitsky/photobunker-v3/actions/runs/43542814868) rejected an unquoted YAML job-name colon before running any test; fixed YAML without production code changes. Subsequent [run 43542886013](https://github.com/1troitsky/photobunker-v3/actions/runs/43542886013) found a fixture-only test failure (the prior expiry scenario was not reset before asserting a mid-read account revocation); fixed test isolation on code SHA `64d30d98`, no security check weakened. Later exact-head CI PASS.
- Real **disposable CI-only** distinct S3 credentials/HTTP transport were exercised; production BYO credentials/pinned TLS, true independent cloud infrastructure, completed migration, iOS/Android and full #233 acceptance remain **NOT TESTED**. Physical readiness is not an account or switching authorization.


## Real two-Garage physical fault acceptance — 2026-11-14

**Exact tested product/CI HEAD: `5064428a8d735107d7cec7616f62681ba0b21a88`.** [Dedicated PR workflow 43543861665](https://github.com/1troitsky/photobunker-v3/actions/runs/43543861665) is **3/3 jobs PASS**, independently of the ordinary application Foundation jobs.

The own-only files `scripts/p4-placement-provision-two-garage-233.sh` and `apps/api/tests/integration/p4-placement-real-two-garage-233.php` add a reproducible, tightly guarded CI harness:

- A **fresh PostgreSQL 18** database and two distinct `dxflrs/garage:v2.5.0` Docker processes. Garage A binds S3 on `127.0.0.1:3900`, Garage B on `127.0.0.1:4900`. Each has independent metadata and data volume, RPC secret, Garage node ID, bucket and S3 access credentials. The harness refuses non-GitHub Actions, incorrect PHP app/DB/endpoint/bucket configuration or missing independent credentials.
- It calls **actual `AppS3Adapter` over the Laravel `ciphertext` disk** to reach Garage A. For Garage B, a **test-only AWS SDK `StorageAdapter`** calls a different actual Garage endpoint; neither S3 endpoint is a browser-supplied URL. This is not a production `UserS3Adapter` or secure external BYO transport.
- Random **synthetic ciphertext-like** byte arrays are seeded into both real S3 buckets, and real PhotoObject/MediaChunk row and location fixtures into disposable PostgreSQL 18. No real user media, Recovery Key, customer credential, production cloud or destructive external operation is involved.

**Observed 5/5 PASS** in [exact source job logs](https://github.com/1troitsky/photobunker-v3/actions/runs/43543861665):

1. **Real Garage 1/5:** Photo and Media both read through two real S3 endpoints and the actual `PlacementReadiness::photo/mediaChunk`; SHA-256 and byte counts match; no placement switch.
2. **Real Garage 2/5:** A *same-length* corrupted target object is rejected as `placement.ciphertext_not_verified`; the verified original Garage A object remains readable and correct.
3. **Real Garage 3/5:** A genuinely missing synthetic target object is rejected; the original Garage A byte stream and SHA-256 remain intact. The fixture is restored in CI only.
4. **Real Garage 4/5:** The CI stops **only disposable Garage B**, confirms the secondary S3 request cannot succeed, and observes an explicit fail-closed placement preflight on both Photo and Media while actual Garage A readback remains verified.
5. **Real Garage 5/5:** The CI restarts Garage B using its persistent disposable volume, confirms full actual S3 readback on both logical assets and no changes to the DB location pointers. The test cleans up both disposable containers.

In the **same checked SHA**, the scoped PHP8.4.27 and PHP8.5.12 jobs each ran **256/256 PHPUnit (3,704 assertions)**, the focused Photo/Media preflight suite passed **11/11** with **43 assertions** on true PostgreSQL 18 and both supported PHP versions, and `composer audit --locked` reported **0 security advisories** with a separately audited, read-only security lock from #297/#298 copied **only into disposable CI**. All claims are for the verified code SHA and never for an unmerged release.

**Important trust boundary:** These are genuinely separate Garage processes, S3 namespaces, credentials and disks but on the **same ephemeral runner**. They are NOT two independently operated/cloud-region-separated S3 failure domains; no TLS pinning, user BYO secrets vault, tenant-secure provider binding, durable replica receipts, signed generation CAS, safe concurrent-writer handoff, live switchover, account-visible UX, physical phone acceptance or user ciphertext recovery was accepted. The server-readiness service still returns `switchAuthorized=false`. The synthetic-target deletion/overwrites were only in the isolated CI fixture; there was **no** production object deletion, real-user migration or deployment.

## Verify the retained original during a physical read

The candidate class now re-reads **both location rows and their logical asset/owner status** after both ciphertext streams finish. It refuses a source/target row changed to deleting, a new tombstone, newly expired parent TTL and an account revoked while readback was in progress, even though this preflight never activates anything. These are separate negative tests; note that a future production switch needs an authoritative, persistent CAS/lease gate **again** immediately before promotion.

## Blockers for real #233 placement acceptance

1. Secure BYO S3 network transport, credentials vault/rotation, distinct failure-domain verification and verified real PUT/HEAD/GET/DELETE, dependent #232.
2. Real second provider/replication #234 with durable per-location ACK/receipt, retry and independent checksum/size readback; no use of fictitious `state=verified`.
3. Live StorageManager atomic placement generation / CAS, account-scoped activation, in-flight upload fencing, recovery/revert on partial failure, outbox integrity and original ciphertext preservation.
4. Signed manifest and versioned credential/location IDs; remote physical data checks at actual switch time; safe per-location deletion and tombstones across providers (#236), never delete last verified ciphertext.
5. Product-level fault E2E for 404/timeouts/restart, loss of ACK, concurrent uploads, cloud-independent failure domains and physical iOS/Android storage UX; isolated two-Garage CLI failure/recovery evidence below is not a full product StorageManager/browser acceptance.

**Issue #233 remains IN PROGRESS**. Draft only; `main` untouched, no merge/deploy/destructive operations.
