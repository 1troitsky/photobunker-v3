# P1-07 — подписанные обязательные поля съёмки (Zero-Knowledge)

Status: **Draft, pending green CI / owner acceptance**. Based on P1-06
encrypted capture metadata PR #22 at `d3cb8f1ea59e7a6191095bd9c9aeba48d4adcf66`.

## User flow and effective policy

The assignment owner can create an append-only, account-root-signed public
policy amendment with:
- `requiredCategory: boolean` — nonempty trimmed private category required;
- `descriptionMinLength: integer (0..4000)` — minimum nonempty trimmed
  encrypted description length; 0 = optional;
- `requiredGps: boolean` — a finite, explicit browser GPS fix no older than
  120 seconds, with valid latitude/longitude/accuracy, required.

The user may also change the photo target. Amendments are signed with
`pb3.assignment-policy.v2\n` over canonical JSON and bind original signed
creation root, previous policy hash and contiguous policy revisions.

Historical v1 goal-only amendments remain accepted **as historical data**.
The server rejects a v1 goal edit once a v2 requirements policy is in force:
an out-of-date client must not silently disable requirements. A no-op is
rejected unless target or a requirement changes. All operations retain
idempotent lost-ACK replay, active-only edits, assignment end ceiling, and
1000-event bounded append-only history.

Assignments, accepted invitations and cached capture policies are checked
against the pinned independent owner account key and signature domain on
the client. A warm-offline capture is possible using the most recent
**previously authenticated** policy snapshot. Offline freshness is not an
authority guarantee: a server may reject a later reservation when membership
or effective-time boundaries changed.

## Enforcement and privacy limits

- `signedCaptureBinding()` receives the exact same private category,
  description and GPS snapshot that will be encrypted into the metadata
  asset. The official camera rejects incomplete requirements **before
  saving**; no private plaintext touches the server or IndexedDB outbox row.
- The photo contract v2 contains only the server-visible signed
  `policyRevision`, `policyHash`, assignment/owner IDs and claimed
  `capturedAt`; it does **not** include category text, description or GPS.
  Backend verifies revision, immutable signature ancestry, history
  effective time and current membership/ACL. Historical offline photos
  retain their previous signed version after stricter rule changes.
- **Explicit limitation:** A Zero-Knowledge server cannot independently
  inspect encrypted category/description/coordinates or prove actual
  presence/precision of private GPS without additional cryptographic
  proofs/trusted capture attestation. The signed owner requirements are
  enforced by the official client, not cryptographic proof of a compliant
  hostile client. No misleading server-validated GPS claim is permitted.
- Future upload-from-device, edited derivatives, assignment completion and
  owner-directed submissions need equivalent effective-rule checks; this
  vertical does not claim those routes are fully implemented.
- GPS permission remains user-triggered. Native Safari and physical mobile
  devices remain **NOT TESTED**. Signed PWA trust anchor remains unresolved.

## Gates

- PHPUnit: v2 owner signature, immutable root and previous hash, v1 downgrade,
  2->3 changes, lost ACK, forged domain, invalid/min length/unknown plaintext
  fields, v2 historical photo reservation after stricter policy change.
- Vitest: verified v2 policy, pinned account verification, offline required
  category/description/GPS rejects, valid signed binding/hash, altered
  signature rejects, goal-only edit preserves required fields.
- Chromium with two accounts, PostgreSQL 18/Garage 2.5: legacy offline
  capture sync after owner edits target, explicit strict requirement toggles
  after old owner grant, fail-before-capture when mandatory field missing,
  genuine GPS after permission, valid encrypted photo; finish/resume preserves
  policy and old grants.

No merge/deploy; `main` remains unchanged.

## CI observations, 2026-11-09

Initial code head `175a8f950f5b28259048f02f6f721c5fcf2081ba`:

- **PASS:** PHP 8.4 and 8.5 security/config (push workflow
  `42671565943`, 2/2 individual jobs).
- **PASS:** Laravel/PHPUnit on PHP 8.4, Vue TypeScript/Vitest/build
  (push workflow `42671565970`, existing 2/2 individual jobs).
- **PASS:** disposable PostgreSQL 18/Garage 2.5 + Chromium full
  two-account E2EE acceptance including required fields
  (PR workflow `42671624762`).
- **Workflow-level FAIL / environment inconclusive:** push Laravel
  workflow and PR Laravel workflow lacked the PHP 8.5 Laravel job; PR
  security workflow created **zero jobs**, and push storage workflow
  created **zero jobs**. These runs returned GitHub workflow-level
  failure despite successful separately checked jobs.
  Attempts to re-run failed jobs through GitHub Actions API returned
  `403: This workflow run cannot be retried`.
  No unexecuted PHP 8.5 PHPUnit or missing workflow run is reported as
  PASS. This may be a GitHub orchestration/runner issue; an independent
  run must verify the absent checks before owner acceptance.

Do not treat missing jobs as proof of a product test failure, nor silently
treat the workflow-level failures as successful. `main` remains untouched.
