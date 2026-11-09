# P1-04 — warm offline assignment listing (incremental Draft)

Status: **CODED / CI AND OWNER ACCEPTANCE PENDING**. Stacked on PR #15. QA agent's independent PR #13/#Round2 is not modified.

## Goal

An accepted participant should not lose sight of already-known encrypted assignments merely by navigating from Camera back to Assignments while offline. A previously loaded owner also needs to find signed assignments after warm SPA navigation. This is **not cold offline document boot**, which still depends on separately approved, signed and verified PWA assets.

## Trust and storage

1. An online-authorized `/assignments/v1` listing is verified against the owner's root signature and a separately pinned owner identity. The latest signed lifecycle state is checked for rollback and equivocation before an account-scoped snapshot is cached.
2. Offline, only these **previously verified** account-scoped snapshots can be listed. They are explicitly marked **historical**; no current ACL or freshness claim is made, and cached `confirmedPhotoCount` is not shown.
3. Owner title/instructions can be decrypted from the already available owner assignment envelope with the local account package.
4. For recipients, the verified accepted invitation and owner signature are required. During a prior authenticated online session, successfully decrypted title/instructions are resealed as fresh **AES-256-GCM ciphertext under the recipient's account AKEK** with AAD binding account ID, assignment ID and SHA-256 of the exact signed policy contract.
5. The encrypted summary is held in IndexedDB `pb3-assignment-operation-outbox-v1/privateSummaries` (schema version 3). No plaintext title/instructions, raw assignment DEK, recovery key or imported ECDH private key is persisted. Missing or corrupt summaries are displayed only as opaque assignment IDs.
6. Changing accounts never uses a different account's summary; a changed signed policy invalidates the cached title. The existing session/account switch protection continues to clear visible sensitive state.
7. The offline invite list is loaded directly from IndexedDB when the browser is offline, even if the last local session previously had `online=true`; it does **not** issue an HTTP request in this case.
8. If the browser reports `navigator.onLine=true` but the assignment API fails (e.g. 503), the screen switches to the same signed/encrypted cached data, displays a verification error, and marks all cached receipts and grants **stale**. No failed server response is promoted to live ACL.
9. Historical signature verification under degraded connectivity explicitly uses the **already locally pinned** owner key rather than trying to refresh a live key-directory record. Fresh online operations continue using the default directory check. This enables a full assignments + key-directory 503 without upgrading cached state to authority.

## UX and authorization

- A warm offline list shows the last verified signed assignment state and decrypted metadata if locally available.
- A banner identifies the snapshot as historical, not fresh server ACL; confirmed server counts are unknown until online refresh. Queued personal ciphertext remains locally available and is counted separately from confirmed receipts.
- Camera can still capture using previously verified signed policy; every subsequent cloud reservation and assignment submission must pass real server authorization. Revoked or finished membership can reject late operations without wiping encrypted local media.
- No claims about native Safari, hardware background camera, indexedDB eviction, cold PWA start or independent trusted update chain.

## Tests

- Vitest checks AES-GCM encrypted IndexedDB summary (not plaintext), matching policy requirement and account isolation.
- Chromium A→B→A E2E: after prior online pin/accept, B survives a synthetic `/assignments/v1` and invites API 503 via a visibly stale encrypted snapshot; then B captures offline, navigates to Assignments **without full document reload**, sees the previously accepted private title and local pending count, restores network and completes cloud synchronization.
- Existing P1 source E2E, PHP, TS, Vue build, and real PostgreSQL/Garage remain required CI gates.

Do not conflate this warm offline navigation with cold offline reload. The independently trusted Service Worker activation remains a separate product/security gate; never silently turn on an unsigned SW to satisfy this feature.
