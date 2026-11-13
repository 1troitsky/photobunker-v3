# P1 #283 — Local-First PWA paid signed retention hint for new Photo/Media

**Date:** 2026-11-13. **Current status:** DRAFT, exact-head CI PENDING.

## Source and constraints

- New server authoritative admission in [Draft PR #282](https://github.com/1troitsky/photobunker-v3/pull/282), immutable base `33d31028dec4344fb613f5554132c4cdfac25234`, **4/4 exact-head PASS** (PHP8.4/8.5 244/244, 423/423 Vitest, 78/78 Chromium, real PG18/Garage and 5/5 real PG quota races).
- Parent [#203](https://github.com/1troitsky/photobunker-v3/issues/203) remains `backlog`; [child #283](https://github.com/1troitsky/photobunker-v3/issues/283) has explicit scoped frontend CLAIM. Existing API entitlement, Photo/Media signed validation, billing ledger, crypto primitives, Camera and Browser UX, GC and existing tests are untouched.
- Only scoped changed files: new `apps/web/src/features/media/application/retention-hint.ts` and new `retention-hint.test.ts`, `apps/web/src/features/photo-sync/application/p1-photo.ts`, `apps/web/src/features/media/application/media-outbox.ts`, `apps/web/src/main.ts`, and this report.

## Contract and actual behavior

The authenticated same-origin GET `/billing/v1/me` returns read-only immutable ledger state. A background task refreshes on successful login and on stale/cold capture attempts, **without blocking the UI, capture, encryption, or IndexedDB durability**. The entire hint remains in volatile memory, fenced by the exact authenticated session object, capped to 60 seconds, and checked against currently active session plus browser connectivity. Old or out-of-order responses from a switched/recovered account are ignored. No localStorage, signed client plan, user-controlled price, forged settlement, or raw file data reaches this endpoint.

Background refresh additionally holds a **session-scoped 60-second last-checked cooldown** even after a Free/Unlimited/malformed HTTP result or transport error. It prevents the Camera/Browser from issuing an expensive `BillingV1Controller::me` + `AccountUsage::measure` query for every frame in a burst. In-flight requests are deduplicated; next eligible refresh occurs after the bounded cooldown. There is no persistent offline paid grant and an explicit navigator.onLine=false always selects Free13 immediately. An unknown/missing navigator.onLine does **not** pretend offline: the GET is attempted, but every failure stays Free13. This was corrected after the first recorded 9-failure new Vitest run at HEAD `f5ddc38f0e42e27a3224c61d48f76e62109b80d3`; its CI failure was preserved rather than mutating old tests. The follow-up HEAD `ff0286dbb6ac9540b5534253842031d38e6d783e` passed 443/443 Vitest before adding the negative-cache optimization.

The response must be schema v1, verified active paid status, versioned revision and SHA256-shaped immutable snapshot, matching effective and raw paid plan IDs, strictly validated retention limit (Go30/Pro90) and unambiguous `endsAt` UTC later than now+5 minutes. All malformed, missing, tampered, mismatched or stale responses produce **13-day fallback**; expired/revoked/offline/no-network also falls back. Unlimited/+ deliberately stays 13 days because owner has not accepted perpetual contract renewal and grace semantics; a `null`/mode never implies unbounded signed TTL. All paid snapshots are **hints**, not locally granted authorization; the signed reservation server re-checks actual trusted entitlements and time under the same PG account lock.

| Source in memory | New signed Photo/Media expiry |
|---|---|
| Free, no authenticated response, offline, expired/grace/pending paid, wrong account/session, invalid or stale data | createdAt + **13 days** |
| Fresh verified active Go (server cap30) | createdAt + **29 days** |
| Fresh verified active Pro (server cap90) | createdAt + **89 days** |
| Unlimited/Unlimited+ | createdAt + **13 days** until #203 retention renewal is approved |

One-day buffer preserves former Free13 behavior and mitigates normal client/server clock drift. It is **not** certified authoritative time synchronization and cannot prevent all bad-clock 422. The existing API still validates max Free14/Go30/Pro90 and stores original signed `expiresAt` unchanged. Already queued ciphertext is NEVER re-encrypted or re-wrapped when the plan changes. If a stale paid hint leads to API HTTP 422 after a payment transition, existing local outbox retains ciphertext with explicit conflict rather than claiming success.

Photo: `newSignedExpiry(createdAt,session)` is called BEFORE `wrapAssetDEK`, both AES-GCM asset manifests and the signed Photo contract share the same immutable deadline. Media: expiry selected before `encryptMediaFile`, including AAD and wrapped keys; outbox stores the exact signed contract.

## Real Chromium failure triage and routing correction

The first full QA head `8924f6299dd93623a01917b7177f521ac35f7792` has **3/4 GitHub workflows PASS, 1 FAIL**: [PG18/Garage/Chromium 43335545993](https://github.com/1troitsky/photobunker-v3/actions/runs/43335545993) returned **77/78 Chromium**, specifically existing `tests/e2e/p2-browser-camera-gps-permission.spec.ts:120` ("signed required-GPS policy..."). No retries or old-test edits were used. The live 5/5 PG quota races and physical Garage restart/ACK recovery remain PASS; PHP8.4/8.5 244/244 and 446/446 frontend unit tests PASS.

**Primary confirmed integration defect (trace-driven):** downloaded real Playwright artifact `p1-browser-traces` #13996284621, nested `trace.zip`, inspected network and screenshot. Following registration, the browser issued GET `/billing/v1/me` **twice**, both **404 from Vite**: `apps/web/vite.config.ts` had no billing proxy, even though Laravel `apps/api/routes/web.php` already exposes `GET billing/v1/me`. This meant paid client hints never became available to real web users. Fixed only the real dev routing: new `'/billing/v1'` Vite proxy to Laravel, preserving exact same-origin cookie and no access-control bypass. Added **NEW** `tests/e2e/p1-billing-retention-proxy.spec.ts` asserting unauthenticated HTTP401 and authenticated Key-Only Free14 JSON200 **over actual proxy**, with immutable Free13 client fallback.

**Separate existing GPS E2E result:** in the saved failure trace POST `/assignments/v1` was 201, subsequent GET `/assignments/v1` 200 and the created assignment was visibly present in the rendered list, but `.assignment-detail code` was absent because its detail was no longer selected. The trace shows no API authorization denial for that assignment. This is a **selection/rehydration race candidate**, not proven to originate in the paid hint module. No old GPS/assignment tests or product AssignmentView were altered to hide the failure. A new exact-head full-run is required after routing correction; repeat occurrences must be tracked separately, not auto-marked green.

**Scope extension documented:** `apps/web/vite.config.ts` and NEW real-browser smoke, plus this audit, added to #283's exclusive ownership. Only development routing is proven; deployed ingress/reverse proxy still requires independent verification.

---
## Acceptance

New Vitest coverage must prove: verified Free/Go/Pro/Unlimited matrix; positive live encrypted Photo/Media creation and readback with Go29/Pro89; old upload session with delayed entitlement response cannot contaminate a recovered session, including same account; network failure and offline conservative fallback; malformed/forged paid flags, wrong limits/plan/status/revision, near/expired entitlement and ambiguous UTC rejected; no network-await on the cold Camera path; in-memory hints expire at 60s. Existing signed E2EE, Local-First, lost ACK/retry and backend tests unchanged.

**NOT YET ACCEPTED / OUT OF SCOPE:** a user-facing retention chooser; server clock-sync policy; cryptographic proof of independent paid payment settlement; real mobile Safari/Android; extended Unlimited renewal and lease/grace, deletion or re-signing of existing ciphertext, archive/assignment/public-link TTL. In particular there is no automatic 30/90 day real elapsed-time end-to-end acceptance from five-minute CI, and no policy for retroactive extension of 13d signed files.

## Exact-head QA gate

Require original **4/4 GitHub workflows** including PHP8.4/8.5, full Vitest+TS/build, PG18/Garage live outage/recovery and Chromium78/78, security, UX, full five PG concurrency cases, no skipped tests or changed production GC. Record exact final HEAD and URLs in Draft PR/Issue after success. Do not merge into `main` or retarget another agent's PR.
