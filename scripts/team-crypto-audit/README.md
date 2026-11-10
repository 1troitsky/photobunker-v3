# Independent P1-29C audit (task 08)

Audited product: #59 `ff9c7bab2485c7d2cfd094e67fdb505a1221ee00`, based on
independently audited #57 `65f0c1a27a342ebfe5044ee1af7bb8cad27738ed`.
Original QA #55/#58 are read-only. Product corrections are in separate Draft
#60 `54f984162451e44e49d374ba5c08cb3a2b7a0536`.

```sh
git worktree add --detach /private/tmp/pb3-r08-product ff9c7bab2485c7d2cfd094e67fdb505a1221ee00
python3 -B scripts/team-crypto-audit/run.py --source-root /private/tmp/pb3-r08-product --diagnose-media

git worktree add --detach /private/tmp/pb3-r08-fix 54f984162451e44e49d374ba5c08cb3a2b7a0536
python3 -B scripts/team-crypto-audit/run.py --source-root /private/tmp/pb3-r08-fix \
  --target-ref 54f984162451e44e49d374ba5c08cb3a2b7a0536 --diagnose-media
python3 -B scripts/team-crypto-audit/analyze.py /private/tmp/pb3-r08-fix
```

Requires Docker, Node22/pnpm10.20.0, installed Playwright Chromium and free
loopback ports 8000/5173/4173. Installs locked dependencies, enforces PHP floor,
runs all PHP8.4/8.5, Vitest/TS/build, PostgreSQL18/Garage2.5, product Chromium,
media diagnostics and independent scenarios. Every fixture uses a new random
Compose project and tmpfs; no existing data or services. No unsigned SW is
registered. `--focused` omits previously completed full gates; no automatic retries.

PHP8.5 Dockerfile uses the image's built-in DOM/lexbor and only compiles missing
pdo_pgsql/zip. Original redundant DOM rebuild failed and is preserved; a separate
baseline PHP8.5 run supplies its actual result. Tests stop on a rejected PHP floor.
The maintained local-acceptance helper and isolation test are retained from #58.

The original 45 invariants are reused, followed by v2 invitation/consent exact
Lost ACK across reload, B rejoin, C survival/current-member fallback, signed role
replay, invitation-revision floor, epoch4 exact pending union, privacy and genuine
signature/fork checks. Adversarial transport is explicit; crypto and success are
real. No assertion is weakened or marked expected failure.

`fixture.php` is copied ONLY into the private API fixture. It refuses non-testing,
non-PostgreSQL/non-loopback databases and requires the owned synthetic team scope.
For deterministic timestamp collision it temporarily aligns one genuine old role
receipt's unsigned created_at with new consent, preserving its signed contract,
then restores the timestamp. This models the real one-second DB precision.
For overlap, one bounded lock-holder and two independent PHP controller processes
block on the same real PostgreSQL Team row. pg_stat_activity must show >=2 waiters
before release. Trusted test Sessions are supplied to the real controllers; HTTP
session/CSRF is exercised separately by browser paths. This is not a claim of a
production HTTP load test. No destructive resets or production locks are tested.

Real private Team DEKs (base64url and hex) are captured only into chmod600 fixture
canaries for pg_dump/container-log scanning, alongside random names/descriptions.
Private cache IDs are checked separately. Public technical IDs in backend ledgers
and URL logs are expected under ts.md; no claim of server metadata anonymity.
Never publish private traces, scope files, keys or fixture directories.

Historical 422 can be investigated from its PRIVATE trace and isolated API copy:

```sh
python3 -B scripts/team-crypto-audit/media422.py --trace <private-trace.zip> \
  --runtime <private-api-copy-with-vendor>
```

This exports only predicates/hashes and validates the exact old contract with a
controlled server clock in network-none PHP. Validator result 200 means validation
passed, not a fabricated HTTP success. The original server millisecond time is
unknown; no broad claim that historical 422 is fixed is permitted.

Public evidence export after committing reproduction sources:

```sh
python3 -B scripts/team-crypto-audit/export.py --qa-source <qa-code-commit> \
  --chain /private/tmp/pb3-r08-chain.json --media-probe /private/tmp/pb3-r08-media422-probe.json \
  <baseline-run> <supplemental-php85-run> <fixed-run>
```

Allowlisted commands/statuses/counts/technical proofs only; credentials and private
canaries cause export rejection, disposable S3 key IDs are redacted. Final source
SHA is a reproduction snapshot, not an invented per-run commit for the evolving QA.
Native Safari/iPhone/Android, full cache/device rollback, production migration locks
and independent trust anchor remain unverified/out of scope. Old #54 is provenance,
not another branch to merge. Main, merge and deploy stay untouched.
