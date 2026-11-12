# P1 #277 — Assignment monthly quota frontend contract reacceptance

**Date:** 2026-11-13. **Status:** Product Draft; exact-head CI pending.
**Base:** verified backend [#276](https://github.com/1troitsky/photobunker-v3/pull/276) at `f705c7e12446430363172071ea2252922722a12d`, with all four GitHub workflows successful on 2026-11-12. Inherited #272→#276 tree is an ordered stack, NOT five independently mergeable patches. `main` stays at `da7327b8c9c440dae3dc864b3245b9f9f4ad14eb`.

## Product/contract defect confirmed on exact base

- `MonthlyCreationQuota` after #276 reads verified plan limits from the authoritative server `EntitlementLedger`: Free 3, Go 30, Pro 100, Unlimited/Unlimited+ `limit=null, remaining=null`.
- The pre-existing `assignment-outbox.ts::listServerAssignmentUsage` cast the JSON directly into `planId:'free'`, rejected every paid response, and required numeric `limit/remaining`. The UI discarded real paid usage, displaying a misleading fallback.
- `AssignmentsView.vue` hard-coded `Тариф Free` and treated Unlimited's `remaining=null` as “месячная квота исчерпана”; its create form also claimed the server always enforces Free.

## Deliberately narrow correction

1. Pure `monthly-usage.ts` validates exactly the five known plan IDs, non-empty catalog version, precise UTC calendar-month start/end, safe non-negative integer counts, and `remaining===max(0,limit-used)` for bounded plans.
2. For unlimited plans only `limit===null && remaining===null` is allowed; no accidental `null` coercion to zero and no false exhaustion. A paid→Free downgrade may have `used>limit`, correctly yielding zero remaining without refunding usage. Invalid input fails closed with `assignment.usage_invalid`.
3. `assignment-outbox.ts` preserves `assertSame(session)` after asynchronous authenticated request; it no longer pretends backend responses must always be Free. No offline draft is discarded on quota errors; signed create server admission is unchanged.
4. `AssignmentsView.vue` renders verified plan labels, true bounded remaining, and a distinct product-unlimited status which explicitly keeps independent technical limits. The create form correctly states quota is checked on synchronization.

## Test matrix

New pure Vitest tests `monthly-usage.test.ts`: each of five plans; paid→Free downgrade with used > limit; exhausted bounded plan; Unlimited and Unlimited+ `null` pair; forged unknown plan and capitalisation; malformed/missing/negative/fractional/overflow values; remaining mismatch; invalid UTF/calendar period, non-UTC boundary and leap-February month. Existing signed outbox, crypto, E2EE, UI and security tests are preserved.

**Acceptance required on final immutable head:** Laravel PHP8.4/8.5 PHPUnit; TS/typecheck, Vue build and all Vitest; security and UX lane; PG18/Garage real S3 outage/recovery and all Chromium including the 65 MiB E2EE lost-ACK test. Do not claim any result before exact-head CI has finished. No new physical mobile/browser evidence is provided by this change.

## Remaining independent acceptance outside this issue

- Issue #192 must still test the last paid/Free quota slot with two *truly independent* PostgreSQL transactions / recovered devices, as well as final paid retention and integrated tariff activation. This is a read-only client display fix, not payment settlement.
- Issue #254 cryptographically authenticated Browser cursor remains backlog, not addressed here.
- Physical iOS Safari/Android PWA and Matrix A→B remain separate release blockers.
- No merge, rebase, deploy, or change to `main`, source PR #276 or other agent branches.
