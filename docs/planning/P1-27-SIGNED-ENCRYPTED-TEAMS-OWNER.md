# P1-27 — Signed encrypted Teams owner creation (first vertical)

**Base:** `main@ee0cbe6836b5359e971319dfc8ae91ef695c7d42`.
**Status:** Draft PR #50, subject to final CI; not merged, not released.

## Contract and boundaries

The owner signs canonical `pb3.team-create.v1\n` + JSON with `version, teamId, operationId, ownerAccountId, privateEnvelope`. The `privateEnvelope` is AES-256-GCM of a JSON object containing `name` and `description`, encrypted under a random, immutable **Team DEK** with AAD `pb3.team-profile.v1\n{ownerAccountId}\n{teamId}`. That 32-byte Team DEK is **not** the account AKEK: the account AKEK encrypts only `wrappedKey` (48-byte ciphertext with AES-GCM tag) under AAD `pb3.team-owner-key.v1\n{ownerAccountId}\n{teamId}`. The signed envelope therefore contains `version, iv, ciphertext, wrappedKey`. This separates future member ECDH-wrapped access from owner identity, without re-encrypting existing team profiles. The server sees only ciphertext, authenticated owner ID and owner signature; it cannot decrypt either layer.

POST `/teams/v1` checks authenticated sessions, origin, exact signed schema, strict ciphertext boundaries, owner binding and P-256 account signature. Database transaction locks owner identity, applies immutable ID/operation uniqueness and exact replay. Creates one authoritative `team_records_v1` plus `team_members_v1` owner row (role `owner`, state `active`). GET `/teams/v1` is bounded, cursor-paginated, owner-only; GET `/teams/v1/{id}` returns 404 to outsiders. Responses echo the immutable signed contract; the browser independently verifies signature, unwraps the owner-protected Team DEK with current AKEK, then decrypts the team profile.

The UI in the single «Контакты и Команды» view supports Create team, encrypted name/description, offline local list, explicit `queued` vs `synced` vs `conflict` state, retry and online reconnection. Durable encrypted IndexedDB row stores the exact signed operation before the first network request. The owner ID, team title, description and JSON contract are not stored as plaintext/indexes; local row scope is hashed and authenticated by AES-GCM AAD. Lost ACK retries re-send the *identical* signed payload. Network failure never claims cloud success. Account/device/key swaps fail closed.

## Non-goals and next scope

Owner membership is the only role currently created; no fake team participant UI, no inferred assignment memberships, no inherited E2EE grants and no automatic file decryption. The next vertical adds separately signed invites, explicit recipient acceptance, curator/contributor/viewer ACL with grant-scope decisions, and server-enforced revocation. Full Team profile/detail screen, multi-device team profile envelopes, Blacklist and search are separate future work.

## Evidence

- Backend tests exercise exact signed create/replay, owner ACL/404, tampering, domain separation, idempotency, cursor paging and absence of implicit file grants.
- Vitest exercises ciphertext-only local persistence, offline account isolation, lost ACK exact replay, and untrusted server rows.
- Exact HEAD CI (PHP8.4/8.5, Vitest/TS/build, PG18/Garage2.5, Chromium) must PASS before marking this Draft ready for local-agent review.
- Native Safari/iPhone/Android remain NOT TESTED; cold trusted offline boot remains BLOCKED BY DESIGN.
