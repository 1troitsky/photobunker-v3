# P3 #219 — Recovery Vault verified restore preflight (partial, read-only)

**Date:** 2026-11-14 (Asia/Tbilisi)  
**Agent:** CHAT-C  
**Base:** main at 6565a0fe852882ea5fc26e493df81affed687eee  
**Issue:** #219, in-progress  
**Branch:** feature/p3-219-signed-restore-preflight-20261114  
**Coordination:** #302 START 6864721114, #219 exclusive CLAIM 6864733186

## Verified sources and dependency boundary

Read AGENTS.md, ts.md §§5.1,7.1–7.4,25.2/11/12 and TS_PROGRESS_TABLE.md; GitHub #219 (independent preflight expressly permitted, **full restore not permitted to be declared accepted**), #218 backup-generation producer (still backlog), #189 technical backup start only (review/Draft #246), #203 retention backlog, current main and open PRs.

The base tree has backup admission/lease primitives, NOT an authoritative verified snapshot producer/recovery receipt pipeline, no complete backup ciphertext generation, storage accounting or usable Recovery Vault restore endpoint. For that reason this work is intentionally a **proposed strict v1 boundary contract with real P-256 crypto tests**, not a fake restore from demonstration JSON. Production must reconcile its schema with the genuine #218 producer and current ACL/TTL records, in a separate approved integration.

## Delivered — isolated, read-only component

- NEW apps/api/app/Recovery/RestoreManifestPreflight.php
  - Accepts an externally trusted *active, verified* single-generation receipt and separately pinned account's public P-256 SPKI; **does not derive these from candidate manifest**.
  - Exact SHA-256 hash of submitted canonical manifest must equal the trusted server receipt. Real SHA-256/P-256, domain-separated signature in WebCrypto P1363 format, verified with OpenSSL using pinned server-supplied SPKI; signatures generated in tests with ephemeral keys.
  - Strict bounded, canonical manifest v1 schema and sorted immutable ciphertext entries. Duplicate/extra keys, duplicate/unsorted IDs, malformed P1363 and noncanonical JSON fail closed.
  - Requires requester/manifest/receipt account and selected generation to match. Receipt must be active, state verified and verifiedAt after manifest creation but not future.
  - Re-evaluates each file against separately supplied *current authoritative* owner, explicit restorable flag, tombstone, effective file/retention TTL, expected immutable ciphertext SHA-256 and size. Missing or revoked/mismatched records are **excluded**, never made eligible by a signed old snapshot. This is a plan, not a signed capability.
  - Only returns eligible/excluded ciphertext digests, asset IDs and bounded ciphertext bytes; never plaintext, DEK, Recovery Key, keys or an instruction to write to S3.
- NEW apps/api/tests/Feature/Recovery/RestoreManifestPreflightTest.php
  - Real detached P-256 signature positive/negative tests, different-key/cross-account, generation active/verified, canonical encoding/duplicated JSON, stale/foreign/tombstoned/expired/policy-mismatch, version mismatch, empty inventory, invalid policy and replay to another account.
- NEW scripts/p3-219-restore-preflight-bootstrap.php
  - Isolated dependency-free PHPUnit bootstrap refusing PHP below 8.4.27/8.5.12 and never loading the vulnerable main Composer vendor tree.
- NEW .github/workflows/p3-219-restore-preflight.yml
  - Independent security-floor PHP8.4/8.5 lint and PHPUnit12 negative matrix; **does not suppress the actual Laravel Composer audit** or replace end-to-end acceptance.
- This audit report (new).

## Security and product limitations — NOT COMPLETE

