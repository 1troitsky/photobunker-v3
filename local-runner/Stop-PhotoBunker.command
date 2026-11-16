#!/bin/bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/local-runner"
if [[ -f "$DIR/project-name" ]]; then
  persisted_project="$(cat "$DIR/project-name")"
  [[ "$persisted_project" =~ ^[a-z0-9][a-z0-9_-]{1,62}$ ]] || { echo "Invalid saved Compose project name" >&2; exit 1; }
  export PB3_COMPOSE_PROJECT="${PB3_COMPOSE_PROJECT:-$persisted_project}"
fi
[[ -f "$DIR/secrets.env" ]] || { echo "PB3 has not been started."; exit 0; }
docker compose --project-directory "$ROOT" --env-file "$DIR/secrets.env" -f "$DIR/compose.yml" stop
echo "PhotoBunker stopped. Encrypted data and PostgreSQL/Garage volumes preserved."
