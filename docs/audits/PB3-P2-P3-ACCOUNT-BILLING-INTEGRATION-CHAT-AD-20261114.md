# PB3 P2 + P3 user Account integration — combined pre-main evidence

**Date:** 2026-11-14 · **Agent:** CHAT-AD · **Coordination:** [#178](https://github.com/1troitsky/photobunker-v3/issues/178) exclusive new branch/test/report claim and [#302](https://github.com/1troitsky/photobunker-v3/issues/302) journal. **Status at creation:** COMBINED HEAD CI NOT YET VERIFIED.

## Scope and exact source

- Base accepted untouched `main@8ed66c438d090efd218efa80b027f0b2f854db4b`.
- Already tested P2 user-facing [Draft #395](https://github.com/1troitsky/photobunker-v3/pull/395), exact immutable HEAD `ec6281c7896f1daa1824d65f4eb05ff986965685`. 4/4 CI PASS, 95/95 real Chromium, verified #349 Contacts blocked-peer Local-First and #353→#362 encrypted local Notifications Shell UI; no server notifications, OS push, automatic E2EE revocation.
- Independently tested [Draft #351](https://github.com/1troitsky/photobunker-v3/pull/351), exact immutable HEAD `3f491bcd21e1a5c176ef966b734c876134b2787b`, 7/7 CI PASS at its own HEAD. P3 quote/advisory-only backup limits and authenticated read-only plan/grace status; **no true DePay invoice settlement, paid activation, server backup start, or restore**.
- Preflight proved exact 27 #351 changed-path set is disjoint from #395's 41 changed paths. All 27 exact Git blob SHA identities are imported onto new branch with **no modifications to source**.
- This is an explicit source-preserving two-parent commit (first #395, second #351) plus **two new** own-only files: this audit, and `tests/e2e/p2-settings-account-grace-notifications-chat-ad.spec.ts`.
- New genuine Chromium E2E creates a real Key-Only account and requires read-only **server-verified** Free entitlement, switches through actual P2 Notification and Contacts UI, then returns to refresh the server plan. No mock, no paid simulation, no privileged admin or destructive action.
- No files from foreign PRs or main changed, no test disabling, no source branch mutation. SOURCE CI PASS is not proof of combined CI PASS.

## Required exact-head combined QA

- Foundation PHP 8.4/8.5, Composer audit, PHPUnit, TS/Vite/Vitest.
- Security, UX, real PostgreSQL18/Garage2.5/storage outage/quotas/Chromium, including existing 95 and the NEW cross-module test: **96 expected if all discovered**, count must come from actual log. Check for source SHA equality on all 27 imported paths, ancestry of #395 and #351, and inspect original failure traces if any.
- Dedicated P3 checkout/grace/backup status workflows, with true PG18 quote replay/races; do not equate quoted invoice with paid settlement.

## Explicitly blocked

- No DePay on-chain payment verification, callback/reorg/refund or paid plan activation.
- No real Recovery Vault backup start/retry/restore; technical limits are advisory.
- No full Notifications delivery/push/click-through; no automatic revocation from local Contacts block.
- No physical iPhone Safari/Android QA, production data or keys, owner acceptance, or complete P3 release.

**The final verdict belongs only to the exact frozen combined commit after its workflows are complete. No main merge/deploy without separate approval.**
