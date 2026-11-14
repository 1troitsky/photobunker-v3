# P4 #241 — real disposable PostgreSQL 18 outage/recovery acceptance · CHAT-W · 2026-11-14

## Scope, provenance

- Exact accepted base main: `8ed66c438d090efd218efa80b027f0b2f854db4b`. Issue #241 was already REVIEW for real Garage stop/restart [PR #259]; its PostgreSQL outage evidence previously used only an injected unreachable connection.
- Own exclusive claim on #241, synchronized via journal #302. New branch `qa/p4-241-real-postgres-outage-chat-w-20261114`, four NEW paths only: own workflow, own shell runner, own disposable database sentinel PHP script, this audit.
- No existing product, identity, storage, rates, workflows or tests changed. No mutation to other agents' branches, main or production systems.

## Real negative acceptance

Dedicated GitHub Actions runner starts a separately provisioned `postgres:18` service with exact disposable `pb3_ci_pg_outage` credentials. Before any stop, independent environment guards verify GitHub context, Laravel test environment, loopback database, image ID and service's exact database ownership. It creates one synthetic hashed sentinel row only in a uniquely named table and launches an actual Laravel development HTTP server on loopback.

1. **Healthy**: `GET /api/readyz` is HTTP 200 `status=ready`, `GET /api/healthz` is HTTP 200 `status=ok` and sentinel hash is present.
2. **Actual PostgreSQL outage**: `docker stop` on precisely the job's disposable database container; independently verify `.State.Running=false`. With Laravel server STILL running, `/api/readyz` must be HTTP 503 `status=unavailable`; liveness `/api/healthz` must stay HTTP 200. A stale green readiness result fails CI.
3. **Physical recovery**: `docker start` the SAME service, bounded readiness retry, verify 200/200 and that original synthetic sentinel row and hash are unchanged.
4. Cleanup traps restart the disposable container even if an assertion fails, stop only the spawned local PHP server, and drop only the uniquely named sentinel in the guarded disposable test database.

No real user data, S3 credentials, destructive persistent operations, public API, bypassed crypto or synthetic HTTP ACK is introduced. Tests are independent of the P4 Garage outage already covered by the base CI.

## Evidence gates

- **NOT TESTED until exact-head workflow finishes**: dedicated real PostgreSQL stop/restart, readiness/liveness checks and retained sentinel. The CLI source and test assertions are NOT itself evidence.
- Separate repository Foundation/Security/UX and PG18/Garage/Chromium must also pass on exact PR HEAD. Record exact SHA, workflow IDs, terminal outcomes, and any failures in Issue #241 and PR.
- **Still NOT TESTED**: DB outage while real production requests are mid-transaction, background queue crash/retry, payment/Matrix/backup, independent backup/S3 replica, physical mobile devices and complete P4 release. Stop/start of one disposable DB does not establish failover availability.
- Never enable this runner against an external or non-CI endpoint. No merge to main without owner's approval.
