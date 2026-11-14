# P4 #346 Stage5 — Permanent parent purge fence internal-only integration

**Coordinator:** CHAT-T · **Date:** 2026-11-14 · **State:** Draft, exact-head CI pending. **NOT authorized live purge / cloud S3 delete.**

## Provenance

- Parent accepted main `8ed66c438d090efd218efa80b027f0b2f854db4b`, canonical Git tree `7f2026e3818cae77712d23433475369606f901b0`; no main or shared production path changed.
- Source owner CHAT-M #236 / [Draft #328](https://github.com/1troitsky/photobunker-v3/pull/328) exact HEAD `2b91506e06b9d0c061a9518ea5f22916c6c39bde` old parent `5aaba8b0...` (security patched), original source untouched.
- All SIX original source paths byte-identical Git blobs on new clean accepted-main branch, plus this unique QA report = exactly SEVEN ADD-ONLY paths. No existing code changed. Not stacked on Stage1 #356, Stage2 #359, Stage3 #361, Stage4 #363.
- Current source workflow already uses strict main Composer locked audit with NO historical security checkout override; original test and CI logic preserved unchanged.

## Internal safety contract — no activation

- `LivePurgeFence`: append-only account/Photo-or-Media/parent-ID logical fence. PostgreSQL18 and SQLite immutable UPDATE/DELETE denial triggers, unique fence, account row `FOR UPDATE`, cross-account denial, durable idempotent same-operation Lost ACK replay and conflicting-operation rejection. Marker survives parent deletion; does not contain remote object keys or plaintext.
- `recordAuthorized` is NOT a signed intent verifier. Future privileged caller MUST enforce signed owner/Panic/TTL authorization separately. `isFenced` is NOT an atomic storage writer fence. This internal component performs no S3 writes/deletes, route activation, cron, GC, remote wipe or active account changes.
- Dedicated focused/full PHP8.4/8.5 and actual disposable PG18 independent two-PHP backend race tests with required explicit 4/4 markers remain unchanged.

## Acceptance / blockers

- Evaluate integrated exact new HEAD, PHP8.4/8.5 full and focused, strict Composer audit0, real PostgreSQL18 4/4 immutable/process evidence, Foundation/Vitest/TS/build, Security/UX and physical Garage/Chromium. Historical source green CI is NOT integrated acceptance.
- BLOCKED / NOT TESTED: signed destructive owner/Panic/TTL, real multi-provider deletion, in-flight writer fencing, cross-provider atomic tombstone/GC/resurrection safety, actual Recovery Vault retention, cross-account E2EE A-to-B, independent BYO/replica S3, native mobile Safari/Android. No production feature acceptance or live purge.

## Coordination

- [#302 Stage5 START](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6875212488) and [Stage5 #346 CLAIM](https://github.com/1troitsky/photobunker-v3/issues/346#issuecomment-6875219679).
- No merge/deploy/main/foreign PR modifications, no secrets or customer data.
