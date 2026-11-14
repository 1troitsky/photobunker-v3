#!/usr/bin/env bash
set -euo pipefail
# #235 CI-only. Two independent single-node Garage 2.5 processes with
# separate RPC secrets, metadata directories, ciphertext disks and credentials.
# Refuse to even create a container unless all disposal guards match.
if [[ "$GITHUB_ACTIONS" != "true" ||
      "$PB3_FAILOVER_REAL_GARAGE_CI" != "1" ||
      "$APP_ENV" != "testing" ||
      "$DB_HOST" != "127.0.0.1" ||
      "$DB_DATABASE" != "pb3_failover_235" ||
      "$DB_USERNAME" != "pb3_failover" ||
      "$S3_ENDPOINT" != "http://127.0.0.1:3900" ||
      "$S3_BUCKET" != "pb3-failover-235-a" ]]; then
  echo "REFUSED: not the isolated #235 Actions fixture" >&2
  exit 2
fi
umask 077
root="$RUNNER_TEMP/pb3-p4-failover-235"
mkdir -p "$root"
for name in a b; do
  if [[ "$name" == "a" ]]; then
    port=3900; rpc=3901
  else
    port=4900; rpc=4901
  fi
  dir="$root/$name"
  mkdir -p "$dir/meta" "$dir/data"
  secret="$(openssl rand -hex 32)"
  cat > "$dir/garage.toml" <<EOF
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "127.0.0.1:$rpc"
rpc_public_addr = "127.0.0.1:$rpc"
rpc_secret = "$secret"
[s3_api]
s3_region = "garage"
api_bind_addr = "127.0.0.1:$port"
EOF
  container="pb3-p4-235-garage-$name"
  docker run -d --name "$container" --network host \
    -v "$dir/garage.toml:/etc/garage.toml:ro" \
    -v "$dir/meta:/var/lib/garage/meta" \
    -v "$dir/data:/var/lib/garage/data" \
    dxflrs/garage:v2.5.0 >/dev/null
  ready=0
  for attempt in $(seq 1 30); do
    if docker exec "$container" /garage status >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then
    echo "Garage $name did not initialize" >&2
    exit 1
  fi
  node="$(docker exec "$container" /garage node id -q | tr -d '\r\n' | cut -d@ -f1)"
  test -n "$node"
  printf '%s\n' "$node" > "$dir/node-id"
  docker exec "$container" /garage layout assign -z "failover-$name" -c 1G "$node"
  docker exec "$container" /garage layout apply --version 1
  bucket="pb3-failover-235-$name"
  keyname="pb3-failover-235-key-$name"
  docker exec "$container" /garage bucket create "$bucket"
  docker exec "$container" /garage key create "$keyname" > "$dir/key.txt"
  key="$(sed -n 's/^[[:space:]]*Key ID:[[:space:]]*//p' "$dir/key.txt" | head -1)"
  password="$(sed -n 's/^[[:space:]]*Secret key:[[:space:]]*//p' "$dir/key.txt" | head -1)"
  test -n "$key" && test -n "$password"
  echo "::add-mask::$key"
  echo "::add-mask::$password"
  docker exec "$container" /garage bucket allow --read --write --owner "$bucket" --key "$keyname"
  if [[ "$name" == "a" ]]; then
    printf 'S3_ACCESS_KEY=%s\nS3_SECRET_KEY=%s\n' "$key" "$password" >> "$GITHUB_ENV"
    printf '%s\n' "$key" > "$dir/opaque-key-id"
  else
    printf 'PB3_FAILOVER_B_ACCESS_KEY=%s\nPB3_FAILOVER_B_SECRET_KEY=%s\n' "$key" "$password" >> "$GITHUB_ENV"
    printf '%s\n' "$key" > "$dir/opaque-key-id"
  fi
  rm -f "$dir/key.txt"
done
test "$(cat "$root/a/node-id")" != "$(cat "$root/b/node-id")"
test "$(cat "$root/a/opaque-key-id")" != "$(cat "$root/b/opaque-key-id")"
echo "P4 #235: two independently initialized Garage v2.5 processes (different node IDs, credentials, RPC secrets, disks, bucket names and ports); no user storage"
