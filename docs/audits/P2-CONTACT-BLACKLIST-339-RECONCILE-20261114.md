# #339 — post-#336 Contacts / Teams encrypted local Blacklist reconciliation

Date: 2026-11-14. Owner CHAT-P. Accepted main 8ed66c438d090efd218efa80b027f0b2f854db4b. Source Draft PR #304 immutable HEAD c1a17171348a453167fc99360d01ddb01ee3601d, originally based on main 6565a0fe.

## Strict ownership and provenance

- Read AGENTS.md, ts.md §15.1, §15.2, feature #210, issue #339, all latest #302 START/END and source PR #304. Post #302 START and own #339 CLAIM; do not edit source/foreign PR/main. Two source Vue files still have same blob SHA on accepted main as at source PR fork; two source encrypted blocklist files and the original audit absent from main.
- Exact source from #304 is preserved for the AKEK AES-GCM authenticated local data model, no plaintext ID in Dexie, confirmed contacts picker and user-facing LOCAL-ONLY notice. Original #210 audit retained as historical evidence, not rewritten.

## New integration-only regression fixes

- Original #304 permitted blocked-peer reappearance after add/saveAlias/remove because those handlers re-listed contacts without re-applying blocklist. All mutation paths now re-read authenticated encrypted blocks first and filter before publishing a contact; unreadable blocklist results in fail-closed blank Contacts, not a partial roster.
- Invitation form also re-checks decrypted local block storage at time of signing, guarding against stale selection and same-origin other-tab block after opening the form. It never substitutes for signed server ACL/revoke.
- Existing p1 encrypted-contacts Chromium check for intentionally DISABLED Blacklist is updated to require ENABLED feature, rather than silently dropping a test. A new three-account real Chromium journey verifies trust-confirmed contacts, authenticated IndexedDB content, local block, alias re-list no reappearance, Team invite filtering and offline local persistence.

## Security boundaries and remaining gates

- Local hiding is only a device preference. It does NOT revoke old Team/Assignment/Media grants, recipient keys, device access, server membership or Matrix rooms; even cross-device block synchronization is absent.
- Full #210 Profile 1.6, @username/#UserID lookup and signed server-side block/revoke remain BLOCKED/NOT TESTED; physical iOS Safari/Android and native hardware remain NOT TESTED.
- New integration Draft PR is for review only. No main merge without separate explicit owner permission; no additional source branch changes.

## CI

Post-merge base main push Foundation + Security + PostgreSQL18/Garage/Chromium completed 3/3 PASS on 8ed66c43 (run 43571970279 for real Chromium). Exact integration-head CI and failures to be recorded in PR/Issue after actual run, never inferred from older #304 results.
