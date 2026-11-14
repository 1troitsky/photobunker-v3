# P3 #345 · Post-#336 isolated Recovery Vault read-only integration · 2026-11-14

## Scope and evidence boundary

Accepted baseline: `main@8ed66c438d090efd218efa80b027f0b2f854db4b`, after owner-authorized history-preserving PR #336 merge. This new CHAT-U branch imports EXACT six independent source blobs from read-only Draft [#305](https://github.com/1troitsky/photobunker-v3/pull/305) `@9591d7dde54e30ad8b628a0f2527996000ec9772`, with this one new audit file. No source branch, original Issue #218/#219, common routes, StorageManager, web UI, database, backup-generation classes or main branch are modified. Coordination: [#302 START](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6874893280), [#345 CLAIM](https://github.com/1troitsky/photobunker-v3/issues/345#issuecomment-6874917555).

**What is genuinely present:** two pure READ-ONLY PHP helpers. The first verifies a domain-separated real OpenSSL P-256/P1363 signed *proposed* canonical manifest with an independently pinned owner SPKI, independently sourced active verified-generation receipt and fresh file-level owner/TTL/tombstone checks. The second bounds and hashes caller-supplied **encrypted** ciphertext and wrapped-key-envelope streams, rejects wrong bytes, lengths or corruption; invalid/unavailable items are not opened. Neither reaches DB, S3, HTTP, Recovery Key or plaintext. A signature over a proposed manifest is NOT trusted backup creation or proof that that generation physically exists. No public route or real restore is activated.

## Imported code and provenance

| Path | Exact immutable source blob SHA |
|---|---|
| `apps/api/app/Recovery/RestoreManifestPreflight.php` | `3d5ecbc1387cf555d296e5a8ea8393bc489fed60` |
| `apps/api/app/Recovery/RestoreCiphertextReadback.php` | `d6175d01929122b27146d888352cd495c565f170` |
| `apps/api/tests/Feature/Recovery/RestoreManifestPreflightTest.php` | `1f2f959dce0ff42e4c8caad6dc255e06ddf29d9f` |
| `scripts/p3-219-restore-preflight-bootstrap.php` | `aa17639c4500d175b88ea8097bef05051abfe569` |
| `.github/workflows/p3-219-restore-preflight.yml` | `f0ed72e196ded3d6024ed5f17cbeeeaf4a5c5b3f` |
| `docs/audits/P3-RECOVERY-VAULT-219-PREFLIGHT-20261114.md` | `b5a50dff9dfcd28304fb3e9b8cc23704c700bcc6` |

Import is a fresh single-parent commit on the *patched* accepted main. Source #305 is diverged (12 ahead/27 behind); do NOT merge its historical branch or the inherited dependencies. All six paths are absent from accepted main and were read before CLAIM. Source [original exact-head standalone CI](https://github.com/1troitsky/photobunker-v3/actions/runs/43508867246) reported PHP8.4 and PHP8.5 **29/29 tests per runtime**, with real P-256 signatures and binary stream negatives, but this is **source evidence only**, NOT proof of this new integration commit. Verify this candidate's exact new SHA and CI after PR creation.

## Security blocker — NOT an activation

Original [Vault Draft #332](https://github.com/1troitsky/photobunker-v3/pull/332) `@ebf22831a88a30b9d3bc693e29c8b36c033cdbfc` has a VERIFIED negative on **real disposable Garage 2.5**: two native S3 `PutObject If-None-Match: *` calls succeeded and the second distinct byte payload replaced the first. The first stand-alone test was falsely green because an uncaught Laravel exception produced exit code zero; the later corrected [dedicated CI #43566592873](https://github.com/1troitsky/photobunker-v3/actions/runs/43566592873) proves provider conditional-overwrite UNSAFE and default-deny, not an available immutable service. Garage lacks bucket versioning. The untrusted mutable key may change between S3 readback and SQL activation; an application-level hash cannot by itself promise preservation of last verified backup against privileged overwrite.

Therefore **#332 code, generation activation, no-overwrite semantics, true signed verified backup receipt, A→B device/decryption restore, Panic restore, write/restore API and S3 adapter changes are intentionally EXCLUDED**. This integration is only isolated read-only parsing/readback to be reconciled with a future verified producer. Do not run on customer backups or promise protection after Panic; do not infer from green unit tests that immutable Vault exists.

## Exact-head acceptance plan

- Dedicated `p3-219-restore-preflight.yml` on this commit: PHP 8.4.27+/8.5.12+, actual OpenSSL P-256, 29 focused positive/negative signed and ciphertext-stream tests, no route.
- Normal Foundation, PHP on two runtimes, Composer audit zero, TS/Vitest/build, Security, UX and real PostgreSQL/Garage/Chromium regression: **PENDING exact new HEAD** at time of this report.
- Independent provider write-once collision, two real PG workers, failover/outage/lost ACK, genuine authoritative generation+signature provenance, actual S3 readback, revoked device, expired file retention, crypto key restore on two devices, trusted receipt/source schema reconciliation: **BLOCKED/NOT TESTED in this branch**. The negative Garage result remains decisive and must be reverified for any future changed provider/capability.

**Disposition:** Draft PR only; NO main merge/deploy, destructive data, owner approval or full #345/#218/#219 acceptance. Next safety gate: immutable object semantics guaranteed by independent enforced write-once provider contract or another audited architecture with a real *two-writer, two-process, overwrite-negative* test, then trusted signed generator→manifest→new-device E2EE restore under current ACL/TTL and offline recovery.
