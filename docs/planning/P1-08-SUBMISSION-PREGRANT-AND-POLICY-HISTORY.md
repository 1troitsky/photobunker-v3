# P1-08 — safe assignment submission / signed policy history

Status: **Draft; CI and owner acceptance pending.**
Base: P1-07 PR #23 @ `b3bc95ec2d45efc7485b9b11059d421fee2392c0`.

## Problem found and corrected

The previous contributor UI issued `queueRecipientGrant()` BEFORE verifying
that the selected local photo's signed assignment capture matched the intended
assignment, the active owner and the applicable privacy requirements.
A later server-side 409 could reject the submission, but the grant would
already have been queued/transmitted, exposing photo/metadata DEKs to the
recipient unnecessarily.

The safe order is now:

1. Verify the independently pinned owner identity and previously authenticated
   assignment snapshot; ensure the assignment is active.
2. Find the contributor-owned, **synced** photo by ID and decrypt the
   account-scoped metadata asset locally, with AEAD integrity checks.
3. For assignment-scoped v2 photos, compare the exact assignment/owner IDs,
   capturedAt, signed revision/hash, and the metadata's immutable
   assignmentCapture binding; reject any mismatch.
4. Apply required category, minimum trimmed description length and GPS
   requirements from the **effective historical signed policy**, rather than
   applying later stricter requirements retroactively to older photos.
5. Only after success, explicitly enqueue an E2EE grant. The signed
   submission uses the verified revision, not the current mutable revision.
6. Personal v1 photos remain intentionally shareable by explicit action (per
   accepted P1 assignment behavior and existing API tests); they must satisfy
   the **current** owner requirements and require additional confirmation
   because they were not originally captured for this assignment.

No photo/grant bytes are deleted on failed preflight.

## Owner-authenticated historical policy chain

- New `GET /assignments/v1/{assignmentId}/policy-history` is available only
  to the assignment owner and **accepted** invitees; invitees who have not
  accepted consent, outsiders and revoked invitations receive 404.
- Response contains immutable original root hash, current revision and a
  bounded ordered list of prior owner-signed revision contracts and their
  authoritative `occurredAtMs`. It contains no private title, instructions,
  raw coordinates, private description, wrapped keys, media bytes or recovery
  secret.
- The client authenticates the root creation signature through the pinned
  owner account key, and verifies every intermediate owner amendment's domain,
  P-256 signature, exact schema, root hash, predecessor hash, revision
  continuity, no v2→v1 downgrade, media type and effective interval. The final
  event must byte-match the latest authenticated policy snapshot.
- Original capture revisions and exact effective windows are preserved.
  For a historical revision older than the latest, when an independently
  verified full chain is not available, the official client **fails closed**
  before grant issuance. Current implementation requests the full chain online;
  first-time offline historical grant preflight (revision >1 and older than
  latest) is not yet supported. This is a deliberate fail-closed Local-First
  limitation, not a claim of current ACL freshness or permission to delete
  an offline photo.
- A valid signed timestamp still does not prove genuine device capture time:
  capture time remains an untrusted signed device-clock claim. Server retains
  independent membership, finalization, grant and event-window checks.

## Precisely stated metadata sharing boundary

The current `pb3.photo-grant.v1` wraps **all the photo's asset keys**,
including the encrypted metadata asset. Recipients with a valid grant
can therefore decrypt photo and metadata (including GPS/description) even
though the server never sees plaintext. The UI now explicitly states
this before submission and adds an additional confirmation for personal v1
photos. Restricted per-asset grant scopes are a separate security decision
and are NOT implemented by this PR.

## Validation gates

- PHP feature test: no history for unaccepted invitee, outsider 404,
  accepted contributor/owner only, v1→v2 signed history and ms boundary,
  no plaintext in response.
- Vitest: full root/previous hash/revision/signature chain; forged,
  truncated, time-reordered and cross-owner history; no retroactive required
  GPS on earlier photos; no wrong assignment or private metadata mismatch;
  verify no grant is permitted on missing current requirements.
- Real Chromium E2E with actual two-account session + PostgreSQL18/Garage2.5:
  a valid old capture still receives the original approved photo grant;
  a personal v1 photo without newly required fields must be rejected
  **before any outgoing grant is added**, even though it has synced.
- Existing P1 R2-01/02, camera, policy and lost-ACK regressions must remain
  green. Native Safari/physical hardware and independent Round 2 recheck
  remain NOT TESTED until separately reproduced.

No changes to `main`, no merge or deploy; do not label Draft as accepted.
