# P1-01 — Key-Only Identity → encrypted photo → S3

**Status:** staged implementation, not accepted. Branch `p1/01-identity-encrypted-photo-flow` starts at P0-02 commit `176fd52e`; do not merge to main.

## Source evidence and scope
- Read-only PB2: `Identity/Protocol.php`, `IdentityController.php`, R2-05 `PhotoSync.php` / `Reservation.php` / `Finalization.php` / `PhotoSyncController.php`, identity/photo migrations and focused tests from `319e3bdd`.
- No PB2 compat wholesale import, no passwords/email/phone, no Matrix dependency.
- Existing signed protocol v2 and photo-sync v1 signatures preserved as *technical wire namespaces*, not UI brand text.
- Only **personal photo contract v1** enabled until Assignments/ACL and separate media types exist. No disguised mock endpoints.
- Server enforces unpurchased **Free-only initial limits**: max 14 days / 50 live files / conservative decimal 1 GB; exact GB/GiB commercial policy remains OPEN. Existing quota lock per account serializes reservations.
- Storage has an explicit logical asset location registry (`storage_locations`) and AppS3Adapter through `StorageManager`. New storage providers will not be selected by arbitrary browser paths.
- No secrets, recovery keys or plaintext bytes are accepted by media upload; only ciphertext manifest and opaque bytes.
- Dangerous lifecycle: mark -> durable tombstone -> physical removal per location -> DB cleanup; late write sweeper. **Scheduled GC is OFF unless `PB3_ENABLE_PHOTO_CLEANUP=true`**. Never activate against real data before owner/safety acceptance.

## Acceptance gate
- Identity: first registration, device proof, Recovery Key based new device enrollment, challenge replay, revoked access, origin/CSRF.
- S3: signed reservation, idempotent ciphertext PUT, byte count + SHA-256 readback, finalization, ACL denial, TTL blocked reads, duplicate request, cleanup and orphan reconciliation.
- Local-first browser: capture/encrypt -> durable outbox -> retry -> reload -> cloud receipt -> decrypt on trusted device. Must be tested with real encrypted media across two devices before issue closure.
- CI: Laravel and Vue/TypeScript, isolated PostgreSQL 18/Garage, browser E2E with two identities. No green API-only test can be passed off as browser E2E.

## Not included
- Assignment v2 capture, team grants, photo editing revisions, video/audio, Matrix, backups, billing, remote Panic, BYO S3, signed PWA update.
- This PR remains Draft until **full** browser + backend acceptance is demonstrated.
