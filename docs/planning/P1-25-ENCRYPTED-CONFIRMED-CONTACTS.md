# P1-25 — Encrypted, independently confirmed local contacts

**Status:** stacked Draft, not in main, not deployed or owner-accepted. Base: [P1-24 PR #42](https://github.com/1troitsky/photobunker-v3/pull/42) at verified exact HEAD `854eed102956cc728a45150a6fb5854a6928d180`. Normative sources: `ts.md` §15.1 and read-only PB2 UX prototype `docs/ux/contacts-teams/README.md` in PR #56 at `daca24a4a38c62473859b2b54b4999d50400c491`. Prototype fixtures and action simulations are **not** backend ACL or user account data.

## Scope and actual journey

One unified **«Контакты и Команды»** screen inside the existing Fieldwork shell/dock, with two tabs. The Contacts tab is functional: the owner types the **exact internal account UUID** (temporary technical lookup until server privacy-aware `@username` and immutable eight-digit `#UserID` exist), inspects the owner-signed exchange key directory, compares the full safety fingerprint independently, confirms the pin, assigns an optional local alias, and explicitly adds the contact. Confirmed contacts can be viewed, their **local** names edited and deleted, including offline with the previously unlocked identity. At no point does server search/inspection silently mark the peer as trusted.

**Teams:** no authoritative Team/TeamMember/ACL/encrypted grant model exists yet. The accepted UX has a single tab; **Create Team** is shown disabled with an explicit explanation. Likewise the only contextual **Blacklist** action is in the shared header but disabled until blocking implements actual server policy, key/role revocation and safe no-regrant rules. Do **not** pretend that hiding a row revokes E2EE keys.

## Encrypted local persistence

A separate IndexedDB/Dexie `pb3-encrypted-contacts-v1` store keeps only keyed SHA-256 indexes and per-row random-IV AES-256-GCM ciphertext. Peer account UUID, alias, key fingerprint and timestamps appear **only inside the ciphertext**, not in store names, primary keys or indexes. Encryption key: current unlocked account package AKEK. Associated data: `pb3.local-contact.v1\n` + owner-scope hash + per-peer row key. Each read recalculates current owner/peer index, authenticates AES-GCM and validates the strict canonical shape, and cross-checks the **independently confirmed** pinned directory fingerprint. Changed, missing or forged pins **fail closed**; cannot silently replace with a fresh directory response. In-flight read/edit checks owner account, device, AKEK and key revision to prevent A→B→A/identity swaps.

The encrypted local address book is **not** a server-synced contact graph, backup, encrypted message address book, or entitlement source. Removing a row does not modify the peer pin, outstanding signed assignment invitations, media grants or recipient-side cached keys. Outgoing assignment/photo-share pathways remain independently governed by their existing pinned-peer, server ACL and consent checks; merely adding a contact grants **zero** file rights.

## Acceptance and evidence gates

- Vitest: no plaintext alias/UUID/fingerprint in IndexedDB; offline local reload; multiple accounts scoped by their AKEKs; missing/rotated trusted pin; malformed/oversized alias; tampered IV/ciphertext/index; delete without revocation claims.
- Real Chromium two-account E2E: both account registrations, recipient signed exchange-key publication, owner independent fingerprint confirmation, local add, ciphertext-only IndexedDB check, reload, offline local alias edit and remove, other account isolation; Teams + Blacklist controls must not simulate authorization.
- PHP8.4/8.5, frontend strict TS, Vitest, build, security CI and PostgreSQL18/Garage2.5 existing 15 E2E journeys must pass against **exact final HEAD**.

**OPEN / NOT TESTED:** privacy-aware @username/#UserID search and profile visibility, actual Teams membership/curator/viewer rights, Blacklist server enforcement, cross-device contact synchronization, iOS/Safari/Android, cold offline bootstrap, independent security audit, production deployment, main merge and owner acceptance.
