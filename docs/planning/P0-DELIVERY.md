# P0 — preparation checklist

P0 is **preparation**, not one of the four mandatory functional phases P1–P4. `ts.md §26` is normative.

| Deliverable | Status | Evidence |
| --- | --- | --- |
| Independent repository | DONE | bootstrapped main, changes in Draft PRs only |
| Normative specification / pinned refs | IN DRAFT PR #1 | `ts.md`, source provenance |
| Development rules | IN DRAFT PR #1 | `AGENTS.md` |
| Canonical five-plan tariff config | IN DRAFT PR #1 | `apps/api/config/plans.php` |
| Runtime PHP floor and config check | VERIFIED IN CI | prior PR #1's foundation workflows |
| Real Laravel 13.4+ API skeleton | IN DRAFT PR #2 | `apps/api/` with locked Laravel 13.39.0; CI must prove boot |
| Vue 3 TS/Vite PWA skeleton | IN DRAFT PR #2 | `apps/web/` with frozen pnpm lock; CI must prove build |
| PostgreSQL18/GarageS3 disposable validation | IN DRAFT PR #2 | `compose.p0.yml`, `p0-02-storage.yml` |
| Shared Fieldwork shell | P0 SKELETON | neutral header/dock with five placeholder routes; App Appearance 1.3 later in P2 |
| Real signed/replay-protected Identity and Local-First media | NOT STARTED | P1 selective PB2 port; do not claim functional yet |
| Signed PWA independent trust anchor | OPEN | ADR-0001; SW intentionally not registered |
| Full UX, Matrix, backups, billing, admin, S3 replicas | NOT STARTED | P2–P4 scoped mandatory features |

**Local limitation:** the available local PHP 8.4.24 is below the mandatory security floor; no local Laravel boot was attempted. A green GitHub Actions status only verifies the tasks listed in each workflow. No user data is imported or modified.
