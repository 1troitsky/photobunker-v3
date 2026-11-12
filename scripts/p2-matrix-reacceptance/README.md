# Bounded independent re-acceptance of PR81

Only product SHA `5f13992b94b90157a38d25b3fe27543e3e8642f1` is accepted.
Reuses the independent PR77 setup and browser helpers, with new narrowly scoped
scenarios. No product edits, schema resets, fake PB3 Session or auth responses.

Requires local Docker/OrbStack, OpenSSL, Node22, pnpm10.20, product frozen
dependencies/Playwright Chromium, and existing **read-only** `pb3-local_vendor`
volume with Composer lock identical to the primary worktree. This is the
existing local harness, not a general production provisioning system.

Use fresh `RUN`; it must not already exist. Ports5173/8000/443 must be free.
Only disposable fixture data may be used. Stock Vite config is used unchanged.

```sh
pnpm --dir "$PRODUCT" install --frozen-lockfile
python3 scripts/p2-matrix-reacceptance/setup.py "$PRODUCT" "$RUN"
node scripts/p2-matrix-reacceptance/run.mjs "$PRODUCT" "$RUN"
python3 scripts/p2-matrix-reacceptance/check.py "$PRODUCT"
```

The HTTPS Node adapter verifies the exact local CA. Chromium gets only the
fixture certificate's SPKI pin and local test DNS mapping, not a global TLS
bypass or system trust change. Official Node RustCrypto clients observe real
Synapse accounts; production PB3 UI executes the self-revoke/logout requests.

Actual signed rotation is performed using existing production crypto/API
primitives. No DB revision UPDATE. Real rev2 POST201 commits before the ACK is
dropped; after actual page reload the exact signed POST must replay with200.
Read-only row hashes verify legacy ciphertext and exactly one rev2 successor.
Changed AKEK is exercised through another genuine signed rotation. Root
negative corrupts only the previous receipt signature using a different real
PB3 root; it does not install a fake Session or claim root migration support.

Self/other-device revocation uses real Settings UI and explicit confirmation.
The success gate requires old-bearer whoami401, not a logout200 alone. Only
the failure scenario aborts the browser's logout transport; PB3 must still
lock and explicitly leave Matrix remote revocation unconfirmed.

No automatic whole-suite reruns. Standard PB3/Synapse security limits remain
enabled. If diagnostics are necessary, preserve failed public checkpoints and
private fixture data; stop after two diagnosed failures of the same cause.

Runtime exit0 means observations completed; inspect individual PASS/FAIL/
BLOCKED rows. M-01/M-04/full Panic stay BLOCKED. Never run against a real
homeserver/account or print tokens, recovery material, signed request bodies,
raw server logs or SQL dumps. Back up disposable DB privately before stopping
only this fixture's services. Do not delete previous escrows to obtain PASS.
