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


## Prepared Docker image package

The core delivery contains `pb3-core-api:20261116`, `pb3-core-web:20261116`, `postgres:18` and `dxflrs/garage:v2.5.0`, together with source/image SHA manifests. Load the accompanying image archive with `docker load -i <archive.tar.gz>`, then run `PB3_BUILD_IMAGES=0 bash local-runner/Start-PhotoBunker.command`. Ordinary startup builds from the exact checked-out source. No databases, Garage objects, Recovery Keys, private credentials or browser profiles are included in a delivery package.

`local-runner/project-name` is an ignored local project identifier. When transferring an existing local stack to the primary checkout, keep its original identifier, secret file and Garage config: Compose then reuses the original named volumes. Never adopt another project's volumes or generate replacement credentials to bypass a failed startup. `PB3_OPEN_BROWSER=0` suppresses only the automatic browser opening.

The delivered vertical slice supports encrypted personal photo capture, encrypted offline outbox/retry, photo Browser/Viewer, Welcome/Loader, PIN enrollment/change/disable/0–5 minute relock, and explicit personal-JPEG Public Cards. Public links support expiry/revoke and owner management after independent Recovery Key restoration. Assignment/public metadata projection, video/audio public publication and Emergency PIN destructive processing are disabled. See the core integration audit for actual acceptance and hardware limitations.
