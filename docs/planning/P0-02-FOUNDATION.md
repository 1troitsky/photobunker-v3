# P0-02 — runnable skeleton, evidence and limits

**Depends on:** Draft PR #1 (spec, security floors, tariff config). Scope: Issue #2.

## What this branch contributes

- Laravel API bootstrap, routes `/api/healthz` (no database) and `/api/readyz` (PostgreSQL), queue tables, non-destructive migration and PHPUnit foundation tests.
- Composer lock **reuses reviewed PB2 dependency versions**; Laravel locked at 13.39.0 while declared requirement remains >=13.4. Both PHP patch lines are enforced *before bootstrap*.
- Vue 3 + TypeScript, Vite PWA manifest, one 64px/82px Fieldwork-compatible Shell, configurable brand, neutral placeholder routes, and unit tests. **No production identity, encryption, camera, message or account code is copied.**
- PostgreSQL 18 and S3-compatible Garage 2.5 local compose; isolated CI writes only dummy bytes in a dedicated ephemeral bucket and verifies SHA-256 readback. No reusable plaintext user files.
- Frozen pnpm lockfile and Composer lock, separate PHP/Vue/integration CI jobs.

## How to check

1. `composer install --working-dir=apps/api --no-interaction` with patched PHP; `cd apps/api && php artisan route:list && php vendor/bin/phpunit`.
2. `corepack enable && pnpm install --frozen-lockfile && pnpm build && pnpm test:web`.
3. CI `p0-02-foundation.yml` runs separately against both approved PHP branches; GitHub Actions runs the real isolated PostgreSQL/Garage job. Do not run S3 integration against production environments.
4. To start disposable local services: `bash scripts/p0-create-garage-config.sh`; set a locally generated `PB3_DB_PASSWORD`; `docker compose -f compose.p0.yml up -d`; provision Garage with `bash scripts/p0-provision-garage.sh`. Copy `apps/api/.env.example` to an ignored `apps/api/.env` and supply a **new** Laravel APP_KEY and Garage credentials, never commit them.

## Explicitly incomplete

- No signed release anchor or automatic Service Worker registration; browser installability and offline resilience are **NOT VERIFIED**. Proposed trust architecture is in ADR-0001.
- Only the base Dock is present; App Appearance 1.3 configurability/active-tap back behavior is a **P2 implementation**.
- No actual authenticated or encrypted operations, application user tables, media schema, StorageManager, TTL GC, Matrix or billing.
- Database/S3 checks are isolated engineering validation, not a production performance/security audit.

Do **not** merge to main or move to P1 unless checks pass and the owner accepts this foundation.
