# P0 — source provenance and selective reuse

**Immutable evidence:**
- PB2 root backend: [`apps/api` @ 319e3bdd](https://github.com/1troitsky/photobunker-new/tree/319e3bdd82e4640c385b42e7f32608bdc3add880/apps/api).
- Accepted frontend catalogue: [PR #56 @ daca24a4](https://github.com/1troitsky/photobunker-new/tree/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux).
- The historical `compat/assignment-release` code is **not** PB3's backend foundation.

| PB3 destination | Read-only reference | Selective reuse / required work |
| --- | --- | --- |
| Identity / key-only account | `apps/api/app/Identity`, `IdentityController.php` | Audit challenge/proof, recovery envelope and device lifecycle before port; retain compatibility for encrypted data |
| Encrypted media sync | `apps/api/app/Photo` / `PhotoSyncController.php` | Reuse reserve/upload/verify/finalize and idempotent receipts; generalize photo-only assets to photo/video/audio |
| Storage Manager | `PhotoSync.php`, `Lifecycle.php`, direct `Storage::disk` calls | **Do not copy direct-provider access** into controllers/jobs; introduce provider contract, location registry and repair/GC |
| TTL + cleanup | `PhotoMaintain`, `PhotoCleanupJob`, `PhotoAssetCleanupJob` | Preserve actual scheduler/GC mechanisms; extend all placements; test tombstones and short TTL cases |
| Gallery / sharing | `GalleryController.php`, `PhotoRecipientController.php` | Preserve cursor paging concept; complete two-account key envelopes/ACL before enabling cross-account preview |
| Assignments/teams | `Assignments`, `Collaboration`, controllers | Avoid unbounded snapshots; server-side permissions; expand typed media/progress |
| Fieldwork Vue screens | PR #56 `docs/ux` accepted HTML and README contracts | Reimplement as reusable Vue views/store; mock JS is not domain logic |
| Matrix & E2EE | `docs/ux/messages` Fieldwork 1.1 | Real independent Matrix transport, room/device-key lifecycle and E2EE; **new production code** |
| Backups, billing, admin, signed PWA | `ts.md` | **New domains**; no production implementation can be inferred from mock UX |

**Known baseline risks:** PHP parse errors in PB2 `routes/web.php` need fresh verification, existing CI doesn't lint every PHP path, old quota constant doesn't model plans or backups, no full Recovery Vault, incomplete cross-account sharing. Do not reproduce these defects.

**Migration safety:** no wholesale merges, no destructive migrations, no plaintext media exports, no user-data migration until backup + rollback rehearsal and explicit authorization. Record each adopted source path and contract in its PR.
