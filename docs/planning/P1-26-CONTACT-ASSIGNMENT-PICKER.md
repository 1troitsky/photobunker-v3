# P1-26 — safe contact picker for contributor assignment invitations

**Status:** stacked Draft on [P1-25 PR #43](https://github.com/1troitsky/photobunker-v3/pull/43), parent exact SHA `1e98f6e2b3c865fde97ea2687f55efaf4fcd7d84`. This is incremental Fieldwork UX only; no main merge or deploy.

## Functional scope

The Fieldwork **Участники** tab can now show the real P1-25 local encrypted Contacts book (per current account/package AKEK). Every item has already been explicitly fingerprint-confirmed by the user through the existing signed ECDH directory/pin workflow.

**Choosing** a contact merely inserts the exact internal UUID into the existing invitation editor and invokes the existing `inspectPeer()` again to compare fresh owner-signed directory/pinned key. If the directory rotated, signed fingerprint no longer matches or account changes mid-operation, selection must fail closed. The user still clicks **Отправить подписанное приглашение** to enqueue the same existing owner-signed invite. The server still verifies the recipient's current key descriptor, owner, scope, active assignment, consent and idempotency; selecting a contact never creates a membership, sends an invite, unwraps a DEK or issues a photo/media grant by itself.

The picker is based on **local contact data only**; it does not assert a server-side authoritative friendship relationship, cross-device sync or team role. The original exact-UUID invitation flow remains available so existing assignments are not broken. Offline/locked account has no implicit new permissions.

## Tests and acceptance

- Real two-account browser E2E on PostgreSQL18/Garage2.5: register A/B, B publishes signed ECDH key, A independently fingerprint-confirms and adds B via real encrypted Contacts page, A creates a signed E2EE assignment, A opens Fieldwork **Участники** and chooses B from the actual contact book.
- Verify owner roster is still **empty after selection**, before separate explicit Send. Only after Send should server-backed roster transition to pending; B must independently verify owner's fingerprint and accept.
- Verify **zero photo grants** arose from a contact selection/invite; all existing E2EE media and assignment invariants preserved.
- Check Vue strict TS/build + Vitest, PHP8.4/8.5, security config, and **all** existing Chromium E2E on exact final SHA.

**OPEN:** Teams and meaningful team roles/ACL, server-backed Blocklist and contact graph, @username/#UserID search, native Safari/physical device QA, independent security review, merge/deploy and owner acceptance. No revocation of any previously shared DEK, no deletion of other contributors' originals.
