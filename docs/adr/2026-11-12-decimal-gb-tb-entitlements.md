# ADR — Owner-approved decimal storage units for PB3 entitlements

**Date:** 2026-11-12. **Decision:** accepted by product owner in conversation immediately after Draft #274. **Status:** forward-only, new catalogue version. **Scope:** storage quota byte ceilings; not payments, paid retention, Assignment admission, invoices, backup reference accounting, or existing data deletion.

## Decision

Use **decimal units** in every approved tariff:

| Plan | Count ceiling | Advertised storage | Enforced encrypted ciphertext bytes |
| --- | ---: | ---: | ---: |
| Free | 50 | 1 GB | 1,000,000,000 |
| Go | 250 | 30 GB | 30,000,000,000 |
| Pro | 2,000 | 200 GB | 200,000,000,000 |
| Unlimited | unlimited *file count* | 500 GB | 500,000,000,000 |
| Unlimited+ | unlimited *file count* | 1 TB | 1,000,000,000,000 |

**1 GB = 1,000,000,000 B; 1 TB = 1,000,000,000,000 B**. GiB/TiB are **not** the billing units. No decimal/binary conversions in the client; the server exposes immutable integer `byteCeiling` in definitions and effective /billing/v1/me. Count unlimited never means byte storage unlimited.

## Immutable migration

- New catalog: `pb3-2026-11-12`, `DECIMAL_GB_TB_V1`, effective `2026-11-12T00:00:00Z`. Existing price and feature values remain unchanged.
- **Do not edit** existing `billing_entitlement_snapshots_v1`, head hashes, previousHash or user data. Old `pb3-2026-11-09` `OPEN_GB_VS_GIB` definitions remain verifiable using the policy committed in their original immutable JSON. A legacy *active paid* snapshot still has no authorized paid byte ceiling: it retains the prior **1,000,000,000 B engineering safety ceiling** until an independently verified new trusted entitlement revision. Never upgrade old paid status merely by deploying new config.
- New authenticated Free bootstrap and independently verified trusted transitions use approved decimal snapshots. Existing Free can remain on conservative legacy safety until a reviewed versioned transition. Existing media are **not** re-encrypted, deleted, rescheduled, or grandfathered automatically.
- Signed Photo and MediaFile/v1 share one transactional account-row lock and recorded pending+active encrypted byte reservation. The new signed reservation's bytes are checked against the effective committed ceiling with overflow-safe arithmetic. Legacy Free's `photo_sync.bootstrap_free_byte_cap` can still be an additional stricter *technical* limit on Free. The old cap must NOT block verified new Go/Pro/Unlimited byte entitlements.
- Grace/expired/pending effective Free fallback is enforced on **new** uploads only; no retroactive deletion or silent entitlement extension. Booking, backup refs, retention/TTL, and Assignment monthly limits are separate requirements.

## Security and operations

- Client-submitted `planId`, storage quota and current usage never authorize a paid plan. New paid revisions only via `EntitlementLedger::advanceTrusted` after verified settlement or audited MFA action, never frontend/invoice callback alone.
- `BillingV1Controller::me` reports read-only actual server-measured usage + effective policy/byte ceiling, without creating a write route.
- If an old snapshot policy, stored bytes/hash chain, or a new decimal amount/ceiling disagrees with the versioned contract, fail closed rather than interpret `null` as unlimited storage.
- No production migrations that overwrite existing user snapshots, no secrets, keys or plaintext in quotas/logging. Rollout needs explicit owner acceptance of paid transition strategy and independently verified service behavior.

**Evidence:** Product Draft PR #274 safe file count/old technical guard (4/4 PASS); new decimal successor PR with exact-head independent CI is the implementation gate. Issue #192 stays open until full Assignment and retention acceptance.
