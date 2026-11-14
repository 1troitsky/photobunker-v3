# P2 #408 — signed owner-media submission bootstrap QA

**Source:** accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b`, original unrelated P1 #402 Draft #403 `f56e42ec3224bdd995f75c26abd47220469bda55`, real workflow [#43623349481](https://github.com/1troitsky/photobunker-v3/actions/runs/43623349481) **94/96 Chromium**. Only one failure class is within this Issue. Own QA-only branch `qa/p2-408-owner-media-session-chat-ai-20261114`. No authorization to merge main.

## Evidence from genuine first-failure trace

Original GitHub Actions Playwright ZIP artifact **14125127652** (`p1-browser-traces`) was downloaded and inspected without disclosing recovery keys, signed request bodies, device private keys or plaintext media.

- Failed existing `tests/e2e/p2-browser-contributor-photo-submission.spec.ts:131`: after contributor signed MediaFile submission `POST /assignments/v1/{assignmentId}/media-submissions` responded **HTTP 201**, owner hard-navigated to `/assignments`, clicked `Обновить`, `Открыть`, `Обновить материалы`, but `assignment-media-submission` remained **0**, expected 1 (20 seconds).
- The owner request trace showed authentic `GET /identity/v2/csrf`, signed challenge and proof responses **HTTP 200** during session re-unseal, but **NO GET /assignments/v1/{id}/media-submissions** after the owner material-refresh click. This is direct evidence of a **missed browser request**, not of a server-side missing receipt, and not of an ACL bypass.
- Current `apps/web/src/views/AssignmentsView.vue::loadSubmissions()` skips without a request while `!activeSession.online`. Since `main.ts` mounts the app before delayed signed reproof completes, the test had not ensured that post-navigation account/device were authenticated when clicking.
- A second distinct test `p2-browser-assignment-preview-ceiling.spec.ts` stalled while clicking the Rules tab; **not touched** here, no conflation of root causes.

## Narrow QA implementation

Change **only** `tests/e2e/p2-browser-contributor-photo-submission.spec.ts`, keeping original:
- contributor original encrypted MediaFile uploaded to real Garage,
- genuine signed owner invitation/participant verification,
- contributor signed submission and authenticated owner ciphertext read,
- independent owner E2EE decrypt and private metadata checks,
- revocation denies new recipient access, original contributor media remains present.

On initial registration capture immutable account+device IDs while verified online, then after every hard route navigation wait for **both** (a) correct local account+device online and (b) real authenticated **`GET /identity/v2/me` HTTP 200 and matching server account+device**. Wrong account/device throws rather than retrying to false green. No artificial sleeps, auth state mutation, mock receipts, test retries, disabled assertions, generalized timeout extension, shared Playwright config or production code changes.

After contributor-signed HTTP 201, explicitly verify real owner-side `GET /assignments/v1/{id}/media-submissions` returns **200 with one receipt**, then observe a **second genuine HTTP GET response after the UI's refresh click** before retaining the original rendered-count and decrypted ciphertext assertions. If the API responds 0 or UI still skips, test FAILS with scoped evidence rather than pretending successful sync.

## Verification limits

- Source-level trace diagnosis **does not prove** all server/client races share the same cause, and the test barrier is NOT a production fix for UI's silent early return. That UX bug may need a separate product Issue/branch after security/identity integration planning.
- A green test may only establish correct behavior after confirmed real signed session, not that an unauthenticated or revoked device can refresh. No forced online state, fake ACK, or ACL bypass.
- Await exact own Draft HEAD Foundation/Security/UX/real PG18+Garage+Chromium CI. Preserve first failed original trace and any new failure. Other foreign tests/branches including #403 and #405 must remain unchanged. Physical iOS/Android NOT TESTED.
