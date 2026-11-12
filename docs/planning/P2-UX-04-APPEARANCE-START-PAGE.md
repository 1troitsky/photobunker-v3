# PB3 UX-04 — Start Page: Camera / Assignments / Browser

**Status:** isolated, functional production UX slice; still Draft. Base: [#152](https://github.com/1troitsky/photobunker-v3/pull/152) exact `7539bdd709a9c988b5296661b74a1038f39587f8`.
**Approved UX:** [Appearance Fieldwork 1.3](../../docs/ux/app-appearance/README.md), and canonical `docs/_uiux/Settings_App_Appearance_Dock_Fieldwork_1_3.html`.
**Default remains:** **Задания**; optional **Камера** or **Browser**, nothing else.

## What is real

- Appearance now displays an **actual Start Page field** with three radio choices. The exact search result `стартовая страница` / `launch page` navigates to `/settings/appearance?field=launch`, focuses and scrolls to that field.
- The root route `/` resolves to the saved start page on the current device. Opening an explicit route `/browser`, `/camera`, `/settings`, `/assignments` or a file deep link is unaffected. No new camera permission API or automatic backend identity mutation.
- Startup selection and Dock selection are **one atomic `localStorage.setItem`** of a fully validated, versioned `pb3.appearance.v2` bundle `{version:2,dock,launch}`. No half-updated preference on storage failure. A mounted Shell updates Dock live only as a *draft*, then Cancel discards *both* changes. Save persists both together.
- Existing version-1 Dock preference `pb3.appearance.dock.v1` is preserved for backward compatibility. With no v2 entry, the existing Dock list still loads from v1 while start page defaults to Tasks. New saves never delete or overwrite that v1 key.
- Invalid local storage, unknown route IDs, corrupt JSON, missing Settings, duplicated Dock entries or blocked storage are fail-safe. Preferences are **non-sensitive local UI state**, not E2EE data, account keys, assignments or media.
- New focused Vitest for migration, atomic bundle, failures and 3 approved routes. Full Chromium E2E for cancel, joint save, reload, root redirect, explicit-route preservation, field deep link, and revert. Existing Dock E2E migrated to assert the new single v2 document.

## Strict boundaries / still missing

- Theme dark/light/system, accent color, text scale, RU/EN full translation, device syncing and true multi-device backup of preferences remain **NOT IMPLEMENTED**. The UI makes no claims to implement them.
- Opening **Camera** as a startup route reuses the existing production Camera view; it does not bypass its account/session and browser permission checks.
- Search is local, and only returns working direct links to already implemented fields. No hidden Matrix or Notifications link was enabled.
- Does NOT change `apps/web/src/styles.css`, `FileViewerView.vue`, photo-editor helpers, crypto, S3, grants, TTL, API, database, original `docs/_uiux/` or `main`. Product #151 owns shared Editor/CSS and is independent.
- This PR is stacked on the UX branch, not the current product head. Before merge reconcile outstanding #139/#140 ancestry and integrate the latest PRODUCT branch with a reviewed diff and full combined CI.

## Testing and evidence

The required existing integration CI runs PHP 8.4/8.5, Vue strict TypeScript/Vitest/build, Security, PG18/Garage and the entire Chromium E2E suite. **Current result must be updated from actual GitHub Actions; never assume success.** No physical Safari/iOS/Android acceptance claimed.

Owner-facing UI scope: Appearance 1.3 **Dock + Start Page**, not complete Appearance 1.3.
