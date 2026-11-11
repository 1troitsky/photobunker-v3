# P2 V-27 — signed membership removal fences offline Fieldwork capture cache

**Status:** Draft, code written, exact-head CI pending. Stacked on PR #121 @ `97f96d42794e7b50ff1da0a8fe693b106a09097e` (3/3 CI PASS); parent #120 provides independently owner-signed recipient removal notices. `main` unchanged. Matrix paused. No public grants or physical/cloud GC.

## Actual problem

#119 makes a removed contributor lose server-side Fieldwork read/upload authority. #120 shows the contributor an independently owner-signed removal and deletes the stale cached invitation. **But** recipient account-scoped IndexedDB retained the authenticated `capturePolicies` snapshot and encrypted `privateSummaries` entry for that assignment. In an offline next session, `listCachedAssignmentSnapshots()` could show a removed assignment again; `signedCaptureBinding()` could issue a locally signed capture binding against the outdated authorization snapshot (although the server would reject its later submission).

The previous "removed" proof only invalidated the invitation cache; it was incomplete as a local-first revocation barrier.

## Exact trust path

1. The recipient fetches the 50-row cursor-paged removal feed (from #120). The client verifies **both** original invitation and removal contract against the independently fingerprint-pinned original owner account P-256 key. A server-only `removed` flag, unknown peer, forged signature, bad scope or changed key **does not authorize any cache mutation**.
2. On a verified owner-signed exclusion, write a narrow, immutable recipient-account-scoped **revocation tombstone** `accountId/assignmentId` (Dexie schema v4); atomically remove only matching old `invites`, signed `capturePolicies` and disposable account-AKEK-encrypted `privateSummaries` for the same assignment. Preserve contributor originals, E2EE media, unfinished operations and all queued ciphertext/uploads, owner-authored projects and other accounts.
3. Tombstone outranks a stale server listing or cached local snapshot. `listServerAssignments` cannot rewrite the revoked capture-policy cache. `listAllServerAssignments`, `listCachedAssignmentSnapshots` and `listCachedAssignmentInvites` filter tombstoned assignments. `signedCaptureBinding` rejects a tombstoned assignment even if a stale signed policy record is reinserted by another task. `listAssignmentInvites` will not recache stale invitations after a verified removal.
4. Same online refresh filters any stale snapshot and pending invite by the verified removal proof before rendering; owner-created assignments remain unaffected. No new invitation, media grant, acceptance, server mutation, uploaded key or plaintext is created.
5. Offline-only devices **cannot learn new remote exclusions until a successful authenticated connection and verified owner signature**. The prior offline capture/recording may remain in the user's personal encrypted outbox; no automatic deletion or reliable remote wipe is claimed. The revoked recipient can still possess historical plaintext previously viewed; that is outside remote authorization guarantees.
6. No re-invitation after signed remove is supported by current v1 protocol; tombstone deliberately persists across reloads. Future authorized rejoin requires a new versioned owner-signed consent/recovery procedure, not a silent toggle.

## Evidence / acceptance

- New `assignment-verified-revocation-cache.test.ts` uses real Dexie/fake IndexedDB v4, genuine P-256 signed original invitation + removal proof, and mocks only the authenticated transport/key-directory. Tests atomic tombstone + invite/policy/private-summary cleanup with queued operation preserved; independently **unpinned** owner and **forged removal** do not purge anything.
- Extended existing real two-account Chromium contact→signed invitation→accepted assignment→signed owner removal→recipient verified notice journey to assert recipient had a cached signed policy **before** exclusion, then offline policy absence, accepted inbox absence, `signedCaptureBinding` refusal, tombstone presence, summary eviction and existing unsent operation isolation after exclusion.
- Requires exact-head security CI, PHP 8.4/8.5, TypeScript/Vitest/build, isolated PostgreSQL18/Garage+Chromium; physical Safari/iOS/Android and independent owner acceptance **NOT TESTED**.
- A tombstone contains no plaintext private title, GPS, media DEK or media content. It is an authorization denial record, not a substitute for full anti-forensic remote wipe.

**No main merge, deploy, production migration/reset or physical media deletion performed.**
