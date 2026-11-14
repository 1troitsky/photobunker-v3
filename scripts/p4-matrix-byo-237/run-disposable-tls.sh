#!/usr/bin/env bash
set -Eeuo pipefail

# This acceptance runner changes networking only on a DISPOSABLE GitHub
# runner, never on the user's device or production infrastructure.
if [[ "$(id -u)" != "0" ]]; then
  echo "FAIL: isolated TLS fixture requires disposable-runner root" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE="$ROOT/scripts/p4-matrix-byo-237"
for binary in ip openssl python3 php; do
  command -v "$binary" >/dev/null || {
    echo "FAIL: missing $binary" >&2
    exit 2
  }
done

# A public-form IP must pass production admission. Route it to loopback
# in this isolated runner BEFORE any client network call; never touch
# actual public DNS or Cloudflare.
if ip -4 addr show dev lo | grep -q '1\.1\.1\.1/32'; then
  echo "FAIL: test alias preexists, refusing to interfere" >&2
  exit 2
fi

TMP="$(mktemp -d)"
SERVER_PID=""
ALIAS_ADDED=0

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ "$ALIAS_ADDED" = "1" ]]; then
    ip addr del 1.1.1.1/32 dev lo >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

ip addr add 1.1.1.1/32 dev lo
ALIAS_ADDED=1
ip -4 route get 1.1.1.1 | grep -Eq '^local 1\.1\.1\.1 .*dev lo' || {
  echo "FAIL: alias not routed locally, refusing outbound test" >&2
  exit 1
}

cat > "$TMP/openssl.cnf" <<'CONF'
[req]
distinguished_name=dn
x509_extensions=server_cert
prompt=no
[dn]
CN=matrix.team.org
[server_cert]
subjectAltName=DNS:matrix.team.org
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign,digitalSignature
extendedKeyUsage=serverAuth
CONF

openssl req -new -x509 -newkey rsa:2048 -nodes \
  -days 1 -sha256 -keyout "$TMP/key.pem" \
  -out "$TMP/cert.pem" -config "$TMP/openssl.cnf" >/dev/null 2>&1
chmod 600 "$TMP/key.pem"
openssl x509 -in "$TMP/cert.pem" -noout \
  -ext subjectAltName | grep -q 'DNS:matrix.team.org' || {
  echo "FAIL: ephemeral certificate SAN mismatch" >&2
  exit 1
}

for mode in success redirect oversize malformed wrong_hostname; do
  rm -f "$TMP/ready"
  server_mode="$mode"
  if [[ "$mode" = "wrong_hostname" ]]; then
    server_mode=success
  fi
  python3 "$FIXTURE/tls-server.py" \
    --cert "$TMP/cert.pem" --key "$TMP/key.pem" \
    --mode "$server_mode" --ready "$TMP/ready" \
    > "$TMP/server.log" 2>&1 &
  SERVER_PID="$!"

  ready=0
  for attempt in $(seq 1 40); do
    if [[ -f "$TMP/ready" ]]; then
      ready=1
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      cat "$TMP/server.log" >&2
      echo "FAIL: disposable TLS server exited before listen" >&2
      exit 1
    fi
    sleep 0.1
  done
  if [[ "$ready" != "1" ]]; then
    cat "$TMP/server.log" >&2
    echo "FAIL: disposable TLS server was not ready" >&2
    exit 1
  fi

  # PHP/libcurl now executes the production transport against real TLS,
  # with CA trust set ONLY for this subprocess. No token, no external IP.
  CURL_CA_BUNDLE="$TMP/cert.pem" \
    SSL_CERT_FILE="$TMP/cert.pem" \
    php "$FIXTURE/tls-client.php" "$mode"

  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
done

echo "PASS: real pinned TLS, bad cert host, redirect, oversize and malformed JSON"
