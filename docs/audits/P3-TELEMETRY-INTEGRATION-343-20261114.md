# PB3 · Issue #343 — P3 telemetry internal integration, 2026-11-14

## Scope and provenance

- **Accepted base:** `main@8ed66c438d090efd218efa80b027f0b2f854db4b` (post-owner-authorized #336 merge, Foundation/Security/real PG18-Garage-Chromium push CI 3/3 PASS).
- **Source:** read-only Draft PR [#317](https://github.com/1troitsky/photobunker-v3/pull/317) exact `f29d5b2aab7ae11a0510e293b330cf5d2ac0055c` (original owner CHAT-I / Issue #229); source inherited security/297 parent changes intentionally **excluded**.
- **New branch:** `integration/p3-343-telemetry-db-chat-r-20261114`; isolated integration Claim [#343](https://github.com/1troitsky/photobunker-v3/issues/343) CHAT-R and shared log [#302](https://github.com/1troitsky/photobunker-v3/issues/302). Original Draft #317/claim remain untouched.
- **Transfer:** exact 24 Git blob SHA objects for the 24 source-specific PR #317 paths, including 9 `app/Telemetry` PHP classes, 9 feature tests, two operator-only CLI scripts, one PG18 migration, one standalone PG18 integration fixture, dedicated CI workflow, and preserved historical source audit. Main `composer.lock`, shared `TS_PROGRESS_TABLE.md`, and security audit changes **not copied**.

## Safety boundary

Internal, opt-in HMAC receipt/counter sink and reads only. No production collector mounting, no external analytics endpoint, no dashboard, no key cutover, no automatic replay scheduler, no user data/secret access, no live pruning or destructive actions. Operator-only replay explicitly defaults off. HMAC pseudonymization alone is not privacy approval.

## Acceptance evidence / prerequisites

- Source [#317](https://github.com/1troitsky/photobunker-v3/pull/317) documents real PostgreSQL18 two-independent-PHP-process receipt, race, replay, timezone, HMAC rotation/old-key shadow and negative identity checks on its historical HEAD. This is source evidence **only**, NOT proof on new integrated HEAD.
- **Integrated exact-head GitHub CI:** PENDING at initial commit. Required PHP 8.4/8.5 full PHPUnit + Composer security audit, dedicated PG18 race workflow, Security, UX, and relevant frontend gates.
- **BLOCKED:** unfenced mixed-key writers/true safe HMAC rotation, future cutover, old-key retirement, consent/sampling/retention approval, complete source coverage, privacy impact review, Admin MFA/RBAC and customer dashboard. Cross-account privacy and adversarial correlation review not certified. Physical mobile/browser release acceptance NOT TESTED.
- Never merge to main/deploy without a separate explicit owner approval.

## Transfer integrity

Source vs main comparison: every one of the 24 transferred paths was **ADDED**, zero path collisions on accepted main. The source has other inherited files in the old stack that are intentionally absent from this integration. Review exact new branch compare before making any merge decision.