1. **No real verified backup exists in this feature:** #218 must implement actual ciphertext/key envelopes/metadata producer; durable active-generation immutable pointer, loss/failed-update crash handling, reference accounting and independently authenticated receipts. No arbitrary client-provided "verified" status or SPKI may be trusted.
2. **No actual Recovery Key A→B restore:** user authentication, device enrollment/revocation, valid Recovery Key decryption, verified backup download/readback, ciphertext SHA-256 streaming, wrapped DEK verification, encrypted index, merging and Local-First sync not implemented here.
3. **No destructive operation:** no DB writes, file writes, S3 calls, remote deletion, cloud credentials, S3 object links or UI actions. The return value is **not** an authorization token. A future executor must REVALIDATE current server ACL/TTL, signed snapshot, tombstones, user confirmation and byte-level integrity before each restore write, including after retries/lost ACK and after account/policy change.
4. **Expiry/grants:** current owner/TTL/ACL policy must be server-authenticated, not a manifest field or client flag; an unauthenticated caller could forge the preflight's arguments if integrated incorrectly. "Panic" tombstones require their own explicit server-owned distinction, otherwise fail closed; this code does NOT unlock saved data after Panic automatically.
5. **Signed manifest format is PROVISIONAL**, independently introduced for safe testable preflight. No claim it matches eventual producer #218's manifest format or immutable receipt semantics. Production integration requires schema/version/key rotation acceptance and explicit review.
6. Cross-device, wrong/expired grants, file-count/unique-byte quota accounting, original vs safe derivative, live provider outages, heavy files, native iOS/Android and signed revoke + Panic restoration: **NOT TESTED / BLOCKED**.

## Test/evidence

