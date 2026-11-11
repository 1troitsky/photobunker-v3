# P2 V-29 — offline history of previously verified, owner-signed Fieldwork removal

**Status:** Draft / exact-head CI pending. Stacked on #123 @ `9a43a2a848abcd5927b7fbef692c33fc264567bc` (parent V-28). `main` unchanged; no Matrix, Public Card, cloud/physical GC or re-invitation.

## Existing gap

Owner-signed removal closes P1/P2 server Fieldwork access. Recipient V-25 can independently authenticate the original signed invitation and the immutable signed removal online. V-27 then persists a narrow account/assignment-specific removal tombstone and clears old invite, capture policy and encrypted summary. V-28 prevents races. However, after a **fully offline page refresh**, the recipient's «История участия» UI was empty even though the durable tombstone continued correctly denying access. The recipient had no visible record explaining why the previously accepted assignment was missing.

## Read-only local-first vertical

1. Reuse existing `revocations` Dexie v4 tombstone; **no new network calls, DB migration, key hierarchy, plaintext or media storage**.
2. `verifyCachedAssignmentRemovalProof()` checks exact canonical version-1 `pb3.assignment-member-remove.v1\n` JSON, matching account/owner/assignment/invite and operation UUID, then validates the actual P-256 owner signature against **`pinnedPeer(ownerAccountId,false)`**. This uses only the locally fingerprint-confirmed owner public signing key; it never trusts a server-supplied replacement key or attempts network lookup in offline mode.
3. It does not require retaining the old invitation E2EE envelope. The tombstone was written **only after** the prior online code verified BOTH original invitation and removal signatures; the historical offline view rechecks the persisted removal signature itself. A forged, malformed or unpinned local tombstone displays as **unverified**. Existing read ACL and local deny tombstone are never lifted as a consequence.
4. `listCachedVerifiedAssignmentRemovals()` scopes records by currently authenticated account and returns verified/unverified local evidence. Account/session switches are checked before returning.
5. Recipient Vue Fieldwork screen shows the old removal history under «История участия» even without network. Wording explicitly distinguishes **previously saved, locally re-verified owner signature** from **fresh current server status**. When online results exist for the same invitation, the live verified/unverified row wins and the old local row is deduplicated. Failure to render local history never restores a revoked assignment.
6. No re-acceptance, grant issuance, backend status change, leaked private title/GPS, decrypted media, remote wipe of already cached plaintext or assertion that remote members can learn exclusion without ever reconnecting.

## Tests / evidence

- Vitest with real recipient and owner P-256 packages, real fake-indexeddb signed revocation V-27 fixture and independently pinned owner: online verification deposits tombstone; offline read re-verifies signature and emits no API call. Missing independently pinned key or tampered cached signature is **not verified**; tombstone remains a denial record.
- Existing real two-account Chromium owner-signed invitation→accepted Fieldwork→owner-signed exclusion→recipient independently verified notification→offline-cache invalidation then triggers **offline Fieldwork refresh** and asserts a verified local history row, no vanished assignment card, and no new network access.
- Release requires exact-head PHP8.4.27+/8.5.12+, strict TS/Vitest/build, isolated PG18/Garage+real Chromium and security CI. Native Safari/iOS/Android, physical-device offline PWA and independent owner acceptance **NOT TESTED**.

No main merge, deployment or destructive action performed.
