# P1 #281 / parent #203 — bounded signed paid Photo/Media TTL, new uploads only

**2026-11-13. Draft scope. Exact-head CI not yet evaluated.**

## Provenance, dependencies, ownership

- Owner: scoped product slice [Issue #281](https://github.com/1troitsky/photobunker-v3/issues/281), based on [QA PR #280](https://github.com/1troitsky/photobunker-v3/pull/280) exact commit `1c27a130dfb15fbb65f07c0d58dfe264d684022d`, 4/4 CI PASS, PG18/Garage and 5/5 real two-process quota races.
- Upstream signed entitlement #267/#275/#276; GC/tombstones #273; Photo and Media signed reserve protocols. `main` SHA `da7327b8c9c440dae3dc864b3245b9f9f4ad14eb` never modified.
- Scope limited to five production files (new `RetentionAdmission`, PhotoSync, Photo/Reservation, MediaContract, MediaV1Controller) and a new focused real-signature HTTP feature test. Existing CI, GC, E2EE encryption, manifest schemas, assignment ACL and billing snapshot/verification code untouched.

## How it works

For new signed uploads the *authenticated* reservation endpoint validates all original P-256 signed fields, including immutable `expiresAt` and Photo nested manifest `expiresAt`. Both protocol verifiers retain **Free 14-day** validation by default for legacy/internal callers. Only authenticated reserve calls request structural prevalidation within a hard limit **90 days**. Inside the existing account-row-serialized SQL transaction, **after matching an existing signed lost-ACK replay** and before any parent/object/chunk placement insert, `RetentionAdmission::assertNew` reads the *verified* append-only entitlement through `EntitlementLedger::current` and applies:

| Effective verified plan | Max new signed deadline relative to authoritative server clock |
|---|---|
| Free, expired/grace/pending paid snapshot | 14 days or stricter operator Free guard |
| Active verified Go | 30 days |
| Active verified Pro | 90 days |
| Active verified Unlimited or Unlimited+ | **14-day conservative fallback** until signed renewal/grace model is approved under #203 |

Client cannot select a plan, override a ceiling, extend old signed expiry, claim unverified payment, fake a storage receipt or change previously signed encrypted Photo metadata. New reservations exceeding effective plan cap fail HTTP 422 before SQL or S3 work. For an existing *matching* unexpired signed reservation, idempotent replay follows the original path and **does not re-enforce a newly downgraded plan cap**, preventing loss of a legitimate E2EE ciphertext pending upload after payment expiry.

The service checks all paid plan fields and modes fail-closed for unexpected/malformed entitlements. For Unlimited it requires exact versioned mode `while_plan_active_with_assignment_policy` but keeps old 14d physical bound: the product's unlimited-duration behavior must not be accidentally inferred from the absence of a numeric day count.

## Acceptance matrix and limitations

- Genuine device-signed Photo and Media HTTP reserves: Free 14 / Go 30 / Pro 90 valid; 1 millisecond overshoot denied; expiration stored unchanged; no new count on 422.
- Active Unlimited and Unlimited+ explicitly **do not** currently promise >14 days. Signed <=14-day requests allowed, >14-day denied until #203 contract.
- Signed tamper fails before admission; Photo manifests must bind identical immutable expiry. Other-account use denied and leaves DB untouched.
- Existing pending Photo/Media lost-ACK replay survives Go→Free grace, no hidden expiry rewrite, downgrade does not immediately delete data. New writes after grace are Free-bounded.
- Default standalone Photo/Media validators remain Free-bounded despite active verified Go; only trusted route can request 90-day structural parse.

**NOT IN SCOPE, NOT TESTED / BLOCKED:** physical iOS/Android cross-device TTL UX; short TTL minimum (1h/3h/12h) and policy; Unlimited active renewal and subsequent signed expiry extension; automatic physical GC operator acceptance; assignment-owner attempted deletion of contributor media; archive/public-card expiry/revocation and signed deadline migrations; paid checkout settlement proof. Full parent Issue #203 remains `backlog`; this bounded child is not a release gate waiver.

## Required CI evidence

New isolated PHPUnit feature test added; preexisting PHP 8.4 / PHP 8.5, 423+ Vitest, TS/build, Security, UX, PG18/Garage outages and Chromium E2E must all remain enabled. Check exact HEAD for 4/4 workflows; record initial failures honestly, no CI weakening. Open separate Draft PR; no merge.

