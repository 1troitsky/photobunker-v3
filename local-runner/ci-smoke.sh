#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")/.."
D="$PWD/local-runner"
mkdir -p "$D"
printf 'PB3_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > "$D/ci-secrets.env"
printf 'PB3_APP_KEY=base64:%s\n' "$(openssl rand -base64 32 | tr -d '\n')" >> "$D/ci-secrets.env"
cat > "$D/garage.toml" <<EOF
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
chmod 600 "$D/garage.toml" "$D/ci-secrets.env"
export PB3_S3_ACCESS_KEY=unused-bootstrap-access PB3_S3_SECRET_KEY=unused-bootstrap-secret
c() { docker compose --project-directory "$PWD" --env-file "$D/ci-secrets.env" -f "$D/compose.yml" "$@"; }
c up -d postgres garage
for i in $(seq 1 90); do
  if c exec -T postgres pg_isready -U pb3 -d pb3 >/dev/null 2>&1 \
     && c exec -T garage /garage node id -q >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
c exec -T postgres pg_isready -U pb3 -d pb3
node="$(c exec -T garage /garage node id -q | tr -d '\r\n')"
node="${node%%@*}"
test -n "$node"
c exec -T garage /garage layout assign -z local-zone -c 1G "$node"
c exec -T garage /garage layout apply --version 1
c exec -T garage /garage bucket create pb3-local
creds="$(c exec -T garage /garage key create pb3-local-key)"
access="$(printf '%s\n' "$creds" | awk '/^[[:space:]]*Key ID:/{print $3}')"
secret="$(printf '%s\n' "$creds" | awk '/^[[:space:]]*Secret key:/{print $3}')"
unset creds
test "${#access}" -ge 8
test "${#secret}" -ge 16
printf 'PB3_S3_ACCESS_KEY=%s\nPB3_S3_SECRET_KEY=%s\n' "$access" "$secret" >> "$D/ci-secrets.env"
c exec -T garage /garage bucket allow --read --write --owner pb3-local --key pb3-local-key
export PB3_S3_ACCESS_KEY="$access" PB3_S3_SECRET_KEY="$secret"
c up -d --build api web
ready=0
for i in $(seq 1 100); do
  if curl -fsS --max-time 2 http://127.0.0.1:8000/api/readyz >/dev/null 2>&1 \
     && curl -fsS --max-time 2 http://127.0.0.1:5173/ >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  c ps
  c logs --tail 120 api web
  exit 1
fi
curl -fsS http://127.0.0.1:8000/api/healthz | grep -q '"status":"ok"'
curl -fsS http://127.0.0.1:8000/api/readyz | grep -q '"status":"ready"'
curl -fsS http://127.0.0.1:5173/identity/v2/csrf >/dev/null
curl -fsS http://127.0.0.1:5173/billing/v1/plans | grep -q 'plans'
curl -fsS http://127.0.0.1:5173/ | grep -q 'app'
echo "PB3_REAL_DOCKER_LAUNCH_PASS: actual PHP/Laravel, PostgreSQL, Garage, Vue/Vite and proxied real routes."
