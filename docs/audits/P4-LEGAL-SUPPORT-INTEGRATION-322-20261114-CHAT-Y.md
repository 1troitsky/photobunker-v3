# P4 post-#336 Legal/Support integration — Issue #371 · CHAT-Y

Date: 2026-11-14 · Status: **INERT SAFETY PREFLIGHT ONLY** · Original full feature #244 remains OPEN.

## Immutable base and provenance
- Accepted main verified unchanged at `8ed66c438d090efd218efa80b027f0b2f854db4b`, after owner-approved #336 merge and the earlier Laravel security patch.
- Source original [Draft PR #322](https://github.com/1troitsky/photobunker-v3/pull/322) by CHAT-K, exact `c91408709d353059fc3aeafb9d640c8e93fbea96` on **old** `main@6565a0fe...` is READ-ONLY. No cherry-picking its parent, old Laravel lock, global progress or source branch changes.
- All six original source files confirmed absent on the accepted main before CLAIM; Git tree blob IDs / mode 100644 checked and imported verbatim. New additional report (this document) does not overwrite any historical report.
- Exclusive integration [Issue #371](https://github.com/1troitsky/photobunker-v3/issues/371), [CLAIM #6875739090](https://github.com/1troitsky/photobunker-v3/issues/371#issuecomment-6875739090), central [journal #302](https://github.com/1troitsky/photobunker-v3/issues/302). Rechecked journal/claim/main before writing.

## Exact 6 original paths
```text
.github/workflows/p4-legal-support-244.yml
apps/api/app/Support/LegalReleaseGate.php
apps/api/app/Support/SupportDestinationPolicy.php
apps/api/tests/Feature/Support/LegalReleaseGateTest.php
apps/api/tests/Feature/Support/SupportDestinationPolicyTest.php
docs/audits/P4-LEGAL-SUPPORT-244-20261114.md
```
Extra new own path: `docs/audits/P4-LEGAL-SUPPORT-INTEGRATION-322-20261114-CHAT-Y.md`.

## What this does (and does not) establish
- `LegalReleaseGate` parses operator-provided revision, approval reference, UTC effective date, processing-region code list, all four RU/EN Terms/Privacy texts, SHA-256 pins, length/UTF-8 validity and obvious placeholder rejection. It **does not** verify that an approval reference is authentic, texts are legally sufficient, jurisdictions are actual, or a person consented.
- `SupportDestinationPolicy` checks **syntax** of an HTTPS-only support destination, rejects unsafe URL userinfo/query/fragment, literal IP/local origins, suspicious paths. It does not contact, authenticate, pin DNS/TLS, or verify the recipient or any complaint delivery. Never send E2EE keys, raw media or private recovery materials.
- Both classes are **inert, unmounted**, not a production release gate or support contact form. No actual legal texts, external provider, terms publication, backend route/Help UI, credentials or user data are introduced.
- P4 Legal/Support acceptance still requires owner-approved Terms/Privacy, verified hosting/processing geography, reachable support endpoint and complaint delivery workflow, mobile RU/EN accessibility and legal review, each with independent evidence.

## Source and new exact-head validation
- Source HEAD `c91408709d353059fc3aeafb9d640c8e93fbea96`: negative PHP tests and full PHPUnit passed in source execution; overall workflow **FAIL** from **old Laravel CVE-2026-128083** on inherited Composer lock. Do not describe old source CI as green.
- Current main has patched Laravel. This integration needs fresh exact-head: dedicated PHP8.4/8.5 Legal/Support tests + full PHPUnit + **unsuppressed** Composer audit, Foundation frontend, Security, UX, PostgreSQL18/Garage and real Chromium. Mark pending/failed tests accurately in Issue and Draft PR, never assume old source pass proves integration.
- No main merge or deploy authorized. Any later release activation needs separately reviewed integration with real legal/operational decisions.
