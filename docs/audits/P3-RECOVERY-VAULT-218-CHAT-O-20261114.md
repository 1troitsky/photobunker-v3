# P3 #218 · Recovery Vault generation ledger — CHAT-O · 2026-11-14

## Scope and version

- Source/main baseline: 5aaba8b0509c354f8abb00806180f4ce6cb6ad18 (security-patched Laravel).
- New branch: feat/p3-218-vault-generation-chat-o-20261114.
- New isolated code: app/Backup/RecoveryVaultGenerationLedger.php, one DB migration, one PHPUnit feature test.
- No existing Identity/StorageManager/BackupAdmission/routing/retention/S3 cleanup code changed. No main merge, deploy, destructive operations or access to user keys.

## Trust and atomicity boundaries

1. A trusted worker must already possess a confirmed, unexpired BackupAdmission start lease for the same ready account. A mere reservation is refused.
2. Only server-derived cipher/backup/v1/{accountUuid}/{generationUuid} keys are accepted. The staged manifest hash and byte length are stored; the ledger never accepts plaintext media or a Recovery Key.
3. Activation reads actual remote opaque bytes through the production StorageAdapter interface and verifies size and SHA-256. Missing, truncated or corrupted manifests fail closed.
4. An account-locked transaction rechecks live lease/generation/replay, retires the previous row, marks the new generation active, and switches the unique account head. SQL failures roll back all changes.
5. The old ciphertext object is not physically deleted by any ledger method. The old metadata remains for separately gated retention/GC. An already activated generation supports lost-ACK replay.
6. Restore MUST physically reverify manifest hashes; no restore route is implemented here.

## Evidence and limitations

- Authored genuine Laravel feature cases for verified manifest, replay, missing/bad checksum, stale worker, parallel stage, account isolation, failed replacement, successful replacement retaining old bytes, corrupt pointer rollback.
- CI: pending exact-HEAD GitHub Actions, not yet PASS.
- Physical two-process PostgreSQL row-lock contention and real Garage S3 bytes: NOT TESTED. The feature tests use Storage::fake('ciphertext') and real Laravel DB.
- Full client E2EE backup, signed/complete manifest and references, incremental dedup/quota, restore, recovery on a second device, actual native Safari/Android: NOT TESTED.

## Mandatory production gates

- Real authenticated owner/worker integration, device signatures, server-trusted paid entitlements, backup admission limits and quota accounting.
- Signed versioned E2EE manifest and COMPLETE snapshot: media/folders/assignments/key envelopes/reference graph; verify every referenced ciphertext and TTL/tombstone (a manifest checksum alone is insufficient).
- Incremental/dedup blob reference counting, reserved-byte accounting, completed-generation GC without resurrection.
- Real multi-provider/immutable object version or equivalent TOCTOU defense, physical Garage/PG18 lost ACK/restart/competing worker evidence.
- Full Recovery Vault restore, Recovery Key client-side decryption, Panic preservation and physical mobile acceptance.
- There is NO public HTTP/UI route and no auto-deletion of old generations in this slice.

Status: INTERNAL SLICE / IN PROGRESS. Full Issue #218 remains OPEN and NOT MERGE READY.
