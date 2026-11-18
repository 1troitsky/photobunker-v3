> Аудит16.11.2026: [полный реестр и merge blockers](docs/audits/PB3-ALL-PRS-ISSUES-FRONTEND-MERGE-AUDIT-20261116.md). Эта ветка не слита в main. Все PR/Issues архивно закрыты; незавершённые требования сохранены в отчёте.

# PhotoBunker PB3 — Integrated Fieldwork frontend

This branch is the **original PB3 application**, not a new prototype. It integrates existing Vue 3/strict TypeScript UI and Laravel 13 API with PostgreSQL 18, Garage S3, encryption and real browser journeys. It is a **review candidate**; do not confuse a successful build with full product/release acceptance.

## Run on a Mac

Install and launch [OrbStack](https://orbstack.dev/) or Docker Desktop (Docker Compose v2). Clone into a **new directory** so you do not overwrite any current local PB3 work:

```sh
git clone --branch feat/mvp-photo-journeys-20261118 --single-branch https://github.com/1troitsky/photobunker-v3.git photobunker-v3-front
cd photobunker-v3-front
open local-runner/Start-PhotoBunker.command
```

The script builds the actual application, creates separate development credentials and migrates a persistent **local** PostgreSQL database. On readiness it opens **http://127.0.0.1:5173**. To stop without deleting data, run `local-runner/Stop-PhotoBunker.command`. **Never delete Docker volumes or the local-runner/secrets.env file to reset the app**; this can irreversibly destroy encrypted user data. See [local-runner/README.md](local-runner/README.md).

## Actual front-end routes in this branch

| User area | Route |
| --- | --- |
| Welcome / create / recover | `/welcome` |
| PIN setup / change / disable | `/settings/security` |
| Assignments (incl. editor) | `/assignments` |
| Create encrypted assignment (approved source form) | `/assignments/new` |
| Encrypted Browser, viewer and editor | `/browser` |
| Photo / video / audio capture | `/camera` |
| Contacts and teams | `/contacts` |
| Account / key-only identity | `/settings` |
| Dock / Appearance | `/settings/appearance` |
| Data & Storage | `/settings/storage` |
| Help / FAQ | `/settings/help` |
| Server invitations/events → encrypted Notifications inbox | `/notifications` |
| Notification settings | `/notifications/settings` |
| Encrypted local Messages **drafts** (not sent messages) | `/messages` |
| Encrypted device-local profile + edit | `/settings/profile`, `/settings/profile/edit` |
| Security status / verified session / device list | `/settings/security` |
| Anonymous safe-photo Public Card (expiry / revoke) | `/p/:token#key=…` |
| Server tariff catalog + verified account plan | `/settings/payments` |

The default Dock remains five items; Notifications and Messages can be added via Appearance after opting in. No fake message delivery, payment settlement or server acknowledgments.

## Not yet ready for a production release

Public profile publishing and global handles, Emergency PIN/Panic/remote wipe, verified cross-device Matrix messaging, OS push delivery, live payment settlement, full encrypted Vault restore, independently signed cold-offline PWA, physical iOS/Android hardware validation and final owner acceptance remain outstanding. Some Security/Subscription menu entries are intentionally disabled rather than misleading clickable placeholders. No production deployment or merge into `main` is authorized.

Sources: [Specification](ts.md), [Engineering constraints](AGENTS.md), [consolidation audit](docs/audits/PB3-FRONTEND-ONE-SHELL-20261115.md).
