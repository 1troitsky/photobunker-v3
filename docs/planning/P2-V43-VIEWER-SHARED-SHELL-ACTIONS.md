# P2 V-43 — File Viewer actions in the one shared Shell Header

**Status:** implementation and real-browser regressions written; exact-head CI pending.
**Parent:** [Draft #140](https://github.com/1troitsky/photobunker-v3/pull/140)
@ `17b0e47887cc91f2d361a815ba02e81077de2cce` (3/3 PASS,
48/48 real Chromium). `main` unchanged.

## Owner-accepted baseline and contracts

- PB2 PR #56 `docs/ux/browser/viewer/README.md` §2: File Viewer
  Header actions in order **Favorite / Copy / Download / Delete**.
- `docs/ux/UI-SHELL-CONTRACT.md` §§1–2: Header 64px, Dock 82px,
  one shared Shell with page-specific contextual actions (not copied
  standalone HTML headers). Cross-screen map #138 N-15–N-20 and
  GAP-07/GAP-15 distinguish accepted prototype from production.
- Explicit download of decrypted originals can expose media outside
  the protected app. It must keep the current user confirmation;
  the app must never trigger it automatically.

## Implementation

- App.vue renders the four context icons **inside its existing** 64px
  `.shell-header`, only for the real `browser-viewer` route.
  No independent File Viewer header or new dock is introduced.
- `viewer-shell-actions.ts` holds only a **tab-volatile download
  callback**, never the media Blob, plaintext filename, GPS, E2EE key,
  credential, server URL or ACL data. FileViewerView registers this
  callback only when a current authenticated file has been decrypted;
  clears it on session lock, file unload and component unmount.
- The sole live **Download** button delegates to the already-existing
  `download()`, which rechecks `fileBlob`, `fileUrl`, `preview`
  and `activeSession` at click time and shows the explicit local
  plaintext disclosure confirmation. It never waits for Garage or
  claims a server ACK. Pathbar loses its duplicate download button.
- **Favorite / Copy / Delete** appear in approved order but are
  **disabled**, each with an explanatory title. Their domain-specific
  encrypted collection, privacy-safe OS clipboard export and archive
  ACL/TTL operations have not been accepted or independently tested.
  No fictitious state mutation or raw ciphertext deletion is added.
- Mobile narrow header buttons remain focusable when enabled; icons
  are decorative SVG with proper Russian accessible labels.

## Verification

- Existing real Chromium `p2-browser-viewer.spec.ts` downloads one
  actual decrypted WAV through the Header with user confirmation and
  checks the exact private filename; after signed logout the Header
  download must be disabled and decrypted object disposed.
- Updated 390×844 / 1280×800 fixed scene test asserts only one
  Shell Header, all four ordered controls and enabled/disabled states.
  It checks removal of Viewer contextual actions on leaving the route.
- Exact-head PHP8.4/8.5, TypeScript/Vitest/build, Security,
  PG18/Garage + 48 real Chromium E2E **pending**.
- Physical Safari/iOS/Android, clipboard, favorite synchronization,
  destructive archive/GC, public preview and screen-by-screen owner
  visual approval **NOT TESTED / gated**.

No merge, deploy, Matrix, key package, TTL, physical deletion,
server ACL, Safe-media grants or original content changes.
