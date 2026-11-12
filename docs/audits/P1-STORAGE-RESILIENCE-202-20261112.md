# P1 StorageManager durability / Issue #202 — storage provider circuit & ACK-loss recovery

**Status:** Product Draft; exact-head CI PENDING.  
**Source:** [Issue #202](https://github.com/1troitsky/photobunker-v3/issues/202) / `ts.md` §§4.4–4.5, 21.3–21.4, 25.3/20/25.  
**Base:** verified P2 integrated Product+QA+UX [#187](https://github.com/1troitsky/photobunker-v3/pull/187) @ `7a309508cc140897ae6dd75f8d473a89c7296be2`, **not** old main.  
**Exclusive lane:** `apps/api/app/Storage/**`, `apps/api/database/migrations/*storage_resilience*`, new `apps/api/tests/Feature/StorageResilienceTest.php`, new `apps/api/app/Console/Commands/StorageReconcile.php`, minimal bootstrap and console command registration. **No** MediaV1Controller, PhotoSyncController, MediaLifecycle, client outbox, Camera, ACL/Identity, approved UX source or existing QA #251/#259 modifications.

## Actual product implementation

Existing `StorageManager` is the **one** active transport for legacy Photo/v1 and MediaFile/v1. This change does not introduce a parallel adapter, plaintext server upload queue or new endpoint. All physical read/verify/write/delete/tombstone operations pass through a database-backed `StorageProviderHealth` for `app_s3`.

**Circuit breaker:**
- Healthy calls close/reset the breaker; provider exceptions and false PUT/DELETE count as failures, opening the circuit after 2 consecutive failures for 30 seconds (configurable bounded values).
- While open, S3 calls fail fast with `storage.circuit_open`. A cooldown/expired half-open lease allows exactly one concurrent worker probe (15 seconds). Both state and probe lease survive process restart via `storage_provider_health`.
- The provider health snapshot is internal, account-independent, metadata-only (`provider/state/failures/retry_after_seconds`); no Identity/Camera access, object keys, HTTP body, GPS, credentials, Recovery Key or raw exception text.
- A false `exists`, size/hash mismatch, incomplete ciphertext or missing object is **never** a success or definitive storage outage. Integrity verification stays byte-for-byte SHA-256.

**Opaque durable retry ledger:**
- Before any physical Photo/v1 or MediaFile/v1 PUT, `StorageManager` inserts at most one ticket keyed by (`photo|media`, logical UUID). A crash after a successful S3 PUT but before HTTP ACK leaves this durable reference; no duplicate ticket on retry.
- `StorageRetryLedger::reconcile` leases due tickets across PHP processes, reads **existing** registered placement, verifies actual S3 ciphertext length + SHA-256, then atomically marks it verified only if signed server parent is still `pending`, unexpired, not tombstoned, and the exact chunk hash/size are unchanged. **Neither the parent MediaFile nor Photo becomes `active` and no signed receipt is created**; original client must still perform authenticated finalize. A repeated pass is idempotent.
- Missing or corrupt S3 bytes stay `await_client` with bounded exponential backoff; an old uploading lock may be safely returned to pending after 2 minutes (existing API behavior). **Server cannot resend missing ciphertext without client bytes.** The Local-First AES-GCM client outbox remains authoritative and must retry the original signed PUT.
- Provider exceptions, circuit open, interrupted DB or partial S3 writes preserve pending bytes/placement and reschedule `retry` (never delete an unexpired asset). Old parent/tombstone/finished item is retired safely. Bad placement/provider/ID fails closed; no fabricated ACK.
- Tickets contain only kind + opaque UUID + bounded attempts/lease/next due/disposition, no filenames, object keys, GPS, ciphertext or credentials.

**Running worker:** `pb3:storage-reconcile --batch=1..500` runs a single bounded pass, scheduled every minute through Laravel scheduler by default. `PB3_STORAGE_RECONCILE_ENABLED=false` disables independently of the API and TTL deletion. No new queue broker or destructive cleanup; retries are durable in PostgreSQL. Internal CLI emits only aggregate counters and provider state; it is not a public route.

## QA matrix and explicit boundaries

`StorageResilienceTest.php` (Laravel RefreshDatabase, synthetic ciphertext) asserts:
- Real StorageManager handling of false PUT and durable circuit, one half-open probe after cooldown, no calls when circuit open and health independent of Identity;
- Lost MediaFile S3 ACK with actual complete bytes → single verified promotion, **parent pending + no receipt**, restart through new ledger instance and no duplicates;
- Photo/v1 verified recovery without new plaintext/ciphertext generation, no unexpected parent activation;
- Corrupt full-size encrypted bytes => no promotion and safe await-client backoff; preserve physical contents and release only stale upload lease;
- Durable lease and tombstone prevent late verified resurrection; invalid sweep size rejected;
- Empty S3 stays pending, no server ACK: only client outbox can supply missing bytes.

Independent existing source contract: [#251](https://github.com/1troitsky/photobunker-v3/pull/251) has Adapter/Manager SHA-256/failed DELETE tests on a different branch (not merged); [#259](https://github.com/1troitsky/photobunker-v3/pull/259) independently proves **real** disposable PG18/Garage stop/start, resumed verification, TTL/tombstone in its own QA lane. Do not conflate their individual green runs with this PR's exact-head CI. This Product PR's real PG18/Garage workflow exercises the repository's existing smoke and Chromium test suite.

**Required exact-head CI:** PHP 8.4/8.5 PHPUnit incl new tests, TypeScript/build/Vitest, Security/UX guards, real isolated PostgreSQL 18 + Garage, full Chromium suite. Do not mark `review` until all mandatory checks and any migration/test failures are fixed.

**NOT TESTED / intentionally out of scope:** physical iOS Safari/Android PWA; actual secondary/BYO S3 replication and failover (#232–#236); real production S3 credentials, operator restart/cron; physical disk corruption with multi-provider, full backup restore; unconditionally replaying a PUT the server never received (impossible without retained client ciphertext). Health is provider-specific internal state, NOT a public administrative metric/alert endpoint. No `main` merge/deploy.
