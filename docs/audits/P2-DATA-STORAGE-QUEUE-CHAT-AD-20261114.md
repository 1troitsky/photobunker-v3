# PB3 P2 — Data & Storage: real encrypted local queue and server usage

**Date:** 2026-11-14 · **Agent:** CHAT-AD · **Coordination:** [Issue #165](https://github.com/1troitsky/photobunker-v3/issues/165) scoped [CLAIM #6879946231](https://github.com/1troitsky/photobunker-v3/issues/165#issuecomment-6879946231), [#302 START #6879930555](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6879930555).

**Base:** previously validated [Draft #396](https://github.com/1troitsky/photobunker-v3/pull/396) exact `4c6ed06d8ad850eb48b54c28f4bb11dc01abfd07`, 7/7 GitHub workflows, 96/96 actual Chromium; accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b` untouched. This new child is a user-facing functional slice, NOT full Recovery Vault, S3 redundancy, Data & Storage final acceptance or owner signoff.

## Actual product behavior

- Enables existing **Settings → «Данные и хранилище»** navigation at `/settings/storage`. Uses existing Fieldwork Shell, no duplicate Account or Storage Manager.
- Reads the current authenticated account's real AES-GCM protected Photo Outbox and MediaFile Outbox IndexedDB rows. Computes **ciphertext Blob bytes actually still stored locally**, separately counts `queued/retry`, `conflict`, expired pending and locally synced. Does not decrypt media, log keys or expose plaintext metadata. No destructive cache clearing or forged cloud ACK.
- Authenticated **GET /billing/v1/me** supplies owner-scoped `usage.recordedCipherBytes`, `activeLogicalMediaFiles` and backend-enforced technical byte ceiling. Strictly validates same-session read-only data and matching server snapshot instant with existing verified Entitlement/Grace projection. Figures explicitly marked *read-only, non-atomic*, not physical provider S3 consumption and not upload/paid authorization.
- When offline, server figures are cleared instead of displayed as current, but the local encrypted queue remains accessible. On logout, all current queue and cloud status refs are cleared; late promises cannot repopulate a different session.
- Genuine Browser and queue navigation; clearly states **Recovery Vault backup/restore NOT ENABLED**. No fake backup list, demo quota or placeholder 'delete cache' action.

## Exclusive changed paths

NEW `apps/web/src/features/storage/application/storage-status.ts`, `storage-status.test.ts`, `apps/web/src/views/DataStorageView.vue`, `tests/e2e/p2-settings-data-storage-chat-ad.spec.ts` and this audit.

NARROW owned descendant modifications to `apps/web/src/router.ts`, `apps/web/src/ui/fieldwork/settings-navigation.ts`, `settings-navigation.test.ts` to expose ONE already-WIP Settings item. Previous #216/#362 original branch and its tests remain unchanged; inherited source is already tested via #396. ZERO modifications to backend/Billing, media/photo outbox, crypto, existing E2E or shared CI. Source `ts.md`, UX and canonical progress untouched.

## Acceptance checklist

1. Unit tests: local real ciphertext Blob counts, expired/conflicted/synced separation; corrupt row, missing ciphertext, invalid phase, non-atomic or forged/negative/stale server measurement fail closed.
2. Real Chromium `p2-settings-data-storage-chat-ad.spec.ts` (discovered by existing `p2-settings-*.spec.ts` pattern): signed-out access denial; real Key-Only registration; genuine server Free storage measurement; create authentic AES-GCM Photo outbox while offline (canvas-generated JPEG, no fake media record), see pending count/size, server offline figure hidden; reconnect; logout no decrypted/queue leak.
3. Existing full PHP8.4/8.5+Composer Audit, TS/Vitest/Vite, Security/UX, true PostgreSQL18/Garage2.5 outage/restart and **all previous real Chromium** run on new exact HEAD, no skips/retries/test weakening. Existing P3 checkout/grace/backup-status workflows retained and must PASS.
4. Original upstream/current-main unchanged. No merge/deploy without explicit owner authorization.

**Pending exact-head CI:** do not label review until all checks PASS. Real OS Safari/iPhone/Android, cold-offline PWA, actual Recovery Vault, BYO Multi-S3, payment and push remain BLOCKED/NOT TESTED.

## Initial exact-head CI failure and narrow test-contract correction

Initial exact code HEAD `670aaa33ebfb3c678cf7309739eaba5d17ed2175`: Foundation, Security, UX, checkout, Grace, Backup limits **6/7 SUCCESS**; real PostgreSQL18/Garage2.5/Chromium [run #43612084620](https://github.com/1troitsky/photobunker-v3/actions/runs/43612084620) **FAIL 96/97**. Full decoded original Playwright output: ONLY `tests/e2e/p2-settings-hub-identity-safe.spec.ts:26` expected the old **disabled** `settings-pending-data-storage` label; that no longer exists because this PR correctly enables the actual Data & Storage route. The genuinely new `p2-settings-data-storage-chat-ad.spec.ts` passed in 96. No camera, storage, identity, crypto or server failure found in this run; PG18 quota races and Garage real stop/restart/recovery also PASS.

Under amended exclusive [#165 CLAIM #6880168892](https://github.com/1troitsky/photobunker-v3/issues/165#issuecomment-6880168892), preserve the full original UX Key-Only/Contacts assertions; replace ONLY this obsolete disabled-entry assertion with a stricter requirement that `settings-nav-data-storage` points to the live `/settings/storage` route. All existing E2E assertions remain. Require **entire exact-head full CI rerun**, no skips/retry-for-green.

## Stage 2 — genuine per-file encrypted queue inspection on the SAME Draft #397

**Owner continuation:** 2026-11-14, new scoped [#165 CLAIM #6880397854](https://github.com/1troitsky/photobunker-v3/issues/165#issuecomment-6880397854). Previous `#397@e9c63252bab5c4ad608586c61846d66783ea271f` is full 7/7 EXACT HEAD PASS, **97/97 real Chromium**; this is baseline only, NOT acceptance of the new stage. Accepted main still `8ed66c438d090efd218efa80b027f0b2f854db4b`. No new PR or issue created to avoid fragmentation.

**Product gap:** previous data page merely showed totals and linked to a generic Browser route, so the user could not see which encrypted local files were queued, in retry, conflicted or expired.

**Functional change** (only five OWN existing paths: `storage-status.ts`, `storage-status.test.ts`, `DataStorageView.vue`, `p2-settings-data-storage-chat-ad.spec.ts` and this audit):

- Reads the same account-scoped Photo and Media encrypted IndexedDB rows once. Produces both exact local summary and a **read-only** list of opaque file IDs, true media type, capture timestamp, signed/recorded expiry, actual encrypted Blob byte counts and explicit queue state, *without decrypting names, content, GPS or private metadata*. Synced files are excluded.
- `Открыть очередь` button on real Data & Storage route expands file list with filters **Все / Ожидают / Конфликты / Истекли**, sorted by recent creation, maximum 50 visible per filter and honest overflow note. A filter displays only matching real local entries, never fabricated demo files.
- Correctly isolates `queued/retry` from failed/expired records; rejects missing Blob, malformed file ID, invalid clock or unknown state and clears everything on account change/logout. No automatic upload, no duplicate outbox coordinator, no deletion or cache cleanup.
- New unit tests prove status ordering, filter separation and opaque-only outputs; extended existing **genuine** offline Photo E2E now opens the file queue, sees the actual encrypted row and ciphertext size, checks conflict filter is empty and clears after logout. Prior full suite remains mandatory.

**Exact new-head CI must be rerun across Foundation PHP8.4/8.5+Composer, Vitest/TS/Vite, Security, UX, P3 checkout/grace/backup, real PostgreSQL18/Garage/Chromium.** No skipped tests or retry-for-green. Prior original fail 96/97 on stale Settings Hub assertion remains retained in this audit; corrected 97/97 previous HEAD is a separate baseline.

**Limits unchanged:** app does not yet offer production Recovery Vault backups, physical S3 storage usage, destructive safe cache clearing, iOS/Android device acceptance or verified external payments.

## Stage 3 — manual retry through existing encrypted outboxes (no new uploader)

2026-11-14 owner continuation, new exclusive scoped [#165 CLAIM #6880827946](https://github.com/1troitsky/photobunker-v3/issues/165#issuecomment-6880827946). Source stage2 exact immutable `#397@2131780816b32d61c9c367a044340ce2471f9b61` was independently checked **7/7 workflows SUCCESS, 97/97 real Chromium** (run #43614739402); stage2 read-only queue claim RELEASED #6880792120. All original upstream files and main remain immutable.

**Concrete functionality:** the real local queue exposes an account-session-scoped button **«Повторить отправку ожидающих»**, disabled when offline, unverified session, no actual pending records or an in-flight manual action. The handler reads the current genuine encrypted IndexedDB queue, invokes only EXISTING durable Photo `flushOutbox()` and MediaFile `flushMediaOutbox()` idempotent implementations and then re-reads actual local status. It does **not** send custom requests, start independent schedulers, fabricate server ACK, change signed expiry, delete blobs, clear cache or activate backups. It never promotes a file to 'synced' on UI click.

**Expired Photo boundary:** the existing Photo flush is global and cannot target only live Photo rows. If *any* expired unsynced Photo exists alongside live Photo, the manual action conservatively does **not** call global Photo flush and displays an explicit error. MediaFile may still retry with its core's existing expiry fence. This leaves recoverable ciphertext untouched and avoids accidental manual replay of expired Photo rows. Genuine server/storage TTL remains authoritative.

**Security:** all work requires exact current online Session; a session switch during any read/replay causes fail-closed UI results. Outbox APIs retain encryption, original idempotency and server-authoritative receipt verification. UI states 'attempt completed' rather than claimed success, and shows whether durable pending entries remain. Logout/unmount hides all private queue and retry messages.

**Verification required for this new HEAD, NOT inferred from green previous SHA:** complete PHP8.4/8.5+Composer Audit, Vitest/TS/Vite, Security, UX, all P3 checkout/Grace/Backup workflows and real PG18/Garage2.5/Chromium; no waived tests. New Vitest covers Photo/Media retry eligibility, conflict exclusion, and expired Photo global-flush refusal. Extended genuine Playwright uses a real offline AES-GCM JPEG and blocked *transport only* reserve request (no fake ACK); after removing the failure, button must cause a real signed reserve/finalize, ciphertext S3 readback, independent cloud list and authenticated decrypt of the original JPEG. No test skip/retry-as-pass. First-attempt FAIL evidence, if any, must remain recorded.

**Not implemented:** per-file selective Photo retry, deletion, Recovery Vault, physical iOS/Android, Service Worker background guarantee, full acceptance of #165. No main merge/deploy or original shared outbox modifications.
