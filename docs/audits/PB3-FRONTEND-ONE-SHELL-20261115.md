# PB3 — unified existing frontend branch, 15 November 2026

## Goal
Single real Fieldwork Vue UI, not a new mock/prototype; consolidate existing owner-approved frontend modules into one candidate branch. No merge to main, deployment or production activation.

## Exact source lineages
- Draft #399 (first-parent candidate) — existing Camera, Browser/Editor, Assignments, Contacts, Notifications, Account/Grace, Data & Storage, encrypted Camera retry.
- Draft #398 — activate Help/FAQ in Settings with original reviewed UI.
- Draft #410 — local real Laravel/Vue/PostgreSQL 18/Garage stack runner (not a production release).
- Draft #292 — locally encrypted E2EE message *drafts only*, with reconciliation of current Notifications UI, Dock preferences and testing.
All imported paths retain original source Git blob hashes except explicitly reconciled navigation, Dock, tests, CSS additive selectors and integration report.

## Frontend navigation (same real Shell)
- /assignments (editor), /browser (file viewer/editor), /camera, /contacts, /settings.
- /settings/appearance, /settings/storage, /settings/help.
- /notifications, /notifications/settings.
- /messages, secure **device-local drafts only**; no Matrix network sending/delivery, fake dialogs or remote receipts.

## Verification and gaps
- This source integration requires fresh CI on its own exact HEAD: PHP8.4/8.5, Vue/Vitest/build/TS, Chromium (including both p2-messages tests), PG18/Garage and security suites. Parent PR results do not certify combined HEAD.
- Physical iOS/Android, Matrix messenger delivery, full paid settlement, snapshot Vault restore, Panic/Remote Wipe/DMS, signed cold-offline PWA, real push and legal publication are NOT accepted by this frontend branch.
- Existing PRs and main remain unchanged. This is a review candidate, not a verified finished product.
