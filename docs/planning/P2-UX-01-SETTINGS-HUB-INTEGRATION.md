# P2 UX-01 — Settings hub: first safe PB2 Fieldwork UI integration

**Branch base:** Draft PR #145 at `d62c4cae599b5e3c3de300f808242566f3ee124a`.
**UX source:** PB2 PR #56 `docs/_uiux/Settings_profile_fieldwork_1_6.html` + `docs/ux/settings-profile/README.md` (the full UX copy exists on the parallel docs PR #135; read-only approved originals are not modified).
**Status:** integration of the settings *navigation hub only*, **not** an accepted final Profile 1.6, Accounts/Identity rewrite or full settings implementation.

## Safe scope
- Adds `apps/web/src/ui/fieldwork/SettingsHub.vue`, scoped CSS and typed `settings-navigation.ts`.
- Only one existing view changed: `AccountView.vue`. It keeps all Key-Only Identity create, restore, Recovery Key, fingerprint/reauth, logout and validation handlers **unchanged**. Hub renders **only after** `activeSession` is available.
- The hub uses existing `/contacts` route for **Contacts & Teams as part of Settings** and the existing anchored "Доступ и устройство" for actual device/session controls. All other original Settings group entries are **explicitly labeled not yet implemented**, not made into fake routes.
- Existing Shared Shell header, current dock, router, browser/editor/video playback, app-wide CSS, E2EE, Local-First, API, ACL/TTL and secure storage are untouched.
- NO fake @username, profile avatar, plan, notifications, PIN, tariff/payment actions or assumed working Matrix; those require real data and separate approval.
- The approved default Dock may still include Contacts as an additional entry: this is consistent with UI Shell 1.3, even though Contacts belongs conceptually to Settings.
- Tests: Vitest for available routes/group placement; genuine Chromium enrollment -> hub -> real Contacts -> hub -> logout, confirming security flows aren't hidden.

## Next gates
1. Review visual alignment with Settings 1.6 WIP and approved source; don't call Profile finished.
2. Add other settings screens as **separate** accepted, secure routes; then activate their rows after real ACL/E2EE/Local-First tests.
3. Integrate final configurable Dock from Appearance 1.3 only after validating shared Shell/route behavior on latest product head. Do not reimplement File Viewer/Editor or merge older #138 code over product #145.
4. Source PR #135/#138 remains separate. Before any main merge reconcile the known #139/#140 history divergence and the full product stack.

This PR stays Draft; no production deploy or main merge.
