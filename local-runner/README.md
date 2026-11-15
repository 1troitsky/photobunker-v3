# Run the actual PB3 application on a Mac

The archive must contain **the full source tree** `apps/api/` and `apps/web/`, not only launcher files. This runs real Laravel 13, Vue 3, PostgreSQL 18 and Garage S3 with the original Identity/E2EE/Camera/Browser/Assignments code. It is a local development build, **not** proof of full PB3 production release.

## Mac startup

1. Install and **start** OrbStack or Docker Desktop (Docker Compose v2 required).
2. Download the full `delivery/pb3-real-local-run-20261114` repository source ZIP and extract it.
3. In the extracted repository, open `local-runner/Start-PhotoBunker.command`. On macOS Gatekeeper, use right-click → Open if required.
4. Wait for readiness, then the launcher opens `http://127.0.0.1:5173`.

The first startup builds both real application images, migrates a local PostgreSQL database, provisions a local Garage bucket, generates distinct private credentials and launches Vite/Laravel. **Keep the extracted directory**; `local-runner/secrets.env` is the Laravel encryption key and S3 credentials. It is excluded from Git and Docker image contexts. Never give this file to third parties.

To stop without deleting data, run `local-runner/Stop-PhotoBunker.command`. Docker named volumes hold local database and ciphertext. Do not use `docker compose down -v`, Docker volume prune, or delete local files as a way to restart: those actions can permanently destroy data. Recovery Keys are not backed up by this launcher. Preserve your own Recovery Key.

## Independent verification

`bash local-runner/ci-smoke.sh` provisions **disposable** test services and verifies genuine backend readiness, identity/plan HTTP endpoints and the actual Vue shell. Dedicated GitHub Actions run separate real Chromium **photo capture/recovery**, **E2EE audio/video cloud readback**, and **signed mixed assignments**, using live disposable PostgreSQL/Garage and server authorization.

This runner does **not** claim production security accreditation, a signed PWA Service Worker, native iOS/Android validation, Matrix E2EE, paid settlement or cloud backup. The binding release gates in `ts.md` remain requirements.
