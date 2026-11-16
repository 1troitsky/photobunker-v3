#!/bin/bash
# Original PB3, unpacked full source; Docker-based local stack, no mock data.
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/local-runner"
fail(){ echo "PhotoBunker launch failed: $*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || fail "macOS required"
command -v docker >/dev/null || fail "Install OrbStack or Docker Desktop"
command -v openssl >/dev/null || fail "openssl missing"
docker info >/dev/null 2>&1 || fail "Start OrbStack or Docker Desktop first"
docker compose version >/dev/null || fail "Docker Compose v2 required"
[[ -f "$ROOT/apps/api/artisan" && -f "$ROOT/apps/web/vite.config.ts" ]] ||
  fail "Unpack the FULL PB3 repository, not the launcher-only archive"
cd "$ROOT"
secrets="$DIR/secrets.env"
conf="$DIR/garage.toml"
if [[ ! -e "$secrets" ]]; then
  [[ ! -e "$conf" ]] || fail "Garage config exists but secret file missing; refusing key rotation"
  printf 'PB3_DB_PASSWORD=%s\nPB3_APP_KEY=base64:%s\n' \
    "$(openssl rand -hex 24)" "$(openssl rand -base64 32 | tr -d '\r\n')" > "$secrets.tmp"
  chmod 600 "$secrets.tmp"
  mv "$secrets.tmp" "$secrets"
  cat > "$conf" <<EOF
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "0.0.0.0:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$(openssl rand -hex 32)"
[s3_api]
s3_region = "garage"
api_bind_addr = "0.0.0.0:3900"
EOF
  chmod 600 "$conf"
fi
[[ -s "$secrets" && -s "$conf" ]] || fail "Missing persisted credentials or Garage config"
read_key() { grep -E "^$1=" "$secrets" | tail -1 | cut -d= -f2-; }
db_pass="$(read_key PB3_DB_PASSWORD)"
app_key="$(read_key PB3_APP_KEY)"
[[ "$db_pass" =~ ^[a-f0-9]{48}$ ]] || fail "Invalid persisted DB password"
[[ "$app_key" =~ ^base64:[A-Za-z0-9+/=]{43,50}$ ]] || fail "Invalid persisted Laravel key"
export PB3_DB_PASSWORD="$db_pass" PB3_APP_KEY="$app_key"
export PB3_S3_ACCESS_KEY="$(read_key PB3_S3_ACCESS_KEY)"
export PB3_S3_SECRET_KEY="$(read_key PB3_S3_SECRET_KEY)"
[[ -n "$PB3_S3_ACCESS_KEY" ]] || export PB3_S3_ACCESS_KEY=bootstrap-unset
[[ -n "$PB3_S3_SECRET_KEY" ]] || export PB3_S3_SECRET_KEY=bootstrap-unset
compose_files=(-f "$DIR/compose.yml")
case "${PB3_WEB_MODE:-production}" in
  production) compose_files+=(-f "$DIR/compose.production.yml");;
  development) ;;
  *) fail "PB3_WEB_MODE must be production or development";;
esac
dc(){ docker compose --project-directory "$ROOT" --env-file "$secrets" "${compose_files[@]}" "$@"; }
echo "Starting persistent private PostgreSQL and Garage..."
dc up -d postgres garage
ready=0
for n in $(seq 1 75); do
  if dc exec -T postgres pg_isready -U pb3 -d pb3 >/dev/null 2>&1 &&
     dc exec -T garage /garage node id -q >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 2
done
[[ "$ready" -eq 1 ]] || fail "PostgreSQL/Garage not ready"
if [[ -z "$(read_key PB3_S3_ACCESS_KEY)" || -z "$(read_key PB3_S3_SECRET_KEY)" ]]; then
  dc exec -T garage /garage key info pb3-local-key >/dev/null 2>&1 &&
    fail "Garage key already exists but saved secret is missing; refusing re-key"
  node="$(dc exec -T garage /garage node id -q | tr -d '\r\n' | cut -d @ -f 1)"
  [[ -n "$node" ]] || fail "Garage node ID missing"
  if ! dc exec -T garage /garage layout show | grep -q local-zone; then
    dc exec -T garage /garage layout assign -z local-zone -c 1G "$node"
    dc exec -T garage /garage layout apply --version 1
  fi
  dc exec -T garage /garage bucket info pb3-local >/dev/null 2>&1 ||
    dc exec -T garage /garage bucket create pb3-local
  creds="$(dc exec -T garage /garage key create pb3-local-key)"
  access="$(printf '%s\n' "$creds" | awk '/^[[:space:]]*Key ID:/{print $3}')"
  secret="$(printf '%s\n' "$creds" | awk '/^[[:space:]]*Secret key:/{print $3}')"
  unset creds
  [[ "$access" =~ ^[A-Za-z0-9._-]{8,100}$ && "$secret" =~ ^[A-Za-z0-9._-]{16,200}$ ]] ||
    fail "Cannot parse Garage credentials; do not recreate this key"
  printf 'PB3_S3_ACCESS_KEY=%s\nPB3_S3_SECRET_KEY=%s\n' "$access" "$secret" >> "$secrets"
  dc exec -T garage /garage bucket allow --read --write --owner pb3-local --key pb3-local-key
fi
export PB3_S3_ACCESS_KEY="$(read_key PB3_S3_ACCESS_KEY)"
export PB3_S3_SECRET_KEY="$(read_key PB3_S3_SECRET_KEY)"
[[ -n "$PB3_S3_ACCESS_KEY" && -n "$PB3_S3_SECRET_KEY" ]] || fail "Garage credentials missing"
echo "Building Laravel 13 and the ${PB3_WEB_MODE:-production} Vue application..."
dc up -d --build api web
ready=0
for n in $(seq 1 120); do
  if curl -fsS --max-time 3 http://127.0.0.1:8000/api/readyz >/dev/null 2>&1 &&
     curl -fsS --max-time 3 http://127.0.0.1:5173/ >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then dc logs --tail 100 api web; fail "App not ready"; fi
echo "PhotoBunker PB3 running: http://127.0.0.1:5173"
echo "Do not delete Docker volumes unless you intend to destroy local encrypted data."
open "http://127.0.0.1:5173"
