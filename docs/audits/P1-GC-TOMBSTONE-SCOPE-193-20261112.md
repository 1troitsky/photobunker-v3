# P1 GC / Issue #193 — tombstone ownership, crash recovery and non-resurrection

**Product Draft, exact-head CI pending.** Preflight/CLAIM logged in [Issue #193](https://github.com/1troitsky/photobunker-v3/issues/193).  
**Base:** verified integrated [#272](https://github.com/1troitsky/photobunker-v3/pull/272) @ `189ee19e4c81fb0f41339e252a58c51c187340c0`: 4/4 PASS, 78/78 Chromium, 219/219 PHPUnit PHP8.4/8.5, real Garage S3 outage/restart from #271. **Not main**.  
**Exclusive product files:** Photo/Lifecycle, Media/MediaLifecycle, new pure Storage/TombstoneKeyScope, new TombstoneIsolationTest, this audit. No storage adapters, signed ACL, S3 endpoint, client E2EE, tariff, scheduler, `docs/ux` or another PR touched.

## Pre-existing safe foundation — not recreated

Both Photo v1 and MediaFile v1 already have permanent tombstones with immutable S3 key lists; S3 delete and independent existence checks through centralized StorageManager; pending-upload recovery; bounded batch scheduled maintenance; a real Garage stop/restart fault matrix; signed-client read/write bounds; and separate **operator opt-in** physical GC switches, **OFF by default**. `StorageRetryLedger` already verifies incomplete/lost-ACK uploads without inventing a finalize receipt. These are preserved, not reimplemented.

## Confirmed GC safety gaps closed

1. **Cross-account destructive tombstone confusion:** previously `Photo/Lifecycle::sweepTombstones` and `Media/MediaLifecycle::sweepTombstones` accepted any syntactically valid `cipher/v1/*`/`cipher/media/v1/*` key stored in a tombstone. A bad/legacy DB row with a foreign account's valid ciphertext key could delete that account's LIVE private file. New `TombstoneKeyScope` binds every key to **exact accountId+photoId/mediaId**, canonical UUID and transport namespace. Rejects oversized/malformed/duplicate keys, and **validates the entire list BEFORE the first physical DELETE**, so a mixed valid+foreign list cannot partially clean anything. No key logging.
2. **Missing tombstone on previously `deleting` parent:** before, `mark` returned immediately on deleting, so legacy/aborted transition with no tombstone allowed cleanup to erase all registered DB pointers without any future late-write S3 sweeper. Both lifecycles now ensure an immutable tombstone exists **before** physical deletion, including already-marked records. `Photo` safely repairs legacy `object_keys=NULL` using still-registered placement rows. Existing operation/account scope mismatches fail closed. Existing cleanup lease isn't postponed.
3. **Changed placement after mark:** before physically deleting, GC now verifies registered key ownership and checks every current placement was captured by the tombstone. An untracked foreign/migrated placement cannot be deleted and lost from all future reconciliation. The parent remains `deleting` with durable pointers for operator remediation; no implicit resurrection. Future BYO/replica placement requires an explicitly reviewed provider-aware extension.
4. **No automatic deletion of unexpired content:** cleanup enabled flags and every-minute operator schedules unchanged and default OFF; no direct S3 listing, global bulk orphan sweep, backup ref mutation or destructive migration. Existing failed DELETE/503 leaves pointers/tombstones for retry. Failed sweeps do not advance due time or fabricate a successful count.

## QA matrix — new regression tests

- **Photo and MediaFile × mixed owner+foreign tombstone:** original and victim real fake-S3 ciphertext survive denied sweep; due timestamp unchanged, subsequent corrected same-owner tombstone can remove only its own ciphertext.
- **Both types × legacy `deleting` without tombstone:** full cleanup creates durable owner-scoped tombstone first, removes physical ciphertext, repeat late write is deleted by independent subsequent sweep.
- **Both types × foreign placement after mark:** physical deletion refused before any DELETE; owned and foreign S3 bytes survive and parent remains `deleting`.
- **Both types × operator default-OFF:** maintenance refuses and untouched unexpired pending ciphertext remains retrievable.
- Existing full PHP8.4/8.5, TypeScript/Vitest/build, security/UX, real isolated PG18/Garage outage/restart, TTL/tombstones and Chromium E2E must remain PASS **on exact final HEAD**. Do not weaken assertions, retries, CI or test selectors.

## Honest remaining gaps

The current `StorageAdapter` supports key-addressed put/read/delete, NOT bucket listing or provider inventory. **Unregistered physical orphans** (DB reference absent but S3 object present after a highly unusual crash/DB corruption) cannot be safely enumerated or deleted, and no untrusted bucket-wide delete is introduced. Verified backup reference accounting/replica placement, physically interrupted delete during the specific new scope guard, production scheduler opt-in, mobile iOS/Android and actual compromised PostgreSQL integrity are NOT TESTED. These remain independent acceptance requirements; a green unit+Garage baseline does not prove multi-provider orphan GC. No merge into main or deployment.
