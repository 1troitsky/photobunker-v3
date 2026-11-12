# PB3 UX-02 — Appearance 1.3 Dock configuration (real navigation)

**Branch:** `integration/ux-appearance-dock-config`, Draft stacked on #146 after verified #145 product ancestor. 
**Approved source:** `docs/_uiux/Settings_App_Appearance_Dock_Fieldwork_1_3.html` and PB2 PR #56 `docs/ux/app-appearance/README.md` (separate UX branch #135/#138).
**Status:** **partial approved Appearance 1.3 integration: only Dock**. No theme/colour/text-size/launch-page/i18n false claims.

## Changes and functional meaning

1. Real `/settings/appearance` route linked from `AccountView`'s new Settings hub (introduced in #146). One shared Shell Header, the same real Dock; no duplicate header/dock.
2. Order/add/remove the actual Dock links, **3–6** maximum, **Settings mandatory**, no duplicates. Preserve defaults: Assignments / Browser / Camera / Contacts / Settings. Live preview updates the *actual shared Dock*; it does not navigate or create a second mocked Dock.
3. Both drag/drop and keyboard/touch-accessible up/down arrows. Cancel restores the previous saved Dock; Save writes only nonsecret local UI preferences, then updates the saved reactive state. The app reload restores saved order; malformed/unsupported saved state falls back to defaults.
4. Existing active routes remain real; Notifications/Messages are displayed as **unavailable choices** until working routes exist, so there is no nonfunctional button in the Dock. Profiles and contacts remain conceptually under Settings (additional direct Contacts dock shortcut is the approved default).
5. Leaving an unsaved editor prompts for confirmation; errors saving to local storage do not falsely claim success. Preferences stored **only on this browser/device**, no server/user-account cross-device sync or storage of sensitive identity/media information.
6. New unit tests cover selection bounds, mandatory Settings, unknown/duplicate entry, invalid localStorage and save failures. Real Chromium test exercises registration, live preview/cancel, saved order after reload, reverting defaults and unchanged key-only access.

## Known incomplete Appearance 1.3 behaviors

- Theme dark/light/system, accent palettes, text scaling, launch page, language RU/EN and setting-search deep links are NOT implemented here. The screen indicates this explicitly, and their original owner-approved HTML is not altered.
- Dock repeated tap on an active item returning one navigation level is not modified; it needs router/store contract and cross-product regression tests.
- Drag/drop on physical iOS/Android, accessibility at 320px and visual pixel parity with prototype are NOT TESTED; arrow controls provide a usable alternative.
- No backend sync, encryption protocol, grants/ACL/TTL, Matrix, tariff, PWA or destructive operations are changed.

## Cross-lane ownership

- **UX-INTEGRATION**, based on #146 `f490dd532624be3b405622af6469f3a2eb1fd5f3`.
- **Changed**: `App.vue` (Dock map/render only), `router.ts` (Appearance route only), `settings-navigation.ts` and test, new `AppearanceView.vue`, pure preference validator/store and tests, new browser test and this document.
- **Excluded**: `FileViewerView.vue`, `styles.css`, editor outbox/crypto/media/API, `apps/api/**`, Camera, product E2E files, `docs/ux/**`, `docs/_uiux/**`, #138 map and main.
- Product #147/#148 own Viewer/CSS and media; they have **no touched-file overlap** with this PR, but diverged from our #145→#146 branch and must be reconciled in one later integration PR. Separately unresolved historical #139-current/#140 ancestry and [#146 E2E CI](../audits/P2-UX-WORKSTREAM-PR139-146-CI-20261112.md) still block any main merge.
- Before any future merging, rerun entire full-suite CI on the reconciled exact product+UX HEAD. A green unit build alone is insufficient.

Draft PR only; not deployable or final UX acceptance.
