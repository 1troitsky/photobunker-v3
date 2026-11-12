# Screen registry — PB3 UX baseline

**Source revision:** PB2 PR #56 @ `daca24a4` imported in PB3 Draft #135. **Runtime revision checked:** PR #134 @ `07fa2832` (parent of #135). The table is a *screen-level* index, not a statement that the complete feature works. A route named below is directly evidenced by [PB3 router](../../apps/web/src/router.ts); other functionality may exist only inside a parent view or later unrelated Draft PR.

## Canonical screens

| ID | Screen / active UX | Local PB3 original | UX status | Runtime in #134 |
|---|---|---|---|---|
| S01 | Welcome 1.4 | [README](../ux/welcome/README.md) · [HTML](../ux/welcome/accepted-welcome-v1.4-standalone.html) | ACCEPTED | NO-ROUTE; registration UI provisionally in [AccountView](../../apps/web/src/views/AccountView.vue) |
| S02 | Welcome Loader 1.6 | [README](../ux/welcome/loader/README.md) · [HTML](../ux/welcome/loader/accepted-welcome-loader-v1.6-standalone.html) | SELECTED extension | NO-ROUTE |
| S03 | PIN Shell 1.1 | [README](../ux/pin-shell/README.md) · [HTML](../ux/pin-shell/accepted-pin-shell-v1.1-standalone.html) | ACCEPTED | NO-ROUTE |
| S04 | Authorization Error 1.0 | [README](../ux/authorization-error/README.md) · [HTML](../ux/authorization-error/accepted-authorization-error-v1.0-standalone.html) | ACCEPTED | NO-ROUTE |
| S05 | Assignments list 5.0 | [README](../ux/assignments/v5/README.md) · [HTML](../ux/assignments/v5/accepted-assignments-v5.0-standalone.html) | ACCEPTED | ROUTE-PRESENT `/assignments`; [AssignmentsView](../../apps/web/src/views/AssignmentsView.vue) partial Fieldwork |
| S06 | Assignment Editor Media 2.2 | [README](../ux/assignments/editor/README.md) · [HTML](../ux/assignments/editor/accepted-assignment-editor-v2.2.html) | ACCEPTED | ROUTE-PRESENT `/assignments/:assignmentId/edit`; [AssignmentEditorView](../../apps/web/src/views/AssignmentEditorView.vue) partial |
| S07 | Browser catalog v3 | [README](../ux/browser/README.md) · [HTML](../ux/browser/accepted-v3-standalone.html) | ACCEPTED | ROUTE-PRESENT `/browser`; [PhotoBrowserView](../../apps/web/src/views/PhotoBrowserView.vue) partial |
| S08 | File Viewer 1.0 | [README](../ux/browser/viewer/README.md) · [HTML](../ux/browser/viewer/accepted-file-viewer-v1-standalone.html) | ACCEPTED | ROUTE-PRESENT `/browser/file/:protocol/:id`; [FileViewerView](../../apps/web/src/views/FileViewerView.vue) partial |
| S09 | Photo Editor 3.2 Fixed | [README](../ux/browser/editor/README.md) · [prototype](../ux/browser/editor/index.html) | SELECTED design | PARTIAL-UI inside FileViewerView; no separately accepted editor route |
| S10 | Video & Audio Editor 1.1 | [README](../ux/browser/media-editor/README.md) · [HTML](../ux/browser/media-editor/accepted-media-editor-v1.1.html) | ACCEPTED | PARTIAL-UI inside FileViewerView; no standalone editor route |
| S11 | Camera 1.2 | [README](../ux/camera/README.md) · [prototype](../ux/camera/index.html) | SELECTED design | ROUTE-PRESENT `/camera`; [CaptureView](../../apps/web/src/views/CaptureView.vue) partial |
| S12 | Contacts & Teams 1.1 (one screen) | [README](../ux/contacts-teams/README.md) · [HTML](../ux/contacts-teams/accepted-contacts-teams-v1.1.html) | ACCEPTED | ROUTE-PRESENT `/contacts`; [ContactsTeamsView](../../apps/web/src/views/ContactsTeamsView.vue) partial |
| S13 | Settings & Profile 1.6 | [README](../ux/settings-profile/README.md) · [HTML](../ux/settings-profile/settings-profile-v1.6-standalone.html) | **WIP / NOT FINAL** | ROUTE-PRESENT `/settings` but [AccountView](../../apps/web/src/views/AccountView.vue) is identity/access, not accepted Profile |
| S14 | App Appearance / Dock 1.3 | [README](../ux/app-appearance/README.md) · [HTML](../ux/app-appearance/accepted-app-appearance-v1.3-standalone.html) | ACCEPTED | NO-ROUTE; default Dock hardcoded in [App.vue](../../apps/web/src/App.vue) |
| S15 | Security & Privacy 1.3 | [README](../ux/security-privacy/README.md) · [HTML](../ux/security-privacy/accepted-security-privacy-v1.3-standalone.html) | ACCEPTED | NO-ROUTE; limited Identity actions in AccountView |
| S16 | Data & Storage 1.2 | [README](../ux/data-storage/README.md) · [HTML](../ux/data-storage/accepted-data-storage-v1.2-standalone.html) | ACCEPTED (refinements possible) | NO-ROUTE |
| S17 | Notifications 1.5 | [README](../ux/notifications/README.md) · [HTML](../ux/notifications/accepted-notifications-v1.5-standalone.html) | ACCEPTED | NO-ROUTE |
| S18 | Payments & Tariffs 1.1 | [README](../ux/payments-tariffs/README.md) · [HTML](../ux/payments-tariffs/accepted-payments-tariffs-v1.1-standalone.html) | ACCEPTED visual; figures outdated | NO-ROUTE |
| S19 | Web3 Checkout 1.0 | [README](../ux/payments-tariffs/checkout/README.md) · [HTML](../ux/payments-tariffs/checkout/accepted-web3-checkout-v1.0-standalone.html) | ACCEPTED visual | NO-ROUTE |
| S20 | Public Card 1.1 (external web) | [README](../ux/public-card/README.md) · [HTML](../ux/public-card/accepted-public-card-v1.1-standalone.html) | ACCEPTED | NO PUBLIC ROUTE; no verified external issue/access lifecycle |
| S21 | Help / FAQ / Legal 1.0 | [README](../ux/help-legal/README.md) · [HTML](../ux/help-legal/accepted-help-legal-v1.0-standalone.html) | ACCEPTED UI / **TEXT-DRAFT** | NO-ROUTE |
| S22 | Messages Fieldwork 1.1 | [README](../ux/messages/README.md) · [HTML](../ux/messages/accepted-messages-fieldwork-v1.1-standalone.html) | **BETA-ACCEPTED UX** | NO-ROUTE in #134; separate [Draft #64](https://github.com/1troitsky/photobunker-v3/pull/64) is not part of this parent |
 
