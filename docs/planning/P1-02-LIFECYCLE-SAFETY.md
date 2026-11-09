# P1-02 — TTL/GC and interrupted-upload safety

**Status:** implementation submitted to a separate Draft PR, not yet owner accepted. The P1-01 browser flow remains in [PR #5](https://github.com/1troitsky/photobunker-v3/pull/5). No merges into `main`.

## Confirmed design issue and correction

1. **Interrupted uploads must not become garbage while the photo is unexpired.** The first P1 build's `Lifecycle::recoverOrphans()` deleted ciphertext after 24h even for pending photos whose 14-day Free retention had not expired. This is incompatible with Local-First. The new `reconcileStalledUploads()` verifies each stale asset against S3 SHA-256; promotes fully valid assets to `verified`; resets stale `uploading` leases that fail verification to `pending` so the signed client may retry. It **never deletes unexpired ciphertext**.
2. Missing `pending` assets are moved to the back of the bounded scan via `updated_at` to prevent stale records starving newer work. Provider exceptions leave the record unchanged.
3. **Expired photos:** mark via database transaction with row lock and durable tombstone, physically delete each registered location using `StorageManager`, confirm absence before removing any DB asset/placement pointers. Partial provider failure retains records; retries are idempotent. A repeat `mark()` cannot postpone an already scheduled deletion.
4. **Late S3 writes:** after all DB assets are deleted, the tombstone still retains its original opaque physical keys. Every successful `sweepTombstones()` schedules another bounded sweep; unlike the old one-shot behavior, it does not erase the keys and abandon delayed uploads.
5. **Operator gate:** both `pb3:photo-maintain` and the asynchronous `PhotoCleanupJob` require `photo_sync.cleanup_enabled` (derived from `PB3_ENABLE_PHOTO_CLEANUP=true`). The default is **OFF**. Photo lifecycle methods are only callable directly by trusted application code and isolated CI fixtures.

## Tests

- `PhotoLifecycleSafetyTest.php`: SHA-256 valid stale upload recovery, corrupted stale PUT lease release, inaccessible provider without state loss, partial S3 deletion failure plus retry, two late writes after a first successful sweep, and disabled operator gate.
- `tests/integration/lifecycle-garage-smoke.php`: real disposable PostgreSQL 18 / Garage S3 deletion and repeated delayed-object cleanup, with exact CI environment, bucket and database guards.
- Existing P1-01 browser test remains mandatory: offline capture, encrypted outbox, reconnect, cross-device Recovery Key decrypt, unrelated account denied.
- Both supported PHP patch branches and full Vue build/crypto tests must remain green.

## Explicit remaining risks / not yet production authorization

- **Permanent tombstones** are safer than forgotten late writes but require a versioned compaction/inventory policy, capacity bounds and cloud-provider reconciliation before large-scale rollout. The current hourly sweep is a P1 safety baseline, not a proven high-scale design.
- The underlying S3 object key is currently deterministic; proof against indefinitely delayed or reordered concurrent writes needs provider fencing/generation IDs or immutable upload attempts. Correctness after arbitrary writer pause is **not** established by these tests.
- Device sleep/offline queues and browser storage eviction require further mobile testing. Full offline cold start is blocked on signed-release trust design.
- TTL job processing, retention policy transitions, emergency wipe and StorageManager multi-provider recovery still need their own verification; this PR does not claim to close all P1 or P3 security gates.
- No actual customer/user data may be deleted by this PR, and **enablement remains false** until explicit owner approval after the missing lifecycle acceptance gates pass.

### Branch discipline
This is stacked on the exact currently green P1-01 head `55234764da758c6140d97b9abbce2c28126425b4`; base PR #5 is not changed or merged by P1-02.
