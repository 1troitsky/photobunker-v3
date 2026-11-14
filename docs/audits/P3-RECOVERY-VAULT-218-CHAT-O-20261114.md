# P3 #218 · Recovery Vault generation ledger — CHAT-O · 2026-11-14

## Scope and version

- Source/main baseline: 5aaba8b0509c354f8abb00806180f4ce6cb6ad18 (security-patched Laravel).
- New branch: feat/p3-218-vault-generation-chat-o-20261114.
- New isolated code: app/Backup/RecoveryVaultGenerationLedger.php, one DB migration, one PHPUnit feature test, a disposable PG18/Garage acceptance runner and a scoped GitHub Actions workflow.
- No existing Identity/StorageManager/BackupAdmission/routing/retention/S3 cleanup code changed. No main merge, deploy, destructive operations or access to user keys.

## Trust and atomicity boundaries

1. A trusted worker must already possess a confirmed, unexpired BackupAdmission start lease for the same ready account. A mere reservation is refused.
2. Only server-derived cipher/backup/v1/{accountUuid}/{generationUuid} keys are accepted. The staged manifest hash and byte length are stored; the ledger never accepts plaintext media or a Recovery Key.
3. Activation reads actual remote opaque bytes through the production StorageAdapter interface and verifies size and SHA-256. Missing, truncated or corrupted manifests fail closed.
4. An account-locked transaction rechecks live lease/generation/replay, retires the previous row, marks the new generation active, and switches the unique account head. SQL failures roll back all changes.
5. The old ciphertext object is not physically deleted by any ledger method. The old metadata remains for separately gated retention/GC. An already activated generation supports lost-ACK replay.
6. A dead/stale stage can be moved to audited 'abandoned' state only after its linked worker lease is no longer live; an active lease refuses release. Account row locking prevents concurrent stage/release switching. No physical deletion of stale candidate bytes occurs (future GC gate).
7. Restore MUST physically reverify manifest hashes; no restore route is implemented here.

## Evidence and limitations

- Authored genuine Laravel feature cases for verified manifest, replay, missing/bad checksum, stale worker, parallel stage, account isolation, failed replacement, successful replacement retaining old bytes, corrupt pointer rollback.
- Initial own Stage1 HEAD `4a3c4d203058331999604c77ce1e4ef8130cb5fb`: 4/4 main-target workflows PASS (Foundation, Security, UX, PostgreSQL18/Garage/Chromium); feature tests used Storage::fake, so no Vault-specific physical S3 proof then.
- Stage2 code/workflow HEAD `fac31ceb5330b56b86ad990965aaa50f1b7da63e`: dedicated real PG18/Garage [Actions 43564182238](https://github.com/1troitsky/photobunker-v3/actions/runs/43564182238) PASS. **12/12 Laravel PHP8.4 PostgreSQL feature tests (49 assertions) PASS**, real production AppS3Adapter / Garage2.5 physical readback integration PASS for missing/valid/corrupt/retry/lost ACK/stale lease/old retained bytes, synthetic fixture only, no keys or real customer files.
- Main-target Foundation [43564182245](https://github.com/1troitsky/photobunker-v3/actions/runs/43564182245) PASS (PHP8.4 and 8.5, TS/Vitest/build); Security [43564182235](https://github.com/1troitsky/photobunker-v3/actions/runs/43564182235) PASS; UX [43564182361](https://github.com/1troitsky/photobunker-v3/actions/runs/43564182361) PASS. Main-target Chromium/PG18/Garage [43564182296](https://github.com/1troitsky/photobunker-v3/actions/runs/43564182296) was still IN PROGRESS during this audit edit; do not claim 5/5 full suite until separately confirmed.
- First new workflow run [43564076275](https://github.com/1troitsky/photobunker-v3/actions/runs/43564076275) failed BEFORE tests due test-only Garage container alias mismatch (launch used new name, later docker exec old name); corrected across all instances. Source failure retained.
- **NOT TESTED**: physical two-independent-PHP-process PostgreSQL lock races, actual Garage stop/restart network outage during Vault activation, immutable manifest object-version/TOCTOU defense, all server-verified signed complete E2EE manifest graphs, real recovery after Panic or mobile devices. Real physical S3 GET/PUT/sha is now VERIFIED but not a complete backup.
- Full client E2EE backup, signed/complete manifest and references, incremental dedup/quota, restore, recovery on a second device, actual native Safari/Android: NOT TESTED.

## Mandatory production gates

- Real authenticated owner/worker integration, device signatures, server-trusted paid entitlements, backup admission limits and quota accounting.
- Signed versioned E2EE manifest and COMPLETE snapshot: media/folders/assignments/key envelopes/reference graph; verify every referenced ciphertext and TTL/tombstone (a manifest checksum alone is insufficient).
- Incremental/dedup blob reference counting, reserved-byte accounting, completed-generation GC without resurrection.
- Real multi-provider/immutable object version or equivalent TOCTOU defense, true physical Garage outage/restart and independent-process PostgreSQL race evidence. Current single-process genuine Garage lost-ACK retry is NOT crash/restart proof.
- Full Recovery Vault restore, Recovery Key client-side decryption, Panic preservation and physical mobile acceptance.
- There is NO public HTTP/UI route and no auto-deletion of old generations in this slice.

Status: INTERNAL SLICE / IN PROGRESS. Full Issue #218 remains OPEN and NOT MERGE READY.
