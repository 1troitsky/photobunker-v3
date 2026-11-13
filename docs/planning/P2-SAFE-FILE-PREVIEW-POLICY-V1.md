# P2 Safe / Original — signed per-file Public Card PREVIEW ceiling

**Status:** Draft implementation, PRIVATE / PREVIEW-ONLY. Does not publish any Public Card, URL, anonymous token or media key. Parent #107 (server-side signed E2EE `read/safe_read` intersection) is CI verified.

## Grounded product scope

`ts.md` §18 requires future Public Card visibility to be the **intersection** of the signed assignment upper limit, the selected file's own visibility controls, a separately authorized *public* grant, expiry/TTL and allowed media scope. It also marks the public token and key-delivery mechanism, anonymous download rules and multi-file publication **OPEN**. Therefore **do not** implement a public retrieval route or infer public access from a private `safe_read` ECDH recipient grant.

This increment gives the owner a **revisioned metadata-visibility PREVIEW DRAFT** associated with an independently AES-GCM-encrypted, verified local Safe candidate (source photo UUID + distinct derived photo UUID + two immutable signed MediaFile contract hashes). The browser only allows an owner to preview and sign the intended visibility ceiling; it cannot issue actual external access. A "safe" candidate means the owner marked a copy after applying opaque photo blackouts; it does not prove every sensitive region has been removed.

## Contract and authorization

- Account-signature domain `pb3.media-file-preview-policy.v1\n`. Exact canonical JSON, `version=1`, new `operationId` UUID, `accountId`, `sourceMediaId`, `safeMediaId`, **source/safe SHA-256 contract hashes**, `fromRevision` / `toRevision` (+1), `previousPolicyHash` (64 zeros for first revision), `publication='disabled'`, `expiresAt`, boolean `fields` and constant-false `actions`.
- `fields`: `description`, `capturedAt`, `updatedAt`, `tags`, `authorTeam`, `gps`, `metadata`. Defaults **ALL FALSE**. Each true value is *only* a proposed file-level ceiling for an eventual Public Card; no metadata values themselves are stored or released. No auto-GPS/map or source EXIF. Future assignment ceiling, visitor-grant and public transport still have to narrow the result.
- `actions`: `view=false`, `copy=false`, `download=false`, `share=false` are **mandatory at every revision**. Forged `true`, `public`/unknown publication modes or additional keys are **422**; unsigned/wrong account signatures denied; source/safe UUID substitution, wrong media type, hash drift, archive, expired media and out-of-owner file records fail closed.
- **All server routes are authenticated and owner-only:** `POST /media-file-preview/v1/policies` creates a new signed revision, `GET /media-file-preview/v1/policies/{safeMediaId}` returns only that owner's signed policy, revision, hash and `published:false`. There is no public route and no DEK, plaintext media, GPS, EXIF, real filename, anonymous token, recipient key or public URL in any response.
- Revisions are immutable in `media_file_preview_policy_events_v1` and checked against a strict one-head `media_file_preview_policies_v1` pointer. A client-signed `previousPolicyHash` acts as optimistic CAS. A retry with **exactly the same** signed operation ID and payload returns unchanged (Lost ACK); a conflicting revision or tampered signed chain fails with 409. Maximum 100 revisions. Rollback refuses if any signed events or current policy exist, retaining the source-binding security record.
- Backend reads validate active owner account, source+derivative same owner/different photo files, matching MediaFile hashes, live TTL, and non-archived media. Policy expiry cannot exceed **either** MediaFile expiry. A saved draft never creates `media_recipient_grants_v1`, modifies a file's ACL or original ciphertext, changes an assignment, sends a public link, or marks any media as public.
- Browser uses existing account signing key, strict TypeScript parser and a minimal Dexie retry outbox (only signed UUIDs/hashes, booleans and expiry; no plaintext media or metadata field values), blocking a second pending revision until confirmed/conflicted. A queued offline draft is *not* represented as server-approved. On reconnect it retries exactly the signed bytes and verifies receipt hash. A stale or conflicted revision cannot silently overwrite server state.

## Verified behavior to require

- PHP: owner-only retrieval, two signed revisions, hash continuity, strict `published:false`, idempotent Lost ACK, wrong signature/owner, forged public/download/view/copy/share flags, unknown metadata names, no original/media access for other accounts, source/safe hash and TTL mismatches, incompatible media type, archiving and attempted migration rollback.
- Vitest: exact field/action schema, all metadata flags off by default, reject an original/public action, source/safe ID confusion and invalid revisions.
- Real Chromium/PG18/Garage: two independent accounts; owner creates a genuine blackened JPEG while warm offline, encrypts and synchronizes both MediaFiles, signs and stores two private metadata ceilings in Browser UI; non-owner cannot fetch policy or Safe Media without a separately signed ECDH grant; then verify the previous #106–#107 safe-only recipient grant and revocation still work.
- **Not implemented:** Public Card publication; anonymous bearer tokens, key delivery, per-file download or copy grants, actual visitor metadata response, assignment-level public policy intersection, supported safe video/audio, automated pixel-redaction proof. Native Safari/iOS/Android and owner acceptance are still missing. Do not merge/deploy/relabel as ready.

## Release gates

Keep `main` unchanged. Keep this PR Draft even if CI is green; policy drafts do not change the previously closed `OPEN` public-token decision. Matrix remains PAUSED, destructive archive GC OFF, no production external link created.
