# P1 #402 — Durable logout intent fence (CHAT-AG)

**Date:** 2026-11-14 Asia/Tbilisi. **Status:** Draft; no main changes, no merge/deployment. **Review only after exact-head CI**.

## User-visible fault and original red evidence

- [Issue #402](https://github.com/1troitsky/photobunker-v3/issues/402): real Chromium on [PR #399](https://github.com/1troitsky/photobunker-v3/pull/399) frozen HEAD `bb391828f34ad4bcf4bc7fd9dfe7b17aa8f7e1be`, [workflow #43618856475](https://github.com/1troitsky/photobunker-v3/actions/runs/43618856475): **98/99 PASS**, original Data & Storage after-logout hard-navigation test **FAIL**. Original trace artifact `14123282986` preserved by reporting owner.
- Reproduced independently on [PR #401](https://github.com/1troitsky/photobunker-v3/pull/401) HEAD `53ea2283d608823901380c82fedcbdb54e7ffe9d`, genuine [PG18/Garage/Chromium #43619613573](https://github.com/1troitsky/photobunker-v3/actions/runs/43619613573) **97/99 PASS**, with two old failures: `p2-settings-data-storage-chat-ad.spec.ts:117` after logout/hard nav and `p2-browser-video-clip-ui-215.spec.ts:27` session bootstrap. Neither original foreign test was weakened.
- Source ordering: old `logout()` assigns `activeSession.value=null` **before awaiting** IndexedDB `markSignedOut(true)`. The signed-out UI may be visible while IDB transaction is not yet durable. A hard reload then cancels the transaction and auto-resume can restore keys. This is a **local session persistence** risk, not independent evidence of a server authorization bypass.

## New fail-closed protection

New `apps/web/src/features/identity/application/logout-fence.ts` stores a **constant '1' only** under a fixed key in same-origin `localStorage`, synchronously before making the signed-out UI visible. It contains **no Recovery Key, device/account ID, bearer, ciphertext, plaintext media or metadata**. The fence intentionally **survives** successful logout rather than being removed after the IDB write: it prevents another already-open tab from reusing an in-memory session after a fast cross-tab clear. It remains until **explicit signed Key-Only registration or Recovery Key recovery** finishes and `markSignedOut(false)` is durably committed. Automatic device resumption has **no path to clear it**. Missing/blocked/corrupted localStorage fails closed on auto-resume; a failed initial fence write refuses to show successful logout. IndexedDB device signed-out marker remains an independent durable guard.
 
In `session.ts`: `requireSession` and `activate` verify fence; session bootstrap checks fence before/after asynchronous key unseal and server reproof; logout first establishes synchronous fence, then drops volatile active session and resets CSRF, then awaits IDB mark, then best-effort server logout. On DB error leave the fence set and surface the error. Other same-origin tabs listen to storage fence and drop current volatile Session and CSRF (not a claim of server-side revocation or device wipe). Signed E2EE grants and existing server sessions still require independent server revocation policy.

## Exact owned paths

- Existing `apps/web/src/features/identity/application/session.ts` — narrow logout/reproof lifecycle.
- NEW `apps/web/src/features/identity/application/logout-fence.ts`.
- NEW `apps/web/src/features/identity/application/logout-fence.test.ts`.
- NEW `tests/e2e/p1-identity-logout-durability-402.spec.ts`.
- THIS audit.
- No AccountView, DataStorage, other-agent Playwright, backend, router, storage.ts, PIN, Camera or shared CI modifications.

**Integration dependency:** Historical unmerged PIN [#308](https://github.com/1troitsky/photobunker-v3/pull/308) also changes `session.ts`. Later integration MUST deliberately reconcile PIN Web Locks/relock + this logout fence and re-run all auth negative E2E. This branch is based ONLY on accepted unchanged main `8ed66c438d090efd218efa80b027f0b2f854db4b`; do not auto-merge #308 or this PR.

## Acceptance and deliberately unproven claims

- Unit: only a non-secret constant bit, idempotence, corrupted/missing storage fail-closed, explicit admission clears, other-tab fence event.
- New genuine Chromium: real signed Key-Only registration, simulate **actual browser IndexedDB API failure only on logout**, assert marker survives hard reload and `resumeExistingDevice()` cannot unlock even though original IDB marker never committed. Independently genuine two-tab signed session, abort network logout (transport fault only), verify both tabs remain locked after reload and IDB receipt.
- No blanket retries, `waitForTimeout`, disabled security checks, fake network ACK or testing-only product bypass.
- **Open limitations:** localStorage is not hardware-backed/tamper-resistant and cannot protect against deliberate origin data erasure, XSS, old uncooperative tabs, compromised browser or remote already-issued grants. Browser crash during physical disk flush of synchronous Web Storage is not proven; Safari/Android and multi-profile isolation **NOT TESTED**. Native product PIN Web Locks integration and compromised-client revocation separate.
- **CI exact-head:** record real PostgreSQL18/Garage/Chromium, Security, UX, PHP8.4/8.5, frontend and negative tests after workflows finish. No full security acceptance before CI.
