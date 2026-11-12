# P2 V-52 — Photo Editor 3.2: text Color + Size together on mobile

**Status:** product controls and Chromium acceptance written; exact-head CI **PENDING**.
**Parent:** verified product Draft [#156](https://github.com/1troitsky/photobunker-v3/pull/156)
@ `db22454cca1816a473871109f5dab3d8c9337507` (**CI 3/3, Chromium 54/54 PASS**,
[real PostgreSQL/Garage run 43168460813](https://github.com/1troitsky/photobunker-v3/actions/runs/43168460813)).
**Owner-selected UX:** read-only PB2 PR #56
`docs/ux/browser/editor/README.md` §3.4 / Photo Editor 3.2 Fixed.
**Screens / navigation / journeys:** S09, N-18/N-20, J-06, J-04/J-21.

## Product and security scope

- The existing caption list already follows the owner-selected tap-to-type,
  edit-on-image, two-way list/overlay and empty-text/undo behavior from V-49.
  The **remaining §3.4 mobile layout gap** was the inherited
  `.file-viewer-photo-text-settings` one-column media rule: the text color
  picker and font-size range were separated vertically below the list.
- This PR moves the two existing form controls into an explicit,
  independently bounded flex row **«Цвет» + «Размер»**. That row stays
  horizontal at phone width 390px and desktop. Controls have proper
  accessible labels, focus/keyboard support, an 8px mobile gap,
  `min-width:0` and bounded native input widths; no horizontal overflow.
  Caption text and X/Y edit fields remain in their existing form.
- **Same real editor model:** both control handlers already operate on
  the selected `PhotoTextMark`. Their changes update the identical
  preview image overlay and the existing 50-state volatile Undo/Redo,
  and rasterize as actual JPEG pixels through production
  `flattenPhotoAnnotations` followed by encrypted Media Outbox.
  No duplicate text store, new local plaintext persistence or extra
  E2EE/metadata contract is created.
- It changes **only** Photo Editor text control presentation. No
  shared app Shell, routing, backend, token/cookie/grant/ACL/TTL,
  public image scopes, customer tariff, other UX pages or real keys
  are modified. Original encrypted JPEG remains immutable.

## Exact acceptance

- Extended existing real
  `tests/e2e/p2-browser-photo-inline-text.spec.ts` at **390 × 844**.
  After creating/editing two independent caption overlays, deleting,
  Undo/Redo and synchronizing the list with image, it now checks the
  color and size label **actual DOM bounding rectangles** occupy one
  horizontal row and have no clipped scrollable content.
- Operates the *native size range* with keyboard arrows to 10%,
  verifies actual DOM font size increases and **Undo to 9% / Redo to
  10%**; applies red color. Exports the ordinary **separately encrypted
  JPEG derivative**, reads it through the authorized local E2EE API,
  and checks real red raster pixels, unchanged original source size,
  no plaintext caption in the durable record and no inherited GPS,
  tags or capture claim.
- Full required gate remains **54 Chromium tests, retries:0**, strict
  TypeScript/Vitest/build, PHP8.4/8.5, security, real PostgreSQL18
  /Garage. **PENDING** exact-head result; prior #156 PASS does not
  substitute for the new change.
- Real Safari iOS PWA, physical Android Chrome, IME text composition,
  visual owner screenshot acceptance **NOT TESTED**.

## Parallel PR safety

- **Lane PRODUCT**, stacked on verified exact-head #156
  `db22454cca1816a473871109f5dab3d8c9337507`. This includes
  earlier #154 independent QA stabilizations and #151 five shapes;
  no code copied from an older branch or from demo UI files.
- **Changed:** `apps/web/src/views/FileViewerView.vue`,
  `apps/web/src/styles.css`, existing
  `tests/e2e/p2-browser-photo-inline-text.spec.ts`, and this planning file.
- **Not changed:** `docs/ux/**`, `docs/ux-integration/**`,
  `apps/web/src/App.vue`, router, `apps/web/src/ui/fieldwork/**`,
  Media Outbox/E2EE domain, API, storage manager, `main`, Matrix.
  Parallel UX #146/#150/#152/#153/#155 Settings/Appearance/Dock
  changes do not overlap this Photo Editor/CSS slice.
- Historical #139/#140 divergent ancestry and future integration
  merge with UX branches remain separate reviewed gates. Draft only:
  no deploy/merge or owner production acceptance implied.
