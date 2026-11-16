# Run the actual PB3 application on a Mac

The archive must contain **the full source tree** `apps/api/` and `apps/web/`, not only launcher files. This runs Laravel 13, the compiled Vue application, PostgreSQL 18 and Garage S3. The default frontend is served by Nginx; it does not expose Vite or `/src` modules. This does not certify the full PB3 release.

## Mac startup

1. Install and **start** OrbStack or Docker Desktop (Docker Compose v2 required).
2. Use the checked-out repository containing this runner and the application source.
3. In the extracted repository, open `local-runner/Start-PhotoBunker.command`. On macOS Gatekeeper, use right-click → Open if required.
4. Wait for readiness, then the launcher opens `http://127.0.0.1:5173`.

The first startup builds both application images, migrates a local PostgreSQL database, provisions a local Garage bucket, generates distinct private credentials and launches Nginx/Laravel. **Keep the directory**; `local-runner/secrets.env` contains the Laravel encryption key and S3 credentials. It is excluded from Git and Docker image contexts. Never give this file to third parties.

`PB3_WEB_MODE=development bash local-runner/Start-PhotoBunker.command` explicitly selects Vite for existing source-module QA. Ordinary startup defaults to the compiled application. Both modes use the same origin and persistent data.

The default address is loopback-only. A physical phone needs a separately configured trusted HTTPS origin and reverse proxy; set `PB3_PUBLIC_ORIGIN` consistently for that origin before rebuilding. This runner does not publish the application, change system trust settings or activate an unsigned Service Worker. Cold offline bootstrap remains unavailable pending the signed-release trust design.

To stop without deleting data, run `local-runner/Stop-PhotoBunker.command`. Docker named volumes hold local database and ciphertext. Do not use `docker compose down -v`, Docker volume prune, or delete local files as a way to restart: those actions can permanently destroy data. Recovery Keys are not backed up by this launcher. Preserve your own Recovery Key.

## Independent verification

`bash local-runner/ci-smoke.sh` provisions **disposable** test services and verifies genuine backend readiness, identity/plan HTTP endpoints and the actual Vue shell. Dedicated GitHub Actions run separate real Chromium **photo capture/recovery**, **E2EE audio/video cloud readback**, and **signed mixed assignments**, using live disposable PostgreSQL/Garage and server authorization.

This runner does **not** claim production security accreditation, a signed PWA Service Worker, native iOS/Android validation, Matrix E2EE, paid settlement or cloud backup. The binding release gates in `ts.md` remain requirements.