CI results and exact SHA to be appended only after verification on GitHub. The normal Laravel Foundation on base main is blocked by inherited Laravel CVE-2026-128083 (#297 Draft #298 contains separately reviewed lock change). Isolated PHP real-signature tests cannot replace full Laravel/PG18/Garage/Recovery Key/device acceptance.

## Status

Partial signed-manifest, account/TTL/ACL preflight under active development. Issue #219 remains IN PROGRESS; Draft PR is NOT an accepted full feature and must NOT be merged into main without explicit owner approval. Other agents #198/#296 and #211/#301 and their files remain untouched.

## 2026-11-14 — exact-code-head CI acceptance (isolated only)

**Exact production/test code HEAD:** 8264e774b0b06f5b445b27e528e4957b8ae302f2.

- [Dedicated P3 GitHub Actions #43506972095](https://github.com/1troitsky/photobunker-v3/actions/runs/43506972095), **2/2 jobs PASS**.
- PHP **8.4.27**, job **132167050200**: production/test/bootstrap PHP syntax clean, real PHPUnit 12.5.44 **19/19 PASS, 770 assertions**.
- PHP **8.5.12**, job **132167049405**: PHP syntax clean, real PHPUnit 12.5.44 **19/19 PASS, 770 assertions**.
- [P0 Security #43506971947](https://github.com/1troitsky/photobunker-v3/actions/runs/43506971947) **PASS**; [UX lane guard #43506971872](https://github.com/1troitsky/photobunker-v3/actions/runs/43506971872) **PASS**; [Foundation #43506971913](https://github.com/1troitsky/photobunker-v3/actions/runs/43506971913) frontend **PASS**, PHP8.4/8.5 **FAIL before PHPUnit** at unmodified Composer audit --locked: Laravel framework **13.39.0, CVE-2026-128083 / GHSA-63hm-g96r-2m2q**. Separate security #297 Draft #298 owns the lock; did not disable audit or modify Composer. [PG18/Garage #43506971960](https://github.com/1troitsky/photobunker-v3/actions/runs/43506971960) **IN PROGRESS** at observation; that workflow does NOT exercise real Backup Vault restore.

### Truthful acceptance

**PASS:** standalone cryptographic manifest P-256 verification, detached domain binding, signed v1 syntax, *externally claimed* active verified receipt digest/account matching and read-only exclude logic using explicitly supplied policy. Test keys are ephemeral generated in PHP; no production private keys are accessed.

**NOT TESTED/BLOCKED:** independent producer #218, durable snapshot receipt, real A→B device enrollment, Recovery Key decrypt, strict cross-device key policy, real ciphertext bytes/readback, actual grants from DB, S3 restored object, lost ACK, Panic and tombstone classifications, native Safari/Android, real retention billing and dedup. Neither a properly signed manifest nor the module's output proves those conditions exist. No destructive operations.

No main / merge / deploy / shared CI changes. Draft PR needs separate review and the full producer+restore integration before acceptance.

## 2026-11-14 — Signed manifest to real encrypted stream readback (CHAT-C)

Coordination: #302 START 6864973747; #219 exclusive CLAIM addendum 6864978953. No shared routes, Composer, StorageManager, other agents' files or main.

**Exact code and test HEAD before audit commit: 76943f49b3d00774f8a83a2aa5a6f5151c685bfd.**

- NEW apps/api/app/Recovery/RestoreCiphertextReadback.php: hashes ACTUAL binary ciphertext and encrypted key-envelope bytes incrementally with SHA-256; rejects wrong digest, truncated, appended, empty, unreadable or closed streams, mismatched ciphertext lengths, and envelopes larger than a provisional 65536-byte bound. Reads up to 65536 bytes per chunk, no writes/decrypt/network.
- UPDATED own apps/api/app/Recovery/RestoreManifestPreflight.php: inspectAndVerifyReadback authenticates current P-256 owner-signed canonical manifest, independent pinned public key, active+verified generation receipt, exact digest and current ACL/TTL/tombstone policy BEFORE invoking a callback to open streams. Excluded assets are NEVER opened. No unsigned caller-supplied eligible-plan shortcut.
- UPDATED own apps/api/tests/Feature/Recovery/RestoreManifestPreflightTest.php: 10 more tests with genuine P-256 signatures and actual binary memory streams, covering both correct files, unchanged-length tamper, truncation, trailing content, corrupt/empty/oversized key envelope, invalid/closed/wrong-offset resources, revoked/tombstoned/foreign/expired file not opened, no current grants, invalid signature/receipt before any open, provider failures and unsigned hash substitution.
- UPDATED own scripts/p3-219-restore-preflight-bootstrap.php and .github/workflows/p3-219-restore-preflight.yml to load and lint the new class.

**Exact-code-head CI:** [P3 GitHub Actions 43508569126](https://github.com/1troitsky/photobunker-v3/actions/runs/43508569126) **2/2 PASS**. PHP 8.4.27 job 132172516686: **29/29 PHPUnit / 1090 assertions PASS**; PHP 8.5.12 job 132172516112: **29/29 PHPUnit / 1090 assertions PASS**; all four PHP files syntax-clean. [Security 43508569054](https://github.com/1troitsky/photobunker-v3/actions/runs/43508569054) PASS, [UX 43508568715](https://github.com/1troitsky/photobunker-v3/actions/runs/43508568715) PASS. [Foundation 43508568965](https://github.com/1troitsky/photobunker-v3/actions/runs/43508568965) FAIL inherited Laravel Composer audit CVE-2026-128083 (#297 / Draft #298). [PG18/Garage 43508568918](https://github.com/1troitsky/photobunker-v3/actions/runs/43508568918) IN PROGRESS at observation; is not a real backup-restore acceptance test.

**Limitations / NOT ACCEPTED:**
1. Test streams contain real binary bytes, but there is NO actual #218 verified backup producer, durable independently authenticated S3 snapshot or integrated object-store stream provider. The openStreams callback must map account/generation/asset to trusted immutable ciphertext object IDs; preserve TLS peer, no redirects, retry limits, and return a fresh stream positioned at zero. Provider owns streams and closes them.
2. Hash-consistent ciphertext does NOT prove E2EE envelope decryptability, device authorization, Recovery Key possession, or correct restored MediaFile. No Recovery Key / DEK / local decrypted index and no network or object-store access here.
3. Owner/account authorization, effective TTL, tombstones, grants, key epoch, quota and trusted generation must be revalidated at future RESTORE COMMIT, after potentially slow downloads. No S3 write, persistence, atomic generation switching, backup GC, lost ACK, destructive operation or Panic handling.
4. V1 manifest layout and 64KiB envelope bound require #218 compatibility and independent security review. Native Safari/Android and real A-to-B Recovery Key recovery NOT TESTED.

**Verdict:** isolated signed-candidate-to-real-ciphertext/envelope binary integrity check PASS. Full #219 Recovery Vault restore remains IN PROGRESS/BLOCKED. No main modifications or merge/deploy.
