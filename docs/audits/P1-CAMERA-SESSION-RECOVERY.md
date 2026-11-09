# P1 camera session recovery — R2-02

Date: 2026-11-09. Base: `p1/04-offline-accepted-assignments` @
`3b6454f079d750994a022f8b85e8ae4dc07c3bb4`. Branch:
`fix/p1-camera-session-race`. Scope: camera lifecycle and regression tests.

## Cause and change

`CaptureView` treated replacement of the Session object as a different camera
owner. Online hydration intentionally replaces the local Session while retaining
the same account, device and keys. A late getUserMedia result was therefore
stopped. The session watcher had already skipped starting another request because
`starting` was still true, leaving the preview inactive until a manual click.

The camera now compares an in-memory identity snapshot: account/device IDs,
public device identity, key handles, complete account key material and revision.
`online` and Session/package object references are not ownership. Key handles are
compared conservatively: a changed CryptoKey handle is a boundary and triggers
automatic reacquisition rather than assuming equivalence of opaque keys. No keys
are exported, serialized, persisted or logged by this comparison.

A generation counter invalidates work on real ownership changes, Stop and
unmount, including logout → return to the same identity. The synchronous session
watcher immediately stops and detaches old streams. Requests remain serialized
while native getUserMedia/play is pending; an obsolete completion stops its
tracks before one request for the current identity can start. Permission/play
errors require explicit retry, preventing an automatic failure loop. Start is
disabled while pending and Stop can cancel the pending intent.

Ownership is checked after permission, after play, after JPEG encoding and
after signed policy binding, before invoking the encrypted capture pipeline.
Old results/errors cannot display a previous identity's frame or status. Camera
policy refresh similarly drops stale account results and drains a queued refresh
after hydration. Existing signature validation, cached-policy semantics, photo
encryption and server authorization remain unchanged.

## Regressions and commands

`AGENTS.md`, P1 capture-policy/signed-state/offline-assignment documentation,
Session/storage contracts and the R2-02 reference were reviewed. No
`CHATBOT-AGENTS.md` exists in this base. QA branches were used read-only for
reference and local fixture orchestration; no QA commits were imported.

```sh
pnpm install --frozen-lockfile
pnpm test:web
pnpm typecheck
pnpm build
# With the isolated API/PostgreSQL/Garage fixture described in CI:
pnpm exec playwright test --config tests/playwright.config.ts
```

Existing CI `p0-02-storage.yml` provisions the real isolated DB/S3 and launches
Laravel/Vite for that last command. The default Playwright config now includes
the new camera spec, so the new regressions also run under that CI command.

| Check | Actual result / artifact |
| --- | --- |
| Before fix: targeted late-permission regression | Expected FAIL, exit 1; `/tmp/pb3-camera-baseline-unit.log` |
| `pnpm test:web` | PASS, exit 0; **43 tests**, including **24 camera component cases** |
| `pnpm typecheck` | PASS, exit 0 |
| `pnpm build` | PASS, exit 0 |
| Chromium Playwright | PASS, exit 0; **10/10**, no retries: six new cases and four unchanged P1 scenarios |
| PHP security floor | PASS, exit 0; PHP **8.4.27** |
| PHPUnit | PASS, exit 0; **35 tests / 355 assertions** |
| Strict Composer validation, migrate, health/readiness | PASS, exit 0 |
| PostgreSQL 18.6 / Garage 2.5 integration scripts | PASS, exit 0; both existing readback/lifecycle smoke scripts |
| API, migrations, specification boundaries | PASS: `git diff --exit-code BASE -- apps/api ts.md`, exit 0 |

[Sanitized evidence](P1-CAMERA-SESSION-RECOVERY-EVIDENCE.json) records commands,
exit codes, browser outcomes, raw timing samples and SHA-256 of the tested source
files. Private fixture artifacts are in `$TMPDIR/pb3-acceptance-lxld0fu8/`,
including `summary.json`, JUnit and Playwright JSON. Vitest log:
`/tmp/pb3-camera-vitest.log`. Fixture setup/cleanup reused the existing isolated
QA runner without adding it to this branch or weakening its safety guards.

Component tests cover late permission, equivalent Session/package replacement,
real account/device/key changes, logout/return, unmount before permission or
play completion, explicit Stop while pending, denial/retry, duplicate starts,
stale play failures, stale policy responses and ownership changes during JPEG
encoding or signed binding. These use controlled jsdom media/video mocks.

The new Chromium tests use real browser APIs with a synthetic camera. They
confirm one live stream during hydration; no restart for equivalent Session;
genuine logout/register of another account while permission is pending; cleanup
on route departure; denied-permission retry; and offline encrypted v2 capture
under an already verified signed policy after late hydration. The last case
uploads to real Garage after reconnection and verifies unchanged ciphertext
digests. The original A→B→A, grant/revoke and accepted-assignment warm-offline
scenarios from PR #16 all pass unchanged.

## Comparable laboratory observations

Exact base and fixed production builds were served sequentially on the same
preview URL `/camera`, same machine/Chromium, fresh profile, 390×844 viewport,
five warm navigations each. This measures the anonymous shell, not camera
hardware or permission latency. No performance budget was invented.

| Median, ms | Base | Fixed |
| --- | --- | --- |
| responseEnd | 1.2 | 1.3 |
| DOMContentLoaded | 8.0 | 8.0 |
| loadEventEnd | 8.3 | 8.4 |

Production JS: 291.86 → 292.95 kB; gzip 95.65 → 96.09 kB. These are local
Navigation Timing/build observations, not Lighthouse/RUM or a statistically
established performance change. Browser assertions additionally establish one
getUserMedia request/one live stream for late same-identity hydration.

## Limits and unchanged boundaries

**Native Safari and physical iOS/Android: NOT TESTED.** Real permission dialogs,
camera hardware, system gallery, long suspend/background behavior and platform
autoplay restrictions still need device acceptance. A native pending permission
promise cannot be cancelled by this component; cancellation invalidates the
intent, and every returned late stream is stopped without being attached or
reopening the camera. Chromium synthetic media and jsdom do not replace that
hardware validation. Full visual comparison remains NOT VERIFIED; no layout or
design-system changes were made.

`session.ts`, API code (including `Photo/Reservation.php`), assignment timestamps,
migrations, `ts.md`, main and PR #11–17 are unchanged. No Service Worker was
registered or enabled. No merge, deployment or customer data operation occurred.
