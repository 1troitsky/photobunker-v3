#!/usr/bin/env bash
set -euo pipefail
# Explicit manual local-dev operation. Does not remove or overwrite buckets.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
dc=(docker compose -f compose.p0.yml)
node="$("${dc[@]}" exec -T garage /garage node id -q | tr -d '\r\n')"
node="${node%%@*}"
test -n "$node"
if ! "${dc[@]}" exec -T garage /garage layout show | grep -q 'ci-zone'; then
  "${dc[@]}" exec -T garage /garage layout assign -z ci-zone -c 1G "$node"
  "${dc[@]}" exec -T garage /garage layout apply --version 1
fi
if ! "${dc[@]}" exec -T garage /garage bucket info pb3-local >/dev/null 2>&1; then
  "${dc[@]}" exec -T garage /garage bucket create pb3-local
fi
if ! "${dc[@]}" exec -T garage /garage key info pb3-local-key >/dev/null 2>&1; then
  "${dc[@]}" exec -T garage /garage key create pb3-local-key
fi
"${dc[@]}" exec -T garage /garage bucket allow --read --write --owner pb3-local --key pb3-local-key
echo 'Local Garage bucket/key provisioned; retrieve credentials securely using Garage CLI.'
