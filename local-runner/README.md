# Actual PB3 local Docker runtime

This package runs the **existing** `1troitsky/photobunker-v3` Laravel/Vue code, not substitute HTML. `Dockerfile.api` installs PHP 8.4 with the security floor, `Dockerfile.web` builds the real Vue workspace, and `compose.yml` runs PostgreSQL 18 + Garage 2.5 + PHP API + web with localhost-only published ports.

The launcher keeps `local-runner/garage.toml` and `local-runner/secrets.env` private and persistent. It does not wipe S3, databases, rotate user keys, enable destructive cleanup, deploy or merge anything.

## Validation

`bash local-runner/ci-smoke.sh` provisions an **ephemeral** CI Garage/PostgreSQL environment, builds both application images, checks live `/api/readyz`, `/identity/v2/csrf`, `/billing/v1/plans` through the browser proxy and loads the real web shell. The dedicated CI workflow additionally runs real Chromium account/media/Assignment user journeys.

This is a reproducible local-development stack, not a production release claim. No full Matrix, payments, physical mobile, or signed PWA acceptance is claimed.

Do not commit `local-runner/secrets.env` or `garage.toml`. Their contents are excluded from Git and Docker build context.
