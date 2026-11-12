# PB3 P2 — Issue #214: independent mobile Dock 1.3 acceptance

**Date:** 2026-11-12  
**Lane:** QA-only; change to App Shell, AppearanceView, router, stored identity, MediaFile, E2EE, ACL, TTL or approved UX source is **forbidden**.  
**Base:** integrated and verified #187 @ `7a309508cc140897ae6dd75f8d473a89c7296be2`. Not stale main and not the newer product/other-agent branches.  
**New test:** `tests/e2e/p2-dock-mobile-acceptance.spec.ts`.  
**Status:** exact-head CI PENDING.

## Source-derived acceptance and actual product constraints

Approved `docs/ux/app-appearance/README.md` §1.3 and `docs/ux/UI-SHELL-CONTRACT.md` require 3–6 Dock items, mandatory movable Settings/Profile, correct narrow geometry, live preview and atomic Save/Cancel, accessible order arrows, one-level retap, RU/EN exact-field search.

The **currently integrated runtime at #187 only has FIVE usable `DockDefinition.to` routes**: Assignments, Browser, Camera, Contacts and Settings. Notifications and Messages have `to:null` and their Add buttons are explicitly disabled. `validateDock` refuses a 6-item list with those unavailable destinations, so a functioning 6-item Dock is **BLOCKED BY PRODUCT ROUTE AVAILABILITY**, not QA PASS. No mocked sixth link or phantom destination added. This test asserts safe unavailability; six-real-items approval requires a separate product issue once an approved sixth destination exists.

`SettingsSearchView` indexes RU/EN Dock synonyms ('панель', 'navigation', 'dock') and deep-links to `?field=dock` with real focus. The 'language' keyword is an intentionally **planned** result, not a working language picker; the test checks non-navigation rather than falsely approving language switching.

## Automated real-browser scenarios

1. Narrow 320px mobile Chromium, Key-Only registration; remove sections to **3**, test mandatory Settings, no more removals; save while **offline**, inspect actual atomic `pb3.appearance.v2` localStorage, go online and **reload**, verify persistence.
2. Add to **4**, focus/activate Up via Enter, Save/reload; draft-add **5**, Cancel and verify actual Shell/route rollback on reload; add 5 again, Save/reload and verify equal-width Dock hit areas, no horizontal clipping and attached bottom.
3. Desktop pointer drag Settings to front after keyboard Up, verify live Shell order; unsaved draft is not persisted and Cancel restores prior state even after reload.
4. Narrow mobile RU and EN query, exact Dock field focus; active Settings retap returns **one level** Appearance → Search with query and focus preserved; Browser back verifies Search state. 'language' correctly remains planned.
5. Hide Contacts from Dock but navigate to **real Contacts & Teams via Settings**; ensure hiding shortcut never revokes authenticated section access. Repeated Settings root retaps do not add history entries.
6. Existing E2E tests remain enabled; no browser mocks of API, security, GPS, device auth or storage. Post-check source SHA and CI evidence must be recorded here or in PR comments.

## Acceptance boundaries

- **Cold HTTP/PWA reload with network disconnected: NOT TESTED/BLOCKED BY DESIGN.** The local-state write is verified while offline, then a normal online HTTP reload verifies durable persistence; Vite test server requires network for cold reload. This is **not** a claim that a signed PWA offline shell exists.
- **6 actual Dock links: NOT AVAILABLE** on #187; a product/integration follow-up, not a test-only fix.
- **Physical iOS Safari/Android, native screenreader, OS safe areas, rotated viewport and thermal profiling: NOT TESTED**; mobile Chromium emulation cannot replace real devices.
- Verification gate on exact head: PHP8.4/8.5, TypeScript/build + Vitest, Security, real PostgreSQL18/Garage and full Chromium E2E. No retries, skipped assertions, mocked auth, changed permissions or main merge.
- Issue remains **open** after `review` until missing route/device/integration acceptance is resolved.
