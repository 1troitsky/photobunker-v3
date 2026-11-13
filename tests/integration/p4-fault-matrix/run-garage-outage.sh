#!/usr/bin/env bash
# ONLY for the disposable GitHub Actions PostgreSQL18 + Garage2.5 CI job.
# Stops and restarts the *already isolated* Garage container; never production.
set -euo pipefail

if [[ "$GITHUB_ACTIONS" != true ||
      "$PB3_ISOLATED_STORAGE_SMOKE" != 1 ||
      "$APP_ENV" != testing ||
      "$DB_CONNECTION" != pgsql ||
      "$DB_HOST" != 127.0.0.1 ||
      "$DB_DATABASE" != pb3_ci_p0 ||
      "$S3_ENDPOINT" != http://127.0.0.1:3900 ||
      "$S3_BUCKET" != pb3-ci-p0 ||
      -z "$RUNNER_TEMP" ]]; then
  echo "P4 fault matrix REFUSED outside disposable CI" >&2
  exit 1
fi

if [[ "$(docker inspect -f '{{.State.Running}}' pb3-p0-garage)" != true ]]; then
  echo "P4 fault matrix REFUSED: original Garage container is not live" >&2
  exit 1
fi
if [[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' pb3-p0-garage)" != host ]]; then
  echo "P4 fault matrix REFUSED: Garage is not on isolated CI host network" >&2
  exit 1
fi

export P4_FAULT_FIXTURE="$RUNNER_TEMP/pb3-p4-fault-fixture.json"
if [[ -e "$P4_FAULT_FIXTURE" ]]; then
  echo "P4 fault matrix REFUSED: stale fixture state" >&2
  exit 1
fi
stopped=false
cleanup() {
  # Crucial: never leave even disposable storage offline when the test fails.
  if [[ "$stopped" == true ]]; then
    docker start pb3-p0-garage >/dev/null 2>&1 || true
  fi
  rm -f "$P4_FAULT_FIXTURE"
}
trap cleanup EXIT

php tests/integration/p4-fault-matrix/garage-outage.php prepare
docker stop -t 5 pb3-p0-garage >/dev/null
stopped=true
if [[ "$(docker inspect -f '{{.State.Running}}' pb3-p0-garage)" != false ]]; then
  echo "P4 fault matrix FAIL: Garage did not stop" >&2
  exit 1
fi
php tests/integration/p4-fault-matrix/garage-outage.php s3-down

docker start pb3-p0-garage >/dev/null
# Keep trap armed until startup and recovery finish successfully.
for attempt in $(seq 1 30); do
  if docker exec pb3-p0-garage /garage status >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec pb3-p0-garage /garage status >/dev/null 2>&1; then
  echo "P4 fault matrix FAIL: Garage did not restart" >&2
  exit 1
fi
php tests/integration/p4-fault-matrix/garage-outage.php recover
stopped=false
echo "P4 fault matrix COMPLETE: actual Garage outage and retry verified; no Matrix/Backup claims"
