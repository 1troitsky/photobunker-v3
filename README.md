# PB3 — configurable-brand private media platform

**Status:** P0 foundation in progress. New independent source tree with a real Laravel/Vue skeleton, **not** a production-ready photo application.

**Read:** [Specification](ts.md) · [Agent rules](AGENTS.md) · [P0 checklist](docs/planning/P0-DELIVERY.md) · [P0-02 bootstrap](docs/planning/P0-02-FOUNDATION.md) · [source provenance](docs/architecture/PB2-PROVENANCE.md).

## Mandatory development stages

P0 preparation, then four stages **P1–P4**: P1 identity/E2EE/media/storage; P2 accepted Fieldwork frontend + Matrix Messenger; P3 Recovery Vault, payments, security, admin and signed PWA; P4 BYO/replica S3 and release readiness. IPFS is excluded.

Only the application *skeleton* is introduced at P0-02. Its screens contain intentionally neutral placeholders; real key-only identity, media, S3 lifecycles, backup, Matrix and billing are not implemented here.

## Technology and reproducible baseline

- **PHP 8.4.27+ <8.5 OR PHP 8.5.12+ <8.6**, Laravel >=13.4 <14; locked framework currently **13.39.0**.
- PostgreSQL 18; Garage 2.5 S3 (disposable local/CI), no production credentials.
- Vue 3, Vite 7, strict TypeScript, frozen pnpm workspace.
- Fieldwork shell 64px Header / 82px Dock; brand obtained from config rather than hardcoded app name.
- PWA manifest only: **Service Worker intentionally not registered** until signed-build trust is reviewed.

## Local quick start

Use **patched PHP**, Node 22+, pnpm 10.20.0. Refer to [P0-02](docs/planning/P0-02-FOUNDATION.md) for setup of PostgreSQL and Garage.

```sh
pnpm install --frozen-lockfile
pnpm dev

cd apps/api
composer install --no-interaction
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve --host=127.0.0.1 --port=8000
```

These commands are setup instructions, not a claim they were executed locally. CI verifies against compliant PHP, isolated DB/S3, and frontend build.

**UX evidence:** original Fieldwork PR #56 at [`daca24a4`](https://github.com/1troitsky/photobunker-new/tree/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux); do not copy mock frontend state into production business code.
