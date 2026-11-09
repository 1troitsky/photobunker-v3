# P0 — preparation checklist

P0 is **preparation**, not the first of the four functional phases P1–P4. `ts.md §26` is normative.

| Deliverable | State | Evidence / next action |
| --- | --- | --- |
| Separate repository, independent history | DONE | initial README bootstrap on `main`, P0 changes via Draft PR |
| Final PB3 specification + UX pinned SHAs | IN PR | `ts.md`, `docs/architecture/PB2-PROVENANCE.md` |
| Contributor/agent guardrails | IN PR | `AGENTS.md` |
| Brand configuration without fixed name | INITIAL | `apps/api/config/brand.php` and `.env.example`; Vue/PWA integration is next |
| Five-plan canonical tariff registry | INITIAL | `apps/api/config/plans.php`; quoted plan values from `ts.md §8` |
| Technical operational limits | INITIAL | `apps/api/config/operational_limits.php`; enforced counters/leases are P1/P3 |
| PHP patch-floor enforcement | INITIAL | Composer constraints + standalone runtime guard + workflow |
| Laravel ≥13.4 install, pinned composer.lock, route:list | TODO | Bootstrap real Laravel app using **supported secure PHP**; do not claim tests passed prematurely |
| PostgreSQL 18 / Garage and migrations | TODO | Compose/staging only after real backend scaffold |
| Targeted PB2 selective port + integration tests | TODO | Build from listed source contracts, fix baseline PHP routes first |
| PWA signed releases / independently anchored trust | DESIGN TODO | Signed manifest signing-key separation ADR + CI after frontend build |
| P1 vertical-journey issues | TODO | Camera→encrypted outbox→S3; Assignment A→B; Matrix A↔B |

**Current local limitation:** available CLI PHP **8.4.24** is below required **8.4.27**; no runtime, vendor install, Laravel boot, migrations or E2E have been claimed. Secure GitHub Actions PHP 8.4/8.5 checks must run and pass before promoting the P0 foundation.

**Next code-oriented increment:** create the real Laravel 13.4+ skeleton and Vue PWA scaffold with lockfiles on a **separate follow-up branch**, then selectively port PB2 Identity/PhotoSync contracts. This PR intentionally sets guardrails first rather than producing an unbootable pseudo-Laravel app.
