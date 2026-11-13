# #210 — Encrypted Local-First Contacts Blacklist (partial P2 acceptance)

Date: 2026-11-14. Agent CHAT-C. Base `main@6565a0fe852882ea5fc26e493df81affed687eee`.

## Preflight and ownership

- Requirements: `ts.md` §15.1 (Contacts and Teams one screen; Blacklist only via header, blocked peer excluded from contact/member selection, unblock does not regrant), §15.2 (Profile remains WIP), §25.7 (real auth/ACL/revoke acceptance); `AGENTS.md`, `TS_PROGRESS_TABLE.md`.
- Current main has fingerprint-confirmed, AKEK-encrypted Dexie contact book; signed Team invitation + owner membership/epoch flows exist already. Full server contact-block semantics / public searchable @handle and eight-digit #UserID do **not** exist in this slice.
- Journal: [#302 CHAT-C START](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6864422975). [Exclusive CLAIM #210](https://github.com/1troitsky/photobunker-v3/issues/210#issuecomment-6864474375). Rechecked journal and claim immediately; no competing direct ownership.
- Other active agents: CHAT-A Notifications #198/PR #296, CHAT-B Public Card #211/PR #301. Security #297/PR #298, own previous Storage #232/PR #303, Signed PWA #230/PR #299 remain isolated. No edit to `main`, others' branches/PR, server ACL/keys, routes/config/CI/TS_PROGRESS_TABLE.

## Implemented in own Draft PR

1. **New `apps/web/src/features/people/application/contact-blocklist.ts`** — local-only AKEK AES-GCM blocks, 12-byte randomized nonce and owner+row-bound AAD; IndexedDB stores hashed identifiers, not cleartext contact ID, alias or key. Validates strict version, row scope and ciphertext; fail-closed on corruption, wrong key/revision or account change; idempotent block and explicit unblock; filtering helper returns only unblocked confirmed contacts.
2. **New `apps/web/src/features/people/application/contact-blocklist.test.ts`** — fake-IndexedDB/Vitest tests for offline readback, encryption/privacy, wrong AKEK, account isolation, row swaps, AEAD corruption, invalid/self peer, idempotency, independent unblock, no network or server-grant side effects, filtering for invitation selection.
3. **`apps/web/src/views/ContactsTeamsView.vue`** — single header `Blacklist` entry, explicit local-only warning, view/undo, contact card local hide with confirmation, suppressed exact UUID lookup/selection for locally blocked peers, no ordinary contact flash if blocklist unreadable. Passes filtered verified contacts into Team panel. Preserves existing Team/Contact one-screen navigation and encrypted Local-First behavior.
4. **`apps/web/src/views/TeamMembershipPanel.vue`** — clears stale selected peer if available contacts change; refuses to sign/send Team invitation if previously selected peer is no longer in the allowed contacts prop, even if UI form is stale.

## Security limits and acceptance

**This is ONLY LOCAL privacy and invitation-selection suppression, not server contact blocking.** Existing signed Team membership, Media grants, recipient E2EE keys, already accepted invites, or plaintext already held by a recipient are untouched. Local unblocking does not recreate grants. Server-authenticated cross-device block ledger, total access revoke, Team DEK rotation/Matrix membership, search by `@username/#UserID`, profile privacy settings, native iOS/Android all remain **BLOCKED/NOT TESTED**. UI displays that existing server rights are NOT revoked. Do not label full #210 PASS or merge without owner's separate decision.

## CI evidence

Exact code HEAD/CI to be recorded after Draft PR and run. Existing PHP Foundation inherits Composer audit CVE-2026-128083 (#297 fix in isolated PR #298); do not suppress audit, change lock, or misattribute unrelated failure. Frontend Vitest/build and E2E must be checked against exact submitted code HEAD; no native device claim.

## Verified exact-code-head CI, 2026-11-14

**Code/tests HEAD: `6eafc2b6011b416752a044f3b68b14c74299ca1c`**.

- First submitted HEAD `00930202ad5069c413c15c064ce30007fcaf1f93` [Foundation Actions 43504925761](https://github.com/1troitsky/photobunker-v3/actions/runs/43504925761): frontend **FAIL 1/458** (457 PASS) due to a flawed negative **test fixture**, not a runtime acceptance: numeric-only UUID did not change when uppercased. Exact failure preserved. Corrected fixture in own test file to include alphabetic hex; not weakened/skipped.
- [Foundation Actions 43505137925](https://github.com/1troitsky/photobunker-v3/actions/runs/43505137925) on corrected HEAD: **frontend PASS**, 84/84 test files, **458/458 Vitest PASS**, TypeScript `vue-tsc -b` PASS, production Vite build PASS (job `132160699229`). Includes **9 local Blacklist tests** covering encrypted offline readback, session/account isolation, AKEK mismatch, row corruption/swapping, no API/network calls and filtered Team picker.
- [P0 Security 43505137847](https://github.com/1troitsky/photobunker-v3/actions/runs/43505137847) **PASS**; [UX lane scope 43505137816](https://github.com/1troitsky/photobunker-v3/actions/runs/43505137816) **PASS**.
- Same Foundation PHP8.4/8.5 jobs **FAIL BEFORE PHPUnit** at `composer audit --locked` due to inherited Laravel `CVE-2026-128083`; separate #297 PR #298 handles security lock and is NOT merged. Not caused by this TS-only PR.
- [PG18/Garage/Chromium 43505137991](https://github.com/1troitsky/photobunker-v3/actions/runs/43505137991) **IN PROGRESS** at this observation; current browser suite isn't a native/blocklist-specific E2E gate.
- Real multi-device sync/Contacts ACL/revoke/Team keys and iOS/Android: **NOT TESTED / BLOCKED**.

**Verdict:** encrypted local-only Blacklist + invitation picker UI slice PASS unit/build/security on exact code HEAD; **overall Issue #210 IN PROGRESS**. Do not merge automatically or describe it as network-side block/revoke or complete P2 Profile.
