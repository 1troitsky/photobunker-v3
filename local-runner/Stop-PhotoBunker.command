#!/bin/bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/local-runner"
[[ -f "$DIR/secrets.env" ]] || { echo "PB3 has not been started."; exit 0; }
docker compose --project-directory "$ROOT" --env-file "$DIR/secrets.env" -f "$DIR/compose.yml" stop
echo "PhotoBunker stopped. Encrypted data and PostgreSQL/Garage volumes preserved."
