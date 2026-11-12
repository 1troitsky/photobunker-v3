# PB3 UX-05 — safe repeated active Dock tap, one level inside a section

**Source:** owner-accepted `docs/_uiux/Settings_App_Appearance_Dock_Fieldwork_1_3.html`, App Appearance 1.3 contract §6 in #138 docs. **Parent:** UX [#153](https://github.com/1troitsky/photobunker-v3/pull/153) @ `b888b3b94ba74a5d7baedb08b80a75608457cfbe` (54/54 Chromium). **Status:** new UX-INTEGRATION Draft, not a complete Browser/Viewer implementation.

## Implemented in the actual shared Dock

The same accessible `RouterLink` anchors remain real links and retain keyboard, Cmd/Ctrl-click, new-tab and default inactive navigation. When the user clicks an **already active** Dock item, the app chooses a safe, **single-level** return:

| Current screen | Active Dock tapped | Safe destination |
|---|---|---|
| `/settings`, `/browser`, `/assignments`, `/camera`, `/contacts` | same item | **No-op**: no duplicate browser history; Browser folder, search and filters stay in memory |
| `/settings/appearance` or `/settings/search` | Settings | The immediately preceding **Settings** history entry if verified; otherwise replace with `/settings` |
| `/settings/appearance?field=dock` reached from `/settings/search?q=dock` | Settings | Back exactly once to Search, preserving `q=dock`; second tap returns Settings |
| `/assignments/:id/edit` | Assignments | One entry back to `/assignments` only if that is the previous page; otherwise replace with assignments list |
| `/browser/file/:protocol/:id/edit` | Browser | One level to the **same** file Viewer, via native Back if its immediate predecessor; otherwise replace with the validated Viewer path |
| `/browser/file/:protocol/:id` | Browser | One level to `/browser`, via native Back if previous; otherwise replace with `/browser` |
| Another Dock item | inactive link | Unchanged normal Vue Router navigation |

**Security and state guarantees:** the Shell uses **only** route path and existing same-tab history pointers. It does not inspect decrypted filename, folder path, private search, keys or identity. Viewer `onBeforeRouteLeave` still arms existing in-memory, account/device-bound Browser return context only when navigating to `/browser`; Browser takes it once. Existing editor/assignment unsaved-draft `onBeforeRouteLeave` guards still run and may cancel a retap; **no forced navigation**. A direct Viewer/editor deep link is never sent to an arbitrary external history predecessor. No browser-history entry is added when tapping an already selected root. No global `styles.css` or editor implementation change.

## Verification

- Pure Vitest covers route lookalikes, safe parent selection, strict viewer/file-ID matching, same-file editor parent, Settings Search/Appearance Back, root no-op, direct deep-link fallback, and cross-section history isolation.
- New real Chromium `p2-settings-dock-retap.spec.ts` covers actual sign-in, root no-op and history position, Appearance -> Settings, Search -> Appearance -> Search -> Settings, direct Editor -> Viewer -> Browser fallback.
- All existing `p1-*` and `p2-browser-*` tests **remain mandatory**; this PR does not modify them. Full CI is required on the exact HEAD and once again on the eventually reconciled PRODUCT+UX stack.
- Physical Safari, Android native back/gesture and multi-tab behavior **NOT TESTED**.
- Product [#154](https://github.com/1troitsky/photobunker-v3/pull/154) owns stabilizing Browser/assignment E2E; no overlap in modified files. Historical #139 current/#140 divergent ancestry is **still a main-merge gate**. Never merge/deploy without owner approval.

## Deliberate exclusions

No changes to `router.ts`, `FileViewerView.vue`, `PhotoBrowserView.vue`, `AssignmentEditorView.vue`, browser return context, E2EE/ACL, Matrix, API or original UX HTML. The single shared Shell is preserved; no second header, Dock or simulated Viewer. This works even in a direct deep link and does not require an account to choose the safe route, although the actual media remains access-controlled by its existing View.
