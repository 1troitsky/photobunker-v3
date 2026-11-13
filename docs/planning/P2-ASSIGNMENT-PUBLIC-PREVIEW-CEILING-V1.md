# P2 V-14 — independent signed assignment Public Card preview ceiling

**Status:** Draft only. No anonymous public publication, grant, token, media read, metadata output or DEK delivery. Parent #108 owns signed private per-file preview policy and passed 39/39 Chromium.

## Why not reuse the capture policy

Assignment v1–v6 signed capture policies have `requiredGps`, `requiredCategory`, `descriptionMinLength` and tag vocabularies. These are data-collection requirements. **They are NOT authorizations to disclose GPS, tags, description or private metadata to visitors.** `ts.md` §18 explicitly requires two independent upper limits: assignment visibility and file visibility; real public output is constrained by their intersection with a separate public grant, TTL and media scope.

P2 V-14 therefore adds a private owner-signed **assignment visibility ceiling** without modifying any capture policy, file ownership, MediaFile, submission, assignment invite or recipient E2EE grant. `publication='disabled'` and `view/copy/download/share=false` are enforced at every layer. The server still cannot see sensitive field values.

## Signed ceiling and history
- Domain-separated account signature `pb3.assignment-preview-ceiling.v1\n`, exact canonical JSON with `assignmentId`, `ownerAccountId`, immutable signed `rootPolicyHash`, `operationId`, `fromRevision` and `toRevision`, previous SHA-256 policy hash, `expiresAt`, and boolean `fields`.
- Fields: `description`, `capturedAt`, `updatedAt`, `tags`, `authorTeam`, `gps`, `metadata`. All **false** initially; true only expands the *potential assignment upper bound* for a future independently authorized public version.
- Every write checks current owner account, original owner-signed assignment root contract and hash, live assignment **file-access retention**, exact account signature, previous signed revision, signed expiry and retention cap. Max 100 revisions; idempotent retry with exact `operationId` + signed JSON; competing heads rejected. No plaintext assignment title/instructions or file metadata in any row.
- API: authenticated owner-only GET/POST `/assignments/v1/{assignmentId}/preview-ceiling`. GET always `published:false` and only signed metadata flags; no contact lists, filenames, signed ciphertext, GPS values, field values, key grants or public links.
- Storage: a current head and immutable event history, with guarded rollback. A lost ACK can replay the same exact signed bytes; stale/tampered history or unapproved materialized TTL fails closed.
- Browser's separate **Правила → Public Card · потолок видимости задания** section shows owner-only flags and signed draft revision. It is separated from photo recording requirements and regular assignment Save; it uses a Local-First retry outbox without claiming that offline work is cloud-confirmed. Other-account reads/writes denied.
- A future safe asset's local file-preview policy (#108) and this assignment ceiling are *mathematically compared* using boolean AND in an isolated pure function. **The effective public field permissions are still ALL FALSE** even if both upper limits are true. There is currently NO authoritative server-side Photo MediaFile→Assignment submission/attachment proof for P2 Safe JPEGs: earlier `assignment_submissions_v1` stores legacy `photo_records`, while `assignment_media_submissions_v1` only supports video/audio. A nearby assignment ID, file name, folder or client checkbox must never count as authorization to publish.

## Release gating
Still explicitly OPEN and OFF: cryptographically verified association of a P2 Safe JPEG with an assignment (or a clearly distinct owner-signed editorial attachment), an actual server-verified `assignment ∩ file ∩ public grant ∩ media scope ∩ TTL` authorization, per-field sanitized metadata output, public token format/key transport, download/copy permissions and anonymous Public Card. Treat the two ceilings only as *private previews*, not access control grants.

No original DEK, file/assignment ownership transfer, recipient grant, device gallery, source destruction or GC. Previously downloaded plaintext and independently granted original access cannot be recalled. Matrix paused.

## Acceptance checklist

- PHPUnit PHP 8.4/8.5: owner-only strict signed creation, Lost ACK, 2 revisions, source root binding, wrong account/signature, forbidden public flags, extra plaintext input, revision forks, tampered event/head and expiry, retention closure, migration rollback.
- Vitest: all seven fields OFF; exact contract schema, deny publication and any real public field disclosure even after preview ceilings overlap.
- Full Chromium/PG18/Garage: real owner registers, creates encrypted assignment, enters Rules, demonstrates capture GPS requirement does **not** allow public GPS, signs preview ceiling; unauthorized account cannot read; second signed revision persists warm-offline and syncs with actual server receipt on reconnect; zero media grants/public tokens. Existing 39 E2E flows including safe-only ECDH remain passing.
- Native Safari/iOS/Android, real offline iOS PWA, assignment-source proof, final product owner acceptance remain NOT TESTED; all PRs Draft, `main` unchanged.
