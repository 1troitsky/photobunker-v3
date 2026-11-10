# P1-29B remediation re-audit (task 07)

Audited product: PR #56 `41fa666b3cc54d351ce0d916fecf6e44973c97a5`.
Original QA PR #55 `7f653a590ab4a0b44a1e576ee4e5ea9ad07183bc` is read-only;
its FAIL/evidence remain available at that commit. Product corrections live in
separate Draft PR #57, `65f0c1a27a342ebfe5044ee1af7bb8cad27738ed`.

The retained isolation helper, Compose/Dockerfile and isolation test are unchanged
from QA #55. New tests reuse all original independent scenarios, require the
signed `retiredPendingInviteIds`, and add pending-list attacks, epoch 3, durable
freshness across reload, genuine signed fork, role rereads, unsigned revision
poisoning and real same-profile tab races. Cryptographic operations and network
success use the real product. Only explicitly hostile transport is intercepted.

```sh
git worktree add --detach /private/tmp/pb3-r07-product 41fa666b3cc54d351ce0d916fecf6e44973c97a5
python3 -B scripts/team-crypto-audit/run.py --source-root /private/tmp/pb3-r07-product --diagnose-media

git worktree add --detach /private/tmp/pb3-r07-fix 65f0c1a27a342ebfe5044ee1af7bb8cad27738ed
python3 -B scripts/team-crypto-audit/run.py --source-root /private/tmp/pb3-r07-fix \
  --target-ref 65f0c1a27a342ebfe5044ee1af7bb8cad27738ed --diagnose-media
python3 -B scripts/team-crypto-audit/analyze.py /private/tmp/pb3-r07-fix
```

Requires Docker, Node22/pnpm10.20.0 and installed Playwright Chromium; ports
8000/5173/4173 must be free. The runner pins HEAD, rejects unrelated targets,
checks the clean product source, enforces PHP security floor and provisions a
new random tmpfs PostgreSQL18/Garage2.5 fixture. All data are synthetic. Cleanup
only removes this run's services; no prune/reset/existing-data access. SW is not
registered. Source product and QA are separate worktrees; QA sources must exist
before provision. The historical base runner should not be called directly.

`--focused` skips already-completed PHP/frontend gates and runs browser audit in
a fresh fixture. `--diagnose-media` copies exact product media tests temporarily
and changes only the test-fixture import to attach passive response metadata.
Replacement is regex-based and MUST match exactly once. QA #55's old string
replacement missed compact imports; previous purported instrumented runs were
actually original tests. The corrected wrapper emits `media-network-*.json`.
It records no bodies/cookies/credentials; 401/422 alone remain actual failures.

No automatic retries. Preserve each first error; stop after two diagnosed failures
of one cause. Existing media assertions and timeouts are unchanged by the wrapper.
The separate product fix waits for real online hydration before the assignment
roster probe, retaining server authorization and JSON status checks.

To export public evidence, first commit the reproduction sources, then:

```sh
python3 -B scripts/team-crypto-audit/export.py --qa-source <qa-source-commit> \
  --chain /private/tmp/pb3-r07-chain.json <private-baseline-run> <private-fix-run>
```

Never publish private run directories or raw E2E traces, which can contain generated
recovery material. The exporter allowlists metadata/proofs, redacts disposable S3
key IDs and refuses fixture credentials/private canaries. The source SHA identifies
delivered reproduction sources, not a fabricated snapshot of the evolving baseline.
Native devices/Safari, production locks, full storage/device rollback and independent
JS trust anchors remain unverified. PR #54 compatibility is reported separately;
no product branch merge or deploy occurs in this workflow.
