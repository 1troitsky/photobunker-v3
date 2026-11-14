#!/usr/bin/env bash
# P4 #241 — REAL stop/start of a disposable PostgreSQL 18 GitHub service ONLY.
set -Eeuo pipefail

fail() { echo "P4-241 FAIL: $*" >&2; exit 1; }
for var in CI GITHUB_ACTIONS GITHUB_REPOSITORY APP_ENV DB_CONNECTION DB_HOST DB_DATABASE DB_USERNAME; do
  test -n "$(printenv "$var" 2>/dev/null || true)" || fail "missing disposable CI guard: $var"
done
test "$CI" = "true" || fail "CI required"
test "$GITHUB_ACTIONS" = "true" || fail "GitHub Actions required"
test "$GITHUB_REPOSITORY" = "1troitsky/photobunker-v3" || fail "wrong repository"
test "$APP_ENV" = "testing" || fail "non-testing environment"
test "$DB_CONNECTION" = "pgsql" || fail "non-PostgreSQL connection"
test "$DB_HOST" = "127.0.0.1" || fail "non-loopback DB host"
test "$DB_DATABASE" = "pb3_ci_pg_outage" || fail "non-disposable database"
test "$DB_USERNAME" = "pb3_ci" || fail "non-disposable DB user"
test -f artisan || fail "run only from apps/api"
test -f tests/integration/p4-fault-matrix/postgres-state.php || fail "missing owned sentinel"
test -n "$PG_CONTAINER_ID" || fail "GitHub PostgreSQL service ID not supplied"
case "$PG_CONTAINER_ID" in
  *[!0-9a-f]* | "") fail "invalid disposable container id" ;;
esac
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$PG_CONTAINER_ID")" || fail "no disposable service"
case "$IMAGE" in postgres:18 | postgres:18.*) ;; *) fail "not postgres:18 service" ;; esac
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$PG_CONTAINER_ID" |
  grep -Fxq 'POSTGRES_DB=pb3_ci_pg_outage' || fail "container belongs to another database"

STATE=tests/integration/p4-fault-matrix/postgres-state.php
READY_URL=http://127.0.0.1:8099/api/readyz
LIVE_URL=http://127.0.0.1:8099/api/healthz
BODY="$(mktemp)"
LOG="$(mktemp)"
SERVER_PID=""
DB_STOPPED=0
SENTINEL=0

finish() {
  local original="$?"
  trap - EXIT
  if test "$DB_STOPPED" = 1; then
    docker start "$PG_CONTAINER_ID" >/dev/null 2>&1 || true
  fi
  if test "$SENTINEL" = 1; then
    php "$STATE" cleanup >/dev/null 2>&1 || true
  fi
  if test -n "$SERVER_PID"; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$BODY" "$LOG"
  exit "$original"
}
trap finish EXIT

# A single app process remains live through actual DB service stop/start.
php "$STATE" prepare || fail "could not create synthetic sentinel"
SENTINEL=1
php artisan serve --host=127.0.0.1 --port=8099 >"$LOG" 2>&1 &
SERVER_PID=$!

check_http() {
  local url="$1" code="$2" state="$3" attempts="$4" got=""
  for ((i=1;i<=attempts;i++)); do
    got="$(curl --noproxy '*' --connect-timeout 2 --max-time 4 -sS \
      -o "$BODY" -w '%{http_code}' "$url" 2>/dev/null || true)"
    if test "$got" = "$code" && grep -Eq "\"status\"[[:space:]]*:[[:space:]]*\"$state\"" "$BODY"; then
      return 0
    fi
    sleep 1
  done
  echo "P4-241 expected $code/$state; last HTTP code $got" >&2
  return 1
}

check_http "$READY_URL" 200 ready 25 || fail "initial API readiness"
check_http "$LIVE_URL" 200 ok 4 || fail "initial API liveness"
php "$STATE" verify || fail "initial synthetic row"

# Deliberate physical outage on this job's disposable postgres:18 container.
DB_STOPPED=1
docker stop --time 5 "$PG_CONTAINER_ID" >/dev/null || fail "could not stop CI PostgreSQL"
test "$(docker inspect --format '{{.State.Running}}' "$PG_CONTAINER_ID")" = "false" ||
  fail "PostgreSQL container did not stop"
check_http "$READY_URL" 503 unavailable 15 || fail "false ready during REAL DB outage"
check_http "$LIVE_URL" 200 ok 4 || fail "liveness wrongly coupled to DB"
echo "P4-241 PASS: REAL PostgreSQL18 DOWN => readiness 503, liveness 200; no false-ready response"

docker start "$PG_CONTAINER_ID" >/dev/null || fail "could not start CI PostgreSQL"
DB_STOPPED=0
check_http "$READY_URL" 200 ready 40 || fail "readiness failed after REAL PostgreSQL restart"
check_http "$LIVE_URL" 200 ok 4 || fail "liveness failed after restart"
php "$STATE" verify || fail "durable synthetic row lost or modified"

echo "P4-241 PASS: REAL PostgreSQL18 recovery => readiness 200 and synthetic data unchanged"
