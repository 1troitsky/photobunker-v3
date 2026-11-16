# PB3 P2 — Contacts + Notifications: combined pre-main integration QA

**Date:** 2026-11-14 · **Owner:** CHAT-AD · **Coordination:** [Issue #178](https://github.com/1troitsky/photobunker-v3/issues/178) / [START #6879299441](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6879299441).

## Scope and provenance

- Accepted `main` **8ed66c438d090efd218efa80b027f0b2f854db4b** remains unchanged. This is a *pre-main Draft integration candidate only*, not production/owner acceptance.
- [Contacts/Teams safe Local-First blacklist #349](https://github.com/1troitsky/photobunker-v3/pull/349) exact immutable HEAD `b9d49188a206058603e037751bacde828a5b750f`: eight changed paths. Its contact list and Team picker exclude encrypted locally blocked users; **this does not revoke their server-issued grants or E2EE team keys**.
- [Notifications inbox and privacy ledger #353](https://github.com/1troitsky/photobunker-v3/pull/353) exact immutable HEAD `88ddcccd0f73a7b219c08df49ea132f193447961`: twenty paths.
- [Notifications UI/Shell/Dock child #362](https://github.com/1troitsky/photobunker-v3/pull/362) exact immutable HEAD `a44d8eb5592ba9e505079947a533a1c2b01c0ffb`, parent #353: twelve additional modified/new paths. Child includes parent. Direct merge of child alone is forbidden.
- Preflight proves 8 #349 paths have **zero intersection** with #353+#362's 32 paths, and their original branch HEADs are stable. All three individual source exact-HEAD workflow suites were reported **4/4 SUCCESS** on latest attempts; this is NOT a substitute for running combined exact-HEAD CI. Source owners retain their branches and CLAIMs. No duplicated source versions or old raw #304/#296 heads imported.
- Combined branch imports the eight exact source Git blob IDs of #349 on top of the full #353→#362 tree plus this NEW isolated QA report. Every foreign source path must match its original blob; no changes to shared auth, E2EE, storage, routing outside source #362, workflows, `TS_PROGRESS_TABLE.md`, `ts.md`, `AGENTS.md`, or main.

## Combined acceptance requirements

1. Real P1 existing Contacts and new 3-account encrypted blacklist/Team picker Chromium scenarios on genuine PG18/Garage and current identity sessions.
2. Real Notifications Shell sixth optional Dock, signed-out deny, encrypted local read/unread and nested return; no fabricated server-delivery success or push requests.
3. Full PHP8.4/8.5 + Composer audit, Vitest/TypeScript/Vite build, Security/UX and PostgreSQL18/Garage/Chromium workflows on the **combined commit**, not individual PR Heads.
4. Preserve complete first-attempt FAIL, rerun status, workflow IDs and exact numbers. No skip, Playwright retries-for-green, mock server receipts, browser-private plaintext or test weakening.

## Explicit not-accepted product gates

- No production notification backend producer-to-device feed, authenticated HTTP ACK/ACL click-through, OS push; #198/#216 remain incomplete.
- No automatic revocation of existing E2EE rights on local block; #210 remains incomplete.
- No full physical iOS Safari/Android, cold offline PWA, owner review, Matrix activation, release acceptance #242/#243.

**Decision pending combined CI:** exact-head PASS can justify **review of this integration package only**, not main merge. No merge/deploy without owner authorization.
