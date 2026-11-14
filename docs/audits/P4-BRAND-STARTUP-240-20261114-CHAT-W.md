# P4 #240 — Laravel boot-time branding validation, stage 2 / CHAT-W

## Provenance and non-overlap
- Date: 2026-11-14, Asia/Tbilisi.
- Accepted immutable main: 8ed66c438d090efd218efa80b027f0b2f854db4b.
- Verified stage1 Draft PR #365 HEAD a2c6ad7166b0a4237f5a487fe66083d9b7441cdb (4/4 CI, 93/93 Chromium).
- This stage uses branch feat/p4-240-backend-startup-gate-chat-w-20261114, with source stage1 #365 as the direct commit ancestor. Draft #368 targets main ONLY as a cumulative CI/review candidate: full CI workflows ignore a feat/** PR base. Stage1 source is included in #368 and must not be integrated twice.
- Scope: existing apps/api/app/Providers/AppServiceProvider.php, NEW apps/api/tests/Feature/Branding/BrandStartupIntegrationTest.php and this NEW QA file. Stage1 validator and all outside paths untouched.

## Narrow actual product integration
- Laravel AppServiceProvider::boot() invokes previously reviewed ValidatedBrand::fromConfig() before registering rate limiters. Unsafe public origin/markup/support URL now fails application initialization rather than merely being rejected by a detached utility.
- Six additional Laravel Feature tests exercise real provider boot: production valid, insecure origin, support credentials, name injection, HTTP loopback local-vs-production, and explicitly still-allowed placeholder pre-release.
- The gate reads only local server config; no network calls, persistence, real identity, payment, legal approval, DNS validation, signed-PWA trust anchor, public route or externally reachable support endpoint.
- The example.invalid HTTPS pre-release default remains structurally valid so development and bootstrap are not incorrectly equated with release acceptance. Production deployment/domain/legal sign-off remain separate explicit gates.

## Evidence
- Source and own branch exact-head workflow links to be posted as comments on Issue #240 and this Draft PR once GitHub Actions finish.
- Full #240 P4: NOT TESTED / NOT COMPLETE (other user-facing brand surfaces, public card, billing, push, signed PWA, real mobile and release acceptance).
- This staged PR is not merge permission and is not evidence of mobile Safari/Android behavior.
- No original accepted parent or main mutations.

## Exact-head CI trigger integrity
- Initial Draft #368 targeted stage1 feat/** branch; Security and UX only ran, Foundation and PostgreSQL/Garage did NOT trigger because repository workflow PR base allowlist is main/p0/p1/p2/integration.
- Base was retargeted to unchanged main with no code diff or merge, but pull_request edit did not trigger missing jobs. This new AUDIT-ONLY commit records the corrected cumulative integration provenance and generates a fresh synchronize event for the REAL complete CI workflows on one exact final SHA.
- Real PHP8.4/8.5, TS/Vitest, Security, UX and PostgreSQL18/Garage/Chromium: PENDING until exact new SHA run complete. No PASS claimed for these newly triggered checks yet.
