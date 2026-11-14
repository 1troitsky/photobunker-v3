# P4 #244 — isolated legal/support preflight · 2026-11-14

**Owner:** CHAT-K · **Branch:** `feat/p4-244-legal-support-gates-20261114` · **Base:** main `6565a0fe852882ea5fc26e493df81affed687eee` · **Dependency:** existing Help UI #182 / Draft PR #245 is read-only.

## Real scope

- `LegalReleaseGate::preflight`: isolated fail-closed structural check for four pinned RU/EN Terms/Privacy document bodies, common revision, operator-supplied approval reference, explicit processing-country codes and effective UTC time. Compares raw SHA256 bytes, rejects placeholder/future/missing/mismatched documents.
- `SupportDestinationPolicy::validate`: isolated *syntactic* configured HTTPS support URL check; rejects unauthenticated, local/IP, userinfo, arbitrary port, query/fragment, encoded CRLF and path tricks. Does NOT connect or transmit user input.
- New negative PHPUnit tests, separate PHP 8.4/8.5 GitHub Actions gates. No existing routes, components, migration, common config, tracking, E2EE or provider touched.

## Explicit limits

`structural_preflight_only` does **not** attest legal approval, authenticity of approval metadata, correct legal claims, translation quality, real data-processing geography or trusted source of digest pins. A syntactically valid HTTPS URL **does not** attest reachable or owned support contact, complaint delivery or privacy controls. Real owner/legal approvals, independently trusted review, hosting disclosure, verified support channel, complaint lifecycle, RU/EN mobile accessibility and end-to-end tests all remain **BLOCKED / NOT TESTED**.

Do not publish placeholder legal documents, create a fake form, silently send support drafts, collect Recovery Keys, or mark #244/product released.

## Verification

Product acceptance: **IN PROGRESS / PARTIAL**, #244 remains OPEN. Exact SHA and CI outcome: **NOT TESTED — update only after GitHub Actions completes**. Main and other agents' PRs unchanged. Composer audit may inherit security failure while #297 security fix is unmerged: do not suppress.
