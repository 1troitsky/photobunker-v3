# PB3 P2 #291 — Messages 1.1 Beta Local-First UI integration

**2026-11-13** · [Issue #291](https://github.com/1troitsky/photobunker-v3/issues/291) · base integrated, all-five-workflows-PASS [Draft PR #290](https://github.com/1troitsky/photobunker-v3/pull/290) @ immutable `f4bce2e1ab3e5ad72ec1d7e8c8f4d7517e286faa`. **Draft QA status: exact-head CI PENDING**. No main/deploy/merge.

## Verified provenance, owner accepted UX, current-shell preservation

The independently open [old Beta PR #64](https://github.com/1troitsky/photobunker-v3/pull/64) @ `fbf09ab796aa60cbce539c62277cdfaed53984db` had an approved draft-only Message inbox implementation on an obsolete five-point Shell. Its five genuinely missing artifacts are recovered by **exact original Git source SHA** into this descendant (MessagesView, encrypted message-drafts.ts, corresponding unit test, real 2-account E2E plus old doc behavior recorded here) rather than merging/replacing the old App.vue/router/styles.css/Playwright wholesale.

**Immutable design references:** `docs/ux/messages/README.md` and `docs/ux/messages/accepted-messages-fieldwork-v1.1-standalone.html` from owner-approved PB2 PR #56, imported unmodified; navigation map N-42, N-43. The inbox is a regular shared Fieldwork Shell route `/messages`. Opening a conversation uses a **single fullscreen modal overlay ABOVE the underlying mounted inbox, header and Dock**, on desktop AND phone, with a dedicated header/composer, dark `#101210` canvas, translucent/reduced-motion transitions, Escape and focus restoration; closing returns to the exact same inbox scroll. Never open `/messages/:id` as an independent page. Accept only fingerprint-confirmed local contacts, no fabricated chat rows or team history.

**Safe integration on latest Shell**:
- Add a single `/messages` route in the current `apps/web/src/router.ts`, preserving all Browser editor, Settings search, Appearance and assignment routes.
- Preserve existing 5-point default Dock, max6/min3, mandatory Settings and user's v1/v2 saved settings; set only opt-in Messages destination from `null` to `/messages` in `dock-preferences.ts`. Notifications remains `null` / unselectable. Add correct message SVG glyph to the **existing** conditional Dock icon in App.vue; do NOT replace Shell or its recent history and viewer-toolbar fixes.
- Append the original scoped `.messages-*` CSS block at END of current `styles.css`, do not replace shared CSS, Header/Dock geometry, current Viewer/Camera or dynamic Shell. Owner-accepted fullscreen overlay CSS and no fake outgoing bubble messages.
- Explicitly add `p2-messages-drafts.spec.ts` to existing `tests/playwright.config.ts` allowlist, **no exclusion/relaxation of existing 83 Chromium tests**. Two new E2E checks: real two-account fingerprint-confirmed contact → encrypted draft/overlay/offline/reload + optional opt-in Dock navigation. All test changes are scoped.

## E2EE truth and negative cases

Local drafts are NOT Matrix messages. `message-drafts.ts` uses per-account `akek` AES-256-GCM, random IV and authenticated AAD, SHA-256 ownerScope/peer row hashes, zero plaintext in IndexedDB indexed keys/storage, max4096 chars. Each read/write confirms same PB3 account/device/KEK/revision, pinned peer `safetyFingerprint`, and fails closed on peer key rotation or revoked contact. Edits serialize by account+peer and delete empty drafts locally. No server route, no token, no delivery receipt or fake success. Outgoing Send, attachments and rooms intentionally disabled. UI search works over decrypted volatile local data only, not network or raw browser index.

User-facing statuses clearly say “Matrix пока не подключён”; no Matrix transport/escrow/recovery/message sync or rooms in this PR. Browser inbox is accessible only when the account is unlocked for draft creation; direct route with no session shows explanatory empty state rather than dummy conversation.

## Gates and limitations

**Require exact-head 5/5 main-descendant workflows**, incl actual UX source integrity check, UX scope guard, security, PHP8.4/8.5 PHPUnit244+, Vitest446 plus new encrypted drafts cases and Strict TS/build, PostgreSQL18/Garage with ALL former **83 E2E + TWO new Messages tests (85 total expected)**, real 5/5 independent PG quota races and Garage outage/recovery/ACK-loss. Any CI failure must be retained with log and fixed in the claimed paths, not by dropping tests or changing Matrix/back end.

**NOT TESTED / BLOCKED:** real Matrix A→B send/sync, RustCrypto/WASM, SAS/QR, key rotation recovery/escrow, Lost ACK, own homeserver, team rooms, actual badges, media attachments/delivery, final profile-to-chat cross-screen return contract, mobile Safari/Android and real device keyboard/focus. These remain separate security/UX acceptance. Old #64 is not automatically closed and remains traceable; #290 remains review-only and unmerged. This child may enter `review` only after 5/5 full exact-head success.

**Parallel local agent:** independently audits exact #290 base; no edits to Messages paths or this branch, no merge.
