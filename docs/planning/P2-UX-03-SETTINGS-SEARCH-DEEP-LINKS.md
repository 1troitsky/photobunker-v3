# P2 UX-03 — Search by exact setting (not fake section navigation)

**Base:** Draft UX #150 @ `c4d0f7e06fbf3467b0cc25663f70d8a3e8421bd0`.
**Approved source:** PB2 PR #56, `docs/ux/app-appearance/README.md`, Settings/Profile 1.6 WIP and accepted Appearance/Dock 1.3.

## Implemented
- The **one** canonical Shell Header offers Settings search from Settings and Appearance. It is not a second page header or new App Shell.
- Search page `/settings/search`: typed RU/EN synonym matching, no server access or indexing of account/Recovery Key data.
- Real setting result **«Нижняя панель (Dock)»** points to the **exact** `/settings/appearance?field=dock`. Appearance focuses and scrolls to `#setting-field-dock`. Other actual implemented route: Contacts & Teams. No fabricated routes.
- Searching the approved future fields theme, accent, text size, launch page, language, notifications, privacy, payments or storage returns **read-only «Ещё не подключено»** results, not fake clickable links. Messages are not a Contacts child.
- Query is preserved via `router.replace` in URL, avoiding navigation-history pollution for each keystroke; Back from Dock returns to the search query. The Appearance unsaved-draft guard is not bypassed.
- New unit tests for synonyms and available route whitelist; Playwright real Chromium test for authenticated search, exact field focus, browser Back and disabled language.
- No changes to `styles.css`, Viewer/editor, media crypto/outbox/ACL, backend/API, approved original HTML or main.

## Deliberate boundaries
- Only Dock is a deep-linkable Appearance setting today. The approved «language → exact Language field» journey remains **NOT IMPLEMENTED** until real RU/EN localization exists, as opposed to deceptively scrolling to a generic section.
- Complete theme, accent, size and launch settings remain separate UI tasks; product branch #151 currently touches global `styles.css` and the Editor, so avoid parallel global theme CSS changes until ownership reconciled.
- Search results are local static setting labels, not a general search over private E2EE content.
- Preserve root route, Welcome, Profile/Settings WIP, existing Key-Only Identity, Local-First outbox, UI Shell, and currently incomplete Matrix.

## Verification / merge gate
- PR must pass exact-head PHP8.4/8.5, strict TypeScript/Vitest/build, security, real PG18/Garage and entire Chromium suite, with new `p2-settings-*.spec.ts` included.
- Verify on the latest product head after resolving historical #139-current/#140 ancestry conflict and branch divergence with product #151. Until then **Draft / no main merge**.
