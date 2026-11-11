# Independent P2 Matrix local audit

Product is **only** `e39b619dc9ec36eefc9ac322367e2d4348a1508e`. The report and all
scripts are QA-only; no product import, patch, fake Identity, fake Contact,
fake whoami, fake trust or fake crypto lease. Do not run against production.

Prerequisites: Docker/OrbStack, OpenSSL, Node22, pnpm10.20, installed Chromium
for the product's Playwright1.56.1, frozen product dependencies. This local
fixture reuses the already installed **read-only** `pb3-local_vendor` Docker
volume. Its Composer lock is checked against the original primary worktree;
PHP8.4.27/Laravel13.39 are separately recorded. This is a local harness, not a
replacement deployment system or a portable fresh-machine provisioning promise.

Use separate product and QA worktrees. `PRODUCT` and `RUN` below are caller
paths; `RUN` must be new and private. Main's application remains on5173/8000;
audit uses5175/8002 and a loopback-only443 TLS proxy. Ports must be free.

```sh
pnpm --dir "$PRODUCT" install --frozen-lockfile
python3 scripts/p2-matrix-audit/topology.py "$PRODUCT"
python3 scripts/p2-matrix-audit/setup.py "$PRODUCT" "$RUN"
PB3_AUDIT_FOCUSED_ESCROW=1 node scripts/p2-matrix-audit/browser.mjs "$PRODUCT" "$RUN"
PB3_AUDIT_UI_ONLY=1 node scripts/p2-matrix-audit/browser.mjs "$PRODUCT" "$RUN"
```

The focused runner establishes real TLS Synapse whoami and PB3 account/device
signatures, bootstraps real Matrix4S, escrows its actual seed through production
PB3 code, reloads a real page, recovers the seed in a new browser, checks its
live4S MAC, rotates a **genuine Recovery Key** through the signed challenge/proof
HTTP protocol and records the resulting409/409 and preserved original ciphertext.
No SQL revision update or manual binding/account inserts are used.

**Exit0 means the audit observations completed, not acceptance.** M-02 is
deliberately emitted as product **FAIL**. Unexpected assertions stop that runner
with exit1 and save only a sanitized checkpoint; raw errors remain private.
No automatic retry of the whole journey. Existing successful CI is not rerun.

Keep a failed fixture and its escrow intact. Do not repeatedly log into its
Matrix users or reset their cross-signing. In this execution the first focused
fixture user was retained after a QA timing failure; the final focused run used
the independently fresh, already registered `third` fixture user:

```sh
PB3_AUDIT_FOCUSED_ESCROW=1 PB3_AUDIT_MATRIX_USER=third \
  node scripts/p2-matrix-audit/browser.mjs "$PRODUCT" "$RUN"
```

The default setup adds `/matrix/v1` **only in the temporary QA Vite config** to
investigate downstream APIs after detecting the product's missing dev proxy.
To reproduce that original404 in a fresh disposable fixture, use
`PB3_AUDIT_STOCK_PROXY=1` with setup; JSON GET `/matrix/v1/me` through Vite returns404,
whereas the direct exact-product API returns401 without authentication. No
production fix is included here. `browser.mjs` without a mode retains the
original discovery scenario, with bounded waits and paced actual PB3 requests;
its full delivery branch is **not** independently accepted at this product SHA.

Request pacing preserves standard PB3 throttles. Separate fixtures preserve
Synapse defaults; no rate-limit bypass or TLS verification disabling. The SDK
HTTPS adapter accepts strings, URL and Request objects but can contact only the
fixed disposable origin, using the exact local fixture certificate as its CA.
The product API independently verifies TLS with that same explicit test CA.

For the empty migration cycle, copy `migrations.php` into `RUN` and run
`docker compose --env-file "$RUN/.env" -f "$RUN/compose.json" exec -T api php /audit/migrations.php`
**before enrollment**. The same command on populated tables exercises both
rollback refusal guards and compares every row hash. It rejects any DB name
other than `pb3_audit`. Never use `migrate:fresh`, truncate, or routine populated
rollback as a way to make the audit pass.

Keep secrets, account files, raw server logs and Chrome diagnostics in `RUN`
only, with private permissions. Do not commit screenshots/traces containing
Recovery Keys. Public JSON deliberately contains statuses, counts and hashes
only. Stop the task's own Vite process and Compose services after private
database backups; do not use `down -v` or affect the owner's main stack.
