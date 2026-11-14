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
