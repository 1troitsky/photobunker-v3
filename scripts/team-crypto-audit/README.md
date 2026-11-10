# Independent Teams audit

Product is pinned to `03bcc0880521ebcc9145f134233d39be6a339c2c`. The QA branch
contains only tooling, tests and evidence. `scripts/local-acceptance/{run.py,
compose.yml,Dockerfile}` and its isolation test are reused unchanged from QA
commit `98f2545dd70b8c03a0f13015d8d3cd9aa22f459b`; the subclass supplies this
audit's SHA. Do not run the historical base runner directly.

```sh
git worktree add --detach /private/tmp/pb3-team-audit-product 03bcc0880521ebcc9145f134233d39be6a339c2c
python3 -B scripts/team-crypto-audit/analyze.py /private/tmp/pb3-team-audit-product
python3 -B scripts/team-crypto-audit/run.py --source-root /private/tmp/pb3-team-audit-product
```

Requires Node 22, pnpm 10.20.0, Docker, cached/installed Playwright Chromium and
free loopback ports 8000/5173/4173. Installs locked dependencies, enforces PHP
security floor, runs PHP/Vitest/TS/build, PostgreSQL18/Garage2.5 smoke, all 19
product Chromium tests and the independent audit. No unsigned SW is registered.
All fixtures are synthetic in a new random Compose project with tmpfs. Existing
services, user data and Git product refs are untouched.

`--focused` runs only the independent audit in a fresh fixture.
`--focused --diagnose-media` additionally rechecks the three existing media
scenarios once with response metadata instrumentation. It makes temporary copies
of the exact product tests and changes only their test-fixture import; assertions,
waits and HTTP requests stay unchanged. It refuses an existing reference folder.
There are no retries or loop-until-green. Keep original failures. Stop after two
diagnosed failures of the same cause.

The independent test uses four real browser accounts: A owns; B/C consent; D
remains pending. It checks real key generation/decryption, role change, competing
revisions, quarantine, forged contracts, encrypted durable outbox, pre-delivery
outage, server-committed Lost ACK across reload and exact retry. Expected security
invariants fail visibly on the audited product: pending-invite sweep breaks owner
roster verification and previously verified epoch 2 can downgrade to epoch 1
through coherent historical response replay. These assertions are not marked
expected failures or weakened to obtain a green run.

The automatic runner's nonzero status is meaningful. Native hardware/Safari,
production locks and globally fresh state after total local rollback are outside
this fixture. Never publish private `pb3-acceptance-*` directories: original E2E
traces can include generated recovery material. Export only with `export.py`:

```sh
python3 -B scripts/team-crypto-audit/export.py --qa-source <qa-code-commit> \
  --chain /private/tmp/pb3-team-audit-chain.json <private-run-1> <private-run-2> <private-run-3>
```

The final QA SHA identifies delivered reproduction sources; it does not pretend
that the evolving harness had that SHA during earlier preserved runs.
