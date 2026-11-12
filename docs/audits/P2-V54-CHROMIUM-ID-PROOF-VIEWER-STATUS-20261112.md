# P2 V-54 QA — authenticated device proof and correctly scoped Viewer status

**Status:** test-only changes; exact-head CI PENDING.
**Product parent:** Draft PR #160 at 5ed67d74d72c207a3b50ac7d623ec29a3790d2f5.
PHP 8.4/8.5, Vue TypeScript, 329 Vitest and security PASS.
Product Editor Undo/Redo and signed private JPEG checks remain unchanged.

## Exact observed failures

The parent 5ed67d74 has two complete **53/54 FAIL** attempts on
[real PostgreSQL18/Garage workflow 43173554627](https://github.com/1troitsky/photobunker-v3/actions/runs/43173554627):

1. Job 131032298522 — P1-04 encrypted assignment delivery in
   tests/e2e/p1-identity-photo.spec.ts:448: expected genuine authenticated
   HTTP 200 from GET /identity/v2/me but received 401 after invoking
   resumeExistingDevice() following synthetic Session replacement.
2. Job 131034740455 — P2 bounded Viewer cloud-index replay in
   tests/e2e/p2-browser-file-viewer-index-target.spec.ts:109:
   document-wide getByRole('status') hit two legitimate status elements
   (canonical shared Shell plus File Viewer feedback).

**The new V-54 crop/rotation/RGB/history browser scenarios passed in
both attempts**. None of the product authentication, Viewer status
component or signed media routes was changed by PR #160.
These failures must not be silently marked PASS.

## Fix A — complete a real signed proof, not a fake online flag

Per apps/web/src/features/identity/application/session.ts, Local-First
resumeExistingDevice() first activates an offline cached E2EE session,
then tries signed login proof, swallowing network/revocation failure
for legitimate read-only offline behavior. Resume alone therefore
does NOT imply that the server has an authenticated 200 session.

The test now additionally calls the existing reauthenticate(), which
awaits pending resume and performs the real signed login proof if
needed, before checking the same exact protected HTTP **200** endpoint.
It then continues verifying the same locally selected assignment,
real server sync, independent invitation, verified fingerprints,
device-specific envelope, and encrypted photo delivery. If the proof
is denied, the explicit reauthentication throws and **the test fails**.
If a wrongly cached online state returns early, the existing 200 check
still **fails**. No mock cookies, no bypass, no retry loop, no relaxed
expected status, no new product credentials or timeout inflation.

## Fix B — select only the actual Viewer status

The Viewer replay test deliberately serves an invalid cursor response,
checks the Viewer preserves verified files and index position 50/50,
and asserts an explicit warning. The page now contains an independent
global Shell status; unscoped getByRole('status') is ambiguous.

The test now queries .file-viewer-feedback [role="status"] and still
demands the **exact** warning text
«Ранее проверенные файлы и курсоры сохранены.», requires the malformed
page was genuinely delivered, keeps 50/50 navigation, and checks the
real encrypted/decrypted audio. No skipped test, first-element shortcut,
mock ACK, relaxed warning, or weakened ACL.

## Scope and gates

- **Lane:** PRODUCT-QA, stacked on PR #160 exact SHA 5ed67d74.
- **Changed files:** only two existing Chromium specs above and this audit.
- **Unchanged:** all production Vue/TS, backend, session proof/domain
  crypto, E2EE Media Outbox, Shell, routes, storage, ACL/TTL, original
  accepted docs/ux, integration branch #158, Matrix and main.
- **Parallel #158:** last reviewed combined integration is based on
  product #157, and does not yet include #159, #160 or this QA.
  No parallel files or branches are modified here.
- **Release gate:** PHP 8.4/8.5, Vue strict TS/Vitest/build, security,
  real PostgreSQL18/Garage, and **54/54 real Chromium E2E** on this
  exact combined descendant head, with retries:0.
- A green QA descendant does **not retroactively make parent #160
  exact-head CI green**; old failures remain in audit. No automatic
  merge/deploy or owner device/visual acceptance.
