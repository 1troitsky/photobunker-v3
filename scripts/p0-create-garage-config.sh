#!/usr/bin/env bash
set -euo pipefail
# Create local-only RPC secret; never commit this file.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$root/infra/garage/.local"
mkdir -p "$dir"
chmod 700 "$dir"
if [[ -f "$dir/garage.toml" ]]; then
  echo 'Garage local config already exists; not overwriting.'
  exit 0
fi
umask 077
secret="$(openssl rand -hex 32)"
cat > "$dir/garage.toml" <<EOF
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "0.0.0.0:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$secret"
[s3_api]
s3_region = "garage"
api_bind_addr = "0.0.0.0:3900"
EOF
echo 'Created private local Garage config (never commit).'
