# P2 Browser Archive — signed lifecycle and safety gates

**Status:** Draft PR #88, stacked on #87. Not owner-accepted or production enabled.
**Sources:** `ts.md` §§10, 12; existing P1 `Photo\\Lifecycle`,
`Media\\MediaLifecycle`, `Storage\\StorageManager` and `AGENTS.md`.

## Boundaries
The archive is a **server-side logical lifecycle**, not a client-only hidden
row, a physical S3 folder, a new encryption key or a permission grant.

- `GET /browser/v1/archive`: owner-authenticated cursor, real archive
  entries, `writeEnabled`, `autoCleanupEnabled` and physical GC status.
  No filenames, plaintext private notes, GPS or DEKs in responses.
- `POST /browser/v1/archive/actions`: owner P-256 signature over the
  exact version-1 command in domain `pb3.browser-archive.v1`, with
  `accountId`, `writerDeviceId`, `kind` (photo/media), immutable
  `assetId`, `action` (archive/restore/delete), CAS `expectedRevision`
  and globally unique `operationId`. Serialized on the owner account
  and asset rows. Replaying exact signed bytes after a Lost ACK returns
  `unchanged=true`. Different bytes for an existing op ID fail 409.
- Ownership, account/device validity, exact fields, same-origin CSRF,
  signature, state and unexpired asset TTL are checked on EVERY mutation.
- Archive is restricted in this slice to **own standalone assets with no
  assignment submission and no historical sharing grants**. Current
  share/assignment safety invariants and FK constraints take precedence over
  the archive UI. The client receives a real conflict, not fake success.

## State and deadlines

```text
active  → owner-signed archive → archived until min(file_expires_at, now+7d)
archived → owner-signed restore (before BOTH deadlines) → active
archived → owner-signed permanent delete → deleting + immutable tombstone
archived → separately gated due-date sweeper → deleting + immutable tombstone
deleting → separately gated P1 physical GC → every location verified absent
         → source DB rows removed; tombstone + audit entry retained
```

Archive does **not** change a photo/media `expires_at` or provide extra
retention. Source tables keep original ciphertext locations. The owner
active-list query excludes archived assets. New grants and revisions
linking archived media are blocked by the server. `restore` cannot
reverse a tombstone, outlive the file TTL or bypass an assignment deadline.

The archive index distinguishes `pending_gc` from `verified_absent`.
The latter is reported only when the P1 lifecycle has already removed the
source record after StorageManager's per-location absence checks. This
does not mean late writes are impossible: permanent tombstones and bounded
late-write sweeps remain required.

## Operator gates (default OFF)

- `PB3_ENABLE_BROWSER_ARCHIVE=false`: all archive mutations disabled.
  GET may still enumerate existing archive state for an authenticated owner.
- `PB3_ENABLE_ARCHIVE_AUTO_CLEANUP=false`: no automatic day-seven sweep.
  The Artisan command `pb3:browser-archive-maintain` requires **both**
  flags to be explicitly enabled. The console scheduler registers it only
  when both environment flags are enabled.
- `PB3_ENABLE_PHOTO_CLEANUP=false` and
  `PB3_ENABLE_MEDIA_CLEANUP=false`: separate, independent P1 physical
  cleanup workers. The Browser archive maintenance command **does not call
  S3 delete** and never falsely asserts a physically deleted asset.
- The disposable PostgreSQL/Garage Chromium CI job alone explicitly enables
  signed archive mutations; no production database reset, server scheduler
  switch, or real storage deletion is authorized by this Draft.

## QA scope and unaccepted work

Focused API tests: owner signature/CSRF/device isolation, same signed replay,
CAS race, restore cutoff, 7-day cap, encrypted photo/media tombstone marking,
gated archive maintenance, non-destructive rollback and refusal of old grants.
Chromium E2E: genuine encrypted media upload, archive→restore→delete and
acknowledged `pending_gc`. Keep the exact SHA and evidence in the PR.

Still **not accepted**: safe owner-only archive of items previously shared or
submitted to assignments (requires grant and submission lifecycle design),
profile-controlled archive preference and per-account automatic cleanup, full
bulk operations, verified cross-provider S3 deletion / replicas (future Storage
Manager), signed retention changes, browser/native Safari device acceptance.
`delete` in this slice does not claim GC has finished.


## A-04: Owner archive preferences (Draft #91, operator-gated)

`GET /browser/v1/archive/preferences` returns the authenticated
account's authoritative revision, `useArchive` and
`autoDeleteAfter7Days`. Both product preferences default **true** as
required by `ts.md §10.2`. The same response separately exposes operator
`writeEnabled` / `autoCleanupEnabled`, which remain **false** by default.
User toggles can NEVER enable these operator flags or physical S3 GC.

`POST /browser/v1/archive/preferences` requires a P-256 owner-account
signature over the exact, canonical contract in domain
`pb3.browser-archive-preferences.v1`, containing account/device ID,
operation ID, expectedRevision and the **two booleans only**. DB is
account-locked, CAS monotonic, with an immutable operation ledger and
idempotent signed Lost ACK replay. Multiple devices may set preferences
but never silently overwrite a newer signed revision.

The Browser has a device-key AES-GCM encrypted Local-First preferences
cache/draft/outbox in IndexedDB. Offline edits stay visible as
**unconfirmed** and cannot authorize physical, archive or direct-delete
operations until authenticated server receipt. Network or CAS failures
preserve the original signed outbox; explicit action to accept remote
state only applies to an unsigned local draft, not a potentially executed
signed request.

| Preference | Owner action | Independent safety constraint |
| --- | --- | --- |
| Use archive ON | Owner-confirmed standard delete requests archive | Backend must have archive write gate enabled; no assignment/recipient grants |
| Use archive OFF | Owner-confirmed, account-signed **direct delete** allowed on standalone active/restored owned files | Backend write gate still required; P1 tombstone and physical GC separate; archived entries are NOT purged or hidden |
| 7-day auto-delete ON | Signed archive action sets deadline to min(current asset TTL, seven days); reenable adds deadline capped by current asset TTL | Background sweeper remains operator OFF until independent acceptance |
| 7-day auto-delete OFF | Current archived entries lose only OPTIONAL archive day-7 deadline, including newly archived items | Original asset TTL and assignment policies are never extended or disabled; P1 expiration independently continues |

The archive tab remains accessible even with Use Archive OFF; merely
changing a preference **never deletes existing ciphertext**. All irreversible
deletes require a separate owner-signed and confirmed command. Backend
source paths / DEKs / grants / cleanup-worker gates remain unchanged.

Independent physical-device acceptance, real multi-location GC and
cross-provider backup policies are still release blockers. A preference
sync is **not** evidence that objects were deleted from S3.
