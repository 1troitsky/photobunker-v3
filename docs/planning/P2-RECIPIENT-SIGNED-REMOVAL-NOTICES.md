# P2 V-25 — Recipient-visible independently authenticated removal notices

**Status:** Draft/code written; exact-head CI pending. Parent #119 at `ca00b66fdfc6ee8050695eace90f76f9582edfd5` (3/3 workflow PASS). No main merge, Matrix work, Public Card/anonymous grant, cloud GC, new E2EE keys or remote wipe.

## Why

V-24 introduced an owner-signed, immutable removal of an accepted contributor. Removed contributors were correctly denied server Fieldwork data and removed from the active inbox, but saw their assignment silently disappear. The original signed removal evidence was accessible only to the **owner** through the owner-only roster; the **recipient** lacked a way to independently prove the exclusion was authorized by the owner. The cached previously accepted invitation also survived an online removal observation and could misleadingly reappear as a stale offline invitation on the next load.

## Scope

1. New read-only authenticated recipient endpoint `GET /assignments/v1/invites/removals` with 50-row monotonic UUID `after` cursor and 51-row lookahead. Server filters by exact authenticated recipient in **both** invitation and immutable removal tables; owner or outsider receives zero notices unless they themselves were the excluded recipient. No plaintext private assignment, media, DEK, GPS or other participant graph is returned.
2. Each item includes original immutable **owner-signed invitation** contract/signature, immutable **owner-signed removal** contract/signature, exact identity/assignment/invite IDs and owner's account SPKI for key comparison. The owner SPKI from server is **never** independently trusted.
3. On recipient device, exact canonical v1 invitation and removal scopes, all IDs, role, owner, recipient, operation UUID and both P-256 signatures must verify against `pinnedPeer(ownerAccountId)`: an independently fingerprint-confirmed owner key. Wrong/missing pin, swapped owner key, extra JSON fields, a forged signature or a mismatched contract is `unverified`. The client does not label unverified claims as genuine exclusion.
4. The UI displays a separate **«История участия»** block for verifiable owner-signed exclusions, with **«Сверить ключ владельца»** for unverified notifications. This opens the existing explicit independent fingerprint check; confirmation triggers a fresh proof fetch. It neither accepts a new invitation nor reinstates grants or Fieldwork access.
5. Only after verifying the owner signature, the client removes the exact, account-scoped old accepted invitation from the local Dexie invite cache. An unpinned/forged server notice does NOT delete cached consent. The server ACL already denies live access independent of this cache cleanup. No offline-revocation guarantee is claimed for a device that never reconnects.
6. The active invite inbox remains separate and unchanged, preventing hundreds of historical removals from starving live pending invites in its original 50-row cap. The removal feed itself is paginated and capped at 100 pages per request, with strict forward cursor, uniqueness and session checks.

## Tests / boundaries

- Laravel: authenticated recipient can retrieve exact owner-signed invitation and removal after active membership loss and after assignment finish; owner/outsider cannot enumerate another recipient's removals; malformed cursor returns 422.
- Vitest: genuine P-256 signatures for both original invitation and removal, strict scope, digest/owner SPKI binding, wrong signature/identity/extra keys, missing pinned owner, owner lookup dedup but independent per-record verification.
- Chromium: two real enrolled accounts, independent owner-key confirmation, contributor accepted, owner signed removal, server no longer lists assignment or invite; recipient sees **verified** removal, forged signature rejected, stale cached invite absent.
- **Caution:** independently verified proof reports *the owner's signed action*, NOT plaintext/media deletion, proof of camera/GPS authenticity or physical revocation of previously decrypted offline copies. It grants no rights.
- Exact-head release gate: PHP 8.4.27+/8.5.12+, Laravel + Vitest/TS/build, isolated PG18/Garage and real Chromium, Security CI. Native Safari/iOS/Android and independent product acceptance **NOT TESTED**.

All PR remain Draft; no merge/deploy without the owner's decision.
