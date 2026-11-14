# P3 #342 · Post-merge integration — inert Admin audit, trial and temporary restriction contracts

**Date:** 2026-11-14 · **Owner:** CHAT-Q · **Status:** IN PROGRESS / first exact-head integrated CI pending.

## Provenance and scope

Baseline accepted main `8ed66c438d090efd218efa80b027f0b2f854db4b` with Git tree `7f2026e3818cae77712d23433475369606f901b0`. Own branch `integration/p3-342-admin-audit-trial-chat-q-20261114`; **no merge, deployment, remote admin action, production data, credentials or foreign branch edits authorized**.

Parent source [#318](https://github.com/1troitsky/photobunker-v3/pull/318) HEAD `60b3ca52a7cbe3e055cfa025abceeb71c00152e2` (six added files) is **an inert durable DB AdminAuditLedger** with serialized hash chain + exact replay/conflict and real PostgreSQL18 2-PHP-process race tests. A local SHA256 audit chain alone is **NOT independently tamper-proof against compromised DB**.

Stacked source [#324](https://github.com/1troitsky/photobunker-v3/pull/324) HEAD `61bf9dba29d85f8b356c7f2f71417ea082002766` (17 added files relative to parent) contains **internal-only** AdminTrialGrantExecutor / TemporaryRestrictionLedger / AuditedAccountRestrictionExecutor / TransactionBoundRestrictionAdmission. Real two-PHP PostgreSQL18 concurrency suites are included, with global audit → account lock order, CAS rollback, idempotency, stale MFA/actor denial. No browser endpoint, real operator session or externally verified role grant.

Exactly 23 inherited new paths, selected by comparing each source PR against its correct parent, never copying unreviewed ancestor source or obsolete shared composer.lock. Existing `AdminPolicy.php`, `AdminPrincipal.php` and `AdminAuditEntry.php` in accepted main match source Git blobs exactly and remain untouched. New own negative PHPUnit `AdminIntegration342Test.php` tests absence of HTTP Admin routes and stale/unverified MFA denial. New own unique QA report is this file.

## CI corrections in own branch only

Two source workflows `.github/workflows/p3-admin-audit-227.yml` and `.github/workflows/p3-admin-trial-grant-228.yml` **preserve** PHP8.4/8.5 full PHPUnit, Composer Audit strict, and true PostgreSQL18 independent OS-process race harnesses. Replace obsolete old-main patched-lock download-and-diff steps with SHA-1 Git blob verification of already-accepted current main `composer.lock` blob `c4bcae0458bd390b797186c3e2ccf536469588ef`. The historical child source's extra ephemeral old-main merge compatibility job (pinned `5aaba8b0`) is removed because this branch is *already* a clean parent from security-patched accepted `main`, not a stacked old-main test. No test logic, skip/ignore flag, assertions or security thresholds weakened; no CI source patching and no GitHub credentials or production credentials used.

Additional CI standard Foundation (real PHP8.4.27/8.5.12, frontend Vitest/TS/build), Security, real PG18/Garage/Chromium and UX guard must complete on **EXACT** own integration HEAD. Report true PASS/FAIL/PENDING by exact Actions run, not earlier source-PR proof.

## Safety gates that remain BLOCKED / NOT TESTED

No real trusted server-side AdminPrincipal issuance, no integrated step-up MFA / role grant storage / CSRF / session age limit, no independent external signed audit anchor or global DB attacker protection, no actual operator UI or authenticated Admin route, no real account/device/IP/customer restrictions or paid entitlement issue from network. Internal ledger methods are **not** callable by untrusted HTTP clients. Never confuse a synthetic AdminPrincipal fixture with real MFA/auth. Device/IP unblock/ban/revoke contracts and cross-admin permission elevation need further product+security work. No E2EE media/GPS/messages/Recovery Key exposure. Real mobile and independent security/hardware review not tested.

Source issues #227 and #228 remain PARTIAL, integrated #342 is a bounded internal dependency review only. Owner approval required before ANY future main merge, external admin auth activation or deployment.
