# PB3 Help/FAQ — user-facing Shell integration

**Date:** 2026-11-14 · **Agent:** CHAT-AE · **Coordinated via:** Issue #182 / #302, exclusive own integration branch and narrow routes. **At creation:** exact new-HEAD CI pending.

## Verified source provenance and scope correction

- Main accepted and untouched: `8ed66c438d090efd218efa80b027f0b2f854db4b`.
- Prior parent is frozen, fully CI-verified [Draft #397](https://github.com/1troitsky/photobunker-v3/pull/397) exact `e9c63252bab5c4ad608586c61846d66783ea271f` (7/7 CI, 97/97 genuine Chromium). A separate parallel CHAT-AD currently updates the original #397 branch for an enhanced Storage queue (Issue #165 #6880397854), but **this integration creates a different branch and NEVER touches that original branch or its claimed files**.
- Original standalone [Help Draft #245](https://github.com/1troitsky/photobunker-v3/pull/245) exact `84cddbc8d16ef56a752bc22f0efa18ffcad029b7` is previously 3/3 CI tested. **IMPORTANT: direct comparison of all FIVE `apps/web/src/features/help/**` blobs against accepted main proved all 5 exact Git SHA already present in current main, hence NO re-import/cherry-pick and NO second history parent is required.** Source already integrated into the accepted tree, only missing Shell activation. Original Help content/tests untouched.
- Owner-accepted UI [`docs/ux/help-legal/README.md`](../../ux/help-legal/README.md): accepted layout, **DRAFT About/FAQ text, NOT PUBLISHED legal terms**, manual copy-only support. `ts.md` §19.2 confirms no real support channel/approved legal text.
- This stage adds ONLY six paths relative to frozen #397: NEW `apps/web/src/views/HelpView.vue` with real accessible RU/EN toggle and Settings Back on Help root; NEW `tests/e2e/p2-settings-help-chat-ae.spec.ts` with two true browser journeys; this unique audit; NARROW changes to existing `apps/web/src/router.ts`, `apps/web/src/ui/fieldwork/settings-navigation.ts` and its existing Vitest file. No backend, Identity, source Help component, storage queue, original E2E or shared workflows modified.
- Real Help route `/settings/help` works within existing Fieldwork Shell. The preexisting HelpCenter handles nested home→FAQ/Support/Terms/Privacy navigation, search, keyboard Escape; root Back goes to /settings. UI opens without an account; authenticated account Settings row links to it. RU/EN switch resets FAQ to safe canonical state. Content is available during *warm SPA offline*, not an assertion about Signed-PWA cold start.

## New exact-head mandatory acceptance

1. Original Help 7 unit/UI tests, Settings navigation tests and all frontend tests; PHP8.4/8.5, Composer Audit, TS/build, Security, UX, P3 Billing/Grace/Backup.
2. Actual PG18/Garage/Chromium full suite, with BOTH new `p2-settings-help-chat-ae.spec.ts` cases included (not a Playwright-excluded filename): signed-out RU FAQ search and explicit legal DRAFT, English switch, Back; authenticated Key-Only Session Settings→Help, warm-offline FAQ, rejected secret support draft and truthful unsent copy-only message, proper back to Settings.
3. Preserve original first-attempt FAIL and exact SHA; no skipped tests/waived security controls.

## Explicit BLOCKED / NOT ACCEPTED

- Terms/Privacy are placeholder drafts, NOT legally approved or published. Their visible clear DRAFT warning is **not legal release authorization**; #244/Legal gate remains blocked by actual owner/legal approval and processing region.
- No support destination/transmission; manual draft is never sent. Security screening is heuristic, not proof that arbitrary secrets are impossible.
- No physical iOS Safari/Android acceptance, no cold-offline verified Signed PWA/SW, no claim of finished Matrix/Backup/DePay or all 25 release journeys.
- No merge, deployment, production distribution or main mutation without explicit owner approval. This is a pre-main **reviewable Help/FAQ route** only when full exact-head CI completes.

## New own E2E navigation contract checked before final acceptance

Static read of unchanged source `HelpCenter.vue` confirmed Back operates on its own stack before emitting the Shell exit event; after opening Privacy from Help home, the FIRST Back returns to Help home and SECOND Back returns to `/settings`. Original new E2E had assumed one Back from nested Privacy; adjusted ONLY new own test to verify BOTH steps, not weakened/hid any app behavior. First original CI run on `1e124a9c...` was in progress at discovery, so final acceptance must use new exact HEAD after this correction. Original CI run remains available as evidence (any final result reported, not misrepresented as app defect).
