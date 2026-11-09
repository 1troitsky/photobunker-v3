# Local acceptance of P1-04

Baseline: `p1/04-assignment-e2ee-capture` at
`e72c350d8926bcac17c515acef6eb1dc884c6206`. Work branch:
`qa/p1-local-acceptance`. Product files and original E2E tests stay unchanged.

From the repository root:

```sh
python3 scripts/local-acceptance/run.py
```

Prerequisites: Python 3, Git, Node 22+, pnpm **10.20.0**, running Docker with
Compose v2+, internet for locked dependencies/images/browser installation, and
free loopback ports **8000, 5173, 4173** (fixed by existing product/CI configs).
The runner refuses to reuse an occupied port. Never stop unrelated services to
make this command work. `--frontend-only` runs the independent frontend checks.

The command builds PHP **8.4.27** with Composer and the PostgreSQL/SQLite test
extensions; enforces the existing PHP security gate before boot; installs the
unchanged Composer/pnpm lockfiles; runs strict Composer validation, PHP lint,
plan registry, Laravel routes, PHPUnit, Vitest, TypeScript, production build,
both original Garage/PostgreSQL integration scripts, all four original Chromium
E2E tests, and separate local resilience tests. Failed checks do not prevent
independent checks. Dependency failures mark downstream checks `NOT TESTED`.

Additional browser checks cover registration error/loading/retry, upload 503,
direct IndexedDB ciphertext/digest inspection, durable operation IDs after
reload, a server-committed finalize with lost response, duplicate prevention,
same-profile account isolation, simulated camera denial/recovery and track
shutdown, keyboard activation/back navigation, 320/375/390/768px widths, and cold
offline reload. Camera frames and denial are **synthetic**. Cold offline reload
is a known failing gate while Service Worker registration is intentionally off;
the harness reports the failure and returns nonzero, without suppressing it.

Native Safari is probed using installed `safaridriver`. An absent driver or
disabled **Allow Remote Automation** is `NOT TESTED`, exit 77 in its own log.
The harness never enables OS/browser permissions. Safari's probe checks actual
rendering, IndexedDB persistence of nonextractable CryptoKeys and AES-GCM
roundtrip. It does not substitute WebKit for Safari and does not establish
real-device camera/GPS/PWA behavior. iPhone/Android hardware and system gallery
absence still require a physical-device manual test.

Five warm **production preview** navigations are measured before and after the
browser checks, with the same Chromium, 390×844 viewport, URL and bundle. The
Playwright JSON attachments contain raw Navigation Timing samples. These are
local laboratory observations, **not Lighthouse, RUM, a performance budget or a
claimed improvement**. No product changes are made by the harness.

Every run creates a private `pb3-acceptance-*` temporary directory and prints
its absolute path. `summary.json` records command, cwd, exit code, duration,
status and log for each executed step. Playwright JSON reports, JUnit XML in
`api/`, screenshots and performance attachments are stored there. `NOT TESTED`
does not mean passed; exit 0 means no executed check failed, so always inspect
the summary for skipped coverage. Missing Docker or setup errors return nonzero.

Isolation is enforced through a random `pb3-accept-*` Compose project, a copied
API tree, new disposable database and S3 credentials, and tmpfs PostgreSQL/Garage
data. No host `.env`, external database endpoint, existing bucket or container
is used. CI's exact localhost/bucket/database guards remain intact through a
shared **new** container network namespace. API code in the checkout is mounted
read-only; Composer/runtime output goes into the private copy. Frontend build
and dependencies use their existing ignored paths. Cleanup stops only the
runner's processes and Compose project; it never uses prune or volume deletion.
It runs on ordinary errors and Ctrl-C. A forced termination may require running
the exact `docker compose --project-name ... --env-file ... -f ... down` command
from that run's log; do not use broad container cleanup commands.

Do not commit or upload raw temporary artifacts: original product failure traces
can contain synthetic Recovery Keys, sessions and decrypted test media. Publish
only reviewed, sanitized audit evidence in `docs/audits/`. The temporary
`compose.env` is mode 0600 and its directory mode 0700. Remove only the exact
printed temporary directory when its private artifacts are no longer needed.

To export reviewable metadata without credential files, request bodies, traces
or screenshots (replace the argument with the printed run directory):

```sh
python3 scripts/local-acceptance/export-evidence.py /path/to/pb3-acceptance-RUN
```

The exporter writes JSON to stdout: normalized commands/exit codes, version
probes, browser test names/results and raw performance samples. It does not
decide whether a failed scenario is an application defect or a harness problem;
that diagnosis belongs in the reviewed audit.

Current verification limits and the recovery test's final, unexecuted timing
correction are recorded in `docs/audits/P1-LOCAL-ACCEPTANCE.md`. Do not infer a
green full acceptance run from the presence of this harness.
