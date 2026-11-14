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

Product acceptance: **IN PROGRESS / PARTIAL**, #244 remains OPEN. Verified code/test HEAD: `e532116639f59c6195d8804f67e61a647f1b3582`. [Dedicated Actions run 43553629796](https://github.com/1troitsky/photobunker-v3/actions/runs/43553629796), PHP 8.4 and 8.5: runtime patch gate, Composer install, 4-file PHP lint, focused legal/support tests, and **full PHPUnit 251 tests / 3699 assertions each PASS**. **Overall dedicated workflow FAIL** on unsuppressed `composer audit --locked`: inherited `CVE-2026-128083 / GHSA-63hm-g96r-2m2q` in original main composer lock, tracked independently in [Issue #297](https://github.com/1troitsky/photobunker-v3/issues/297) / Draft PR #298. This #244 branch does not touch composer.lock; full secure P0 gate still **BLOCKED**. These are CI facts for the specified code HEAD, not a claim of passing full release acceptance. Final docs-only/CI workflow commit and PR exact-HEAD statuses are recorded in Issue #244 and PR #322 comments. Main and other agents' PRs unchanged. Composer audit may inherit security failure while #297 security fix is unmerged: do not suppress.
