# P4 #233 — Storage placement ciphertext preflight (2026-11-14)

**Status: PARTIAL, CANDIDATE READBACK ONLY. No real storage placement switch, no replication, no user-managed S3 registration or credential validation.**

## Source and ownership

- Source of truth: `AGENTS.md`, `ts.md` §§4.4–4.5, 7.2, 25.20, Issue #233.
- Base: immutable verified `main@6565a0fe852882ea5fc26e493df81affed687eee`.
- Exclusive CHAT-H CLAIM in #233; branch `feat/p4-233-placement-readiness-20261114`.
- Only four new paths: `apps/api/app/Storage/Placement/PlacementReadiness.php`, `apps/api/tests/Feature/StoragePlacement/PlacementReadinessTest.php`, `.github/workflows/p4-placement-readiness-233.yml`, this report.
- No edits to `StorageManager`, `StorageAdapter`, BYO guard #232 / Draft #303, `storage_locations`, `media_chunk_locations_v1`, migrations, `composer.lock`, Identity, routes, production config, existing storage records or user data.

## Read-only behavior

Internal service `PlacementReadiness` verifies a proposed **PhotoObject** or **MediaChunk** source/target pair, using **existing real DB ownership/locations** (no request-side object paths). It requires a ready owner account and active live parent, non-expired TTL, no tombstone, active/verified logical asset, two distinct verified/active registered location IDs and provider names, matching bytes/SHA-256 against the canonical logical object, a separately registered server-side adapter binding with distinct declared failure-domain IDs and positive credential revisions, and **complete physical ciphertext readback with SHA-256 for BOTH source and target**. Missing, short, altered, unverified, foreign-owned, expired, tombstoned or in-flight data fails closed.

After physical readback it checks that the two DB locations have not changed. The return state is explicitly `physical_preflight_only` and `switchAuthorized=false`; **no persistent pointer, replication status, physical write, active grant, account permissions, payment or blob deletion** is changed.

The transports used in tests are **separate in-memory ciphertext stores** implementing the existing `StorageAdapter`. Their declared failure-domain labels are fixtures, **not independent third-party S3 evidence**. Real production integration must supply a trusted provider registry bound to genuinely separate credentials, endpoint/TLS pinning and live health/readback receipts. This service is not registered as a public route and cannot be invoked by a client.

A physical preflight is also **not a signed receipt or an atomic promotion permit**. Future actual switch must repeat validation under a versioned/CAS transaction with a concurrent-upload barrier, latest tombstone/TTL checks, trusted receipt/signature and safe rollback. No live primary/secondary promotion code is added in this stage.

## CI and scope of acceptance

- New focused negative tests cover PhotoObject and MediaChunk, cross-account/asset ownership, missing/degraded locations, ciphertext size/SHA corruption, pending upload, expiry, tombstones, unconfigured or same failure-domain providers and a location mutation during a physical read.
- The dedicated CI uses the **read-only audited** #297/#298 Laravel v13.42.0 lock at SHA `60407676c7cb9bdb649f5017cf9450aff25eedab` **only inside a disposable CI checkout**. It enforces PHP8.4.27+/8.5.12+, Composer strict validate/audit (no bypass), full Laravel PHPUnit and focused tests on **real PostgreSQL 18** (by overriding the root forced-SQLite test configuration in a disposable copy). The production branch does not modify `composer.lock`; inherited main security advisory in regular Foundation CI remains an independent #297 integration blocker.
- **At initial report creation, exact-head CI is NOT TESTED.** Record evidence only after actual workflows finish. Do not claim S3 replica, network, user credentials, iOS/Android, or a full P4 gate PASS.

## Blockers for real #233 placement acceptance

1. Secure BYO S3 network transport, credentials vault/rotation, distinct failure-domain verification and verified real PUT/HEAD/GET/DELETE, dependent #232.
2. Real second provider/replication #234 with durable per-location ACK/receipt, retry and independent checksum/size readback; no use of fictitious `state=verified`.
3. Live StorageManager atomic placement generation / CAS, account-scoped activation, in-flight upload fencing, recovery/revert on partial failure, outbox integrity and original ciphertext preservation.
4. Signed manifest and versioned credential/location IDs; remote physical data checks at actual switch time; safe per-location deletion and tombstones across providers (#236), never delete last verified ciphertext.
5. Real fault E2E for 404/timeouts/restart, two independent S3 endpoints, lost ACK, concurrent uploads and physical iOS/Android storage UX.

**Issue #233 remains IN PROGRESS**. Draft only; `main` untouched, no merge/deploy/destructive operations.
