# PB3 P4 fault matrix — Issue #241

Source: `ts.md` §§21.3–21.4, 25.25, 26 P4.

This **runs against the same disposable PostgreSQL 18 and Garage 2.5** that the repository's storage CI provisions. It cannot be used against any non-CI endpoint or bucket. It uses random **synthetic ciphertext**; no user media, account IDs or cloud secrets are embedded.

## Execution (automatically in GitHub Actions)

Existing `.github/workflows/p0-02-storage.yml` invokes:

```sh
bash ../../tests/integration/p4-fault-matrix/run-garage-outage.sh
```

from `apps/api` **after** the original Garage readback and lifecycle smoke, **before** the health probes and Chromium suite. The shell runner and PHP entrypoint independently enforce exact `testing` environment, disposable `pb3-ci-p0` Postgres database and `pb3-ci-p0` Garage bucket on loopback. Shell runner additionally requires the actual CI Garage container and its host networking. It always attempts to restart the container if interrupted; no production storage is touched.

The three-phase script `apps/api/tests/integration/p4-fault-matrix/garage-outage.php` is deliberately not a normal unit test:

1. **Prepare:** persist one synthetic, valid-SHA ciphertext object to actual Garage; create pending two-hour-old photo, uploading object and reserved placement in actual PostgreSQL. No plaintext PII.
2. **Garage outage:** `docker stop` the disposable Garage container. PostgreSQL remains reachable. Call **production** `Lifecycle::reconcileStalledUploads(1)`; it must record `errors=1`, *not* `verified`, `reset`, `deferred` or an ACK. Confirm the pending state, upload lease and placement survived.
3. **Garage recovery:** restart the same container with persistent test metadata; read and SHA-256-verify the **original** object, resume reconciliation (exactly one `verified`, one retry reports no change). Independently inject one unreachable *local PG connection* (not stop the real PG service) and assert cleanup fails while S3 bytes survive. Restore DB connection, expire the synthetic photo, confirm physical S3 delete and DB placement removal, tombstone persistence, duplicate cleanup no-op and two later S3 writes removed in successive sweeps.

## Evidence matrix

The following are **test targets, not predeclared PASS results**. A scenario is PASS only on an exact commit whose GitHub Actions log contains the corresponding check and whose full workflow concludes `success`.

| Failure scenario | Test level | Expected check |
| --- | --- | --- |
| Primary S3 unreachable while PostgreSQL works | **REAL disposable Garage stop** | No false success, durable pending and object placement |
| Garage restart after an unacknowledged upload | **REAL same storage + PostgreSQL** | SHA-256 readback and single promotion |
| Repeated reconciliation / duplicate ACK | **REAL recovery path** | Exactly one promotion, subsequent reconciliation no-op |
| Primary DB inaccessible while storage works | **Injected unreachable PG connection** | No false cleanup, preserved Garage ciphertext, recovered DB still accessible |
| TTL expiry, physical GC and repeated late PUT | **REAL S3 + PostgreSQL** | Tombstone, clean DB locations, repeated sweep removes late ciphertext |
| Matrix/Synapse unavailable or device trust changes | **NOT TESTED** | Requires independent real Matrix environment and signed trust fixtures |
| Backup interrupted during generation/verify | **NOT TESTED** | Requires integrated Recovery Vault and Backup job pipeline |
| Authenticated revoked/expired device | **NOT TESTED** here | Separate signed Identity/ACL acceptance; cannot be inferred from storage test |
| Secondary BYO S3 replica/failover | **NOT TESTED** | Requires operational second adapter/provider and integrity verification |
| iOS Safari and physical devices | **NOT TESTED** | Requires real device acceptance |

Operational limitations: no system-wide load, queue reliability or Matrix outage is proven; single-node Garage outage is **not** equivalent to multi-provider failover. A simulated unreachable DB connection is **not** equivalent to stopping the live PostgreSQL container. The test does not enable production cleanup or alter client crypto/ACL/UX. Running automatically before the full Chromium suite ensures storage is restored; a failed outage test is a **failure gate**, not a warning-only job.

On each CI run record **PR number, exact HEAD, all workflow conclusions, guard results, and Chromium count** in the PR and Issue. Preserve failed attempts in Actions history; do not skip or weaken existing tests.
