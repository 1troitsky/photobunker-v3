# P1-23 — owner-only live participant roster

**Status:** stacked Draft, no merge/deploy/owner acceptance. Base: P1-22 Draft PR #40, commit `95ec6a61f55dcb181a05f10f67f74664ba3b7f6e` (3/3 GH Actions PASS including 15/15 real Chromium).

## Purpose and boundaries

The accepted Fieldwork Editor **Участники** tab previously sent owner-signed invitations but did not display an authoritative list of recipients. This slice adds a **read-only roster** and does not invent curator/viewer roles, per-media permission scopes or decryption-key revocation.

- API GET `/assignments/v1/:assignmentId/participants?after=UUID` requires current enrolled session, owner-account match and unexpired assignment-access scope. It returns **404** to accepted recipients and outsiders as well as other owners; no recipient graph is disclosed through this endpoint.
- Pages are sorted and capped at 50 invitations, with cursor pagination and a server timestamp. The server returns the stored **original owner-signed invitation** plus server-observed `pending` / `accepted` and `expired` status. Pending invitation expiry is derived from **server time**, never a trusted browser clock.
- The client verifies the roster item’s cryptographic owner signature, assignment/root owner, recipient account, signed role and expiry, rejects malformed/duplicate pages, and never maps an optimistic queued invitation to **accepted**.
- Live-only owner roster: **no offline roster cache** and no stale "0 participants" assertion during an outage. The UI shows a clear offline/error/loading state. Current permission remains **contributor only**. An invite grants assignment participation after recipient acceptance, **never implicit E2EE media access**.
- The displayed `Принято сервером` is a verified API database state, **not** an independently proven recipient cryptographic acceptance token, and **not** a certificate that previously shared assignment DEKs have been erased. Future revocation must add a separate access/key epoch model.

## Acceptance checks

- PHP: owner-only signed invitation list; pending → accepted server state, recipient and outsider 404, cursor handling and malformed cursor 422.
- Vitest: valid owner signature, recipient/role/expiry substitution, forged signature, invalid derived expired state, duplicates, oversized page and cursor equivocation.
- Chromium two-account E2E with PostgreSQL 18 / Garage 2.5: owner sees pending after actual signed invite; participant accepts; participant receives 404 on owner-only roster; owner then sees `Принято сервером`.
- PHP security-floor/config; Vue typecheck/build; current parent full integration suite.

CI results must be verified against exact final PR SHA; previous green runs do not prove new code. Not tested: physical iOS/Android, full Contacts/Teams UX, role changes, contributor revocation, BYO S3, production or owner acceptance.