## Historical / noncanonical versions

- [Assignments 4.2](../ux/assignments/README.md) (prototype [here](../ux/assignments/index.html)) is superseded by S05 5.0. Do **not** use 4.2 as the main list design.
- [Appearance 1.2](../ux/app-appearance/accepted-app-appearance-v1.2-standalone.html) is archived; **1.3** with configurable Dock is canonical.
- Older Browser 3.1 and Photo Viewer 3.1 discussed in historical docs are **not** substitutes for S07 Browser v3 / S08 File Viewer 1.0.
- PB3 [docs/_uiux](../_uiux/README.md) holds historical standalone duplicates, including Data & Storage **1.0**, but the active source is `docs/ux/` imported from PB2 #56.
- No owner-accepted standalone for **assignment detail** page; S05 "Open" demo pane is not a new accepted page. Do not fabricate a screen.
- S09 is intentionally based on the documented [prototype index](../ux/browser/editor/index.html) rather than a nonexistent accepted-* HTML in that directory.

## Ownership boundaries and review

- **Within common Shell**: S05–S19, S21, Messages inbox S22 and standard Browser/Editor pages; some are subviews, not top-level routes.
- **No authenticated Shell**: S01–S04 and external Public Card S20.
- **Special layer**: Messages conversation *full-screen overlay over Shell* on mobile **and desktop**, not a second page or split view. Viewer media fullscreen/in-app Public Card preview are distinct layer types.
- **One screen, not two**: Contacts & Teams S12; contains tabs, team/contact cards and team settings.
- UX acceptance is independent from implementation and security acceptance. Use exact edge/test IDs from [NAVIGATION-MAP.md](NAVIGATION-MAP.md) and [USER-JOURNEYS.md](USER-JOURNEYS.md).
