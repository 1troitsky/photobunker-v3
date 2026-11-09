# P1-05 — immutable signed policy revisions (photo target vertical)

Status: **Draft code and tests; CI and independent review required**. Base is
P1-04 integration PR #20 at `e2215e13d687dca02e0063bc115ffeb31a164355`.

## Scope

Owners may edit the target photo count (1–9999 or no target) without changing
private title/instructions, original signed creation contract, key distribution,
TTL, assignment times, media type or existing recipient grants. This is the
first real mutable **owner-signed rule**. GPS/category/description requirements
are **NOT YET IMPLEMENTED**. The user interface cannot enable such requirements
until a privacy-preserving encrypted metadata and local validation vertical
exists; this module does not pretend that server can read E2EE metadata.

## Cryptographic and revision contracts

- Original owner-root signed `pb3.assignment.v1` stays immutable (revision 1).
- An amendment is signed by the same account-root key over canonical JSON with
  domain `pb3.assignment-policy.v1`. It binds `assignmentId`, owner,
  `rootPolicyHash`, `previousPolicyHash`, contiguous
  `fromPolicyRevision` → `toPolicyRevision`, target count and `['photo']`.
- Server accepts one new amendment only if owner, signature, strict shape,
  active assignment, last hash and revision match under a locked transaction;
  writes an append-only revision and server-issued `occurred_at_ms`. Lost-ACK
  identical signed operations replay unchanged even if the assignment finished.
- `assignment_records_v1` holds the latest signed amendment for list display;
  the initial policy stays in `contract_json`. The client verifies both the
  root and latest signatures against the independently verified owner key.
  Existing local highest-policy revision anti-rollback prevents replay of
  previously seen older policy revisions. Unlike a full epoch audit endpoint,
  fresh first-contact verification authenticates the latest owner-signed policy
  but cannot independently establish absolute freshness; no such claim is made.
- **State revisions are a separate counter** and their signatures remain bound
  to the immutable original owner policy. Goals do not reopen a finished
  assignment; edits while finished are denied.
- Offline photo v2 uses the specific signed effective policy hash and revision
  at capture, never an untrusted server goal. Server checks the *entire
  append-only policy event chain* and exact effective-time interval when
  a delayed personal ciphertext is reserved. Old captured photos retain their
  original revision; new captures use the latest revision. Invalid, stale,
  forged and out-of-window contracts return 409 without local media deletion.
- An already-reserved encrypted photo can later be submitted using its own
  historical policy revision as long as assignment is currently active and
  the contributor's consent and explicit recipient E2EE grant remain valid.
  Current authoritative receipt count continues to count only valid grants.
- Every effective time relies on a **client-claimed capture clock**, not
  trusted capture-time attestation. Signed policy alone cannot prove when a
  malicious device took a photo. Verification of current server rights still
  happens online; warm offline snapshots are never fresh ACL guarantees.

## Tests / non-goals

- PHPUnit: owner-signed amendment, chain/replay after finish, outsider/forged
  signature, stale/no-op/unsupported media, historical photo reservation before
  and after amendment boundary, exact policy hash.
- Vitest: owner signature, immutable root hash binding, forged amendment,
  rollback and equivocation.
- Existing Camera + R2-01 CI and E2EE two-device Chromium regressions must pass
  on this branch; new goal UI should be tested through Chromium before PR is
  declared integrated.
- No automatic remote deletion, private text rewriting or title change, no
  rekey, camera location claims, signed Service Worker or new grant shortcuts.
- Full amendment history publication, retention/compaction, concurrent
  offline editors and offline changes under stale policy require further
  deliberate versioning design. Maximum event walk is bounded at 1000; at
  capacity further history-based capture reservation is fail-closed.

No merge/deploy or changes to `main` without explicit owner authorization.
