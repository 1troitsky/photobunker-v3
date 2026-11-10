# P1-15 — independent owner-signed targets for photo, video and audio

Status: **Draft / pending independent CI verification**. Stacked on
[P1-14 Draft PR #32](https://github.com/1troitsky/photobunker-v3/pull/32)
at immutable `57bdad994393fd4c68a06059458ad5b64307e9e5`.
No merge, deploy, or modifications to `main`.

## User journey

An owner edits an accepted assignment, enables video and/or audio, and
optionally sets target **video 1–999 / audio 1–999**. Photo target remains
optional **1–9999**. Each target is displayed alongside its own actual,
server-confirmed, live E2EE-grant-scoped receipt count. The combined
percentage is:

`round(100 * Σ min(live_count_kind, target_kind) / Σ target_kind)`

Only kinds with a non-null target participate in either sum. If no targets
exist, there is **no combined percentage**. If any targeted kind has an
unknown count while offline, combined progress is **unknown** instead of
invented. Pending local encrypted media are shown separately. Targets do
**not** limit accepted file uploads; a count can exceed a target.

A previously signed policy v1, v2 or v3 has no video/audio target; its
client representation resolves the absent values to `null`.
All *new edits by the current browser* use owner-account-signed
`pb3.assignment-policy.v4\n`, preserving root, previous policy hash,
revision monotonicity, photo capture rules, and explicit v3 media opt-in.
The exact v4 fields extend v3 by `videoGoal` and `audioGoal` (each
`integer|null`, always present). A target for a disabled media type
is invalid. Clearing or disabling a media type requires a newly signed
policy edit.

## Integrity and privacy boundaries

- Both additional targets are **public counts** in the signed policy,
  just as `photoGoal` already was; no private instructions, original
  filenames, category values, raw GPS, or ciphertext are published.
- The server checks exact canonical signed v4 fields, bounds, enabled
  kinds, owner identity, root and previous policy digests, revision and
  lost-ACK replay. V4 cannot be downgraded to a previous version.
- The client **independently verifies the owner-account signature**
  and checks server display projections (`videoGoal`, `audioGoal`)
  against the exact owner-signed v4 payload. It rejects unsigned target
  injection and policy equivocation/rollback before caching.
- Existing MediaFile/v1, separate recipient grants, photo capture v2,
  media capture proofs v1, and media submit v1/v2 accept v4 owner policy
  when explicit kinds and current revision/hash match. No implicit grant.
- Live receipt counters remain backend-calculated from unexpired media
  plus active, correctly addressed E2EE grants; targets never affect ACL
  and do not create quotas.
- No database migration is needed: the canonical signed policy event
  already persists the full contract. Listing projections are derived
  from that immutable contract. Earlier versions project `null`.

## Acceptance

1. PHPUnit: invalid disabled-target/negative/too-large goal; signed
   independent goals; lost-ACK replay; v4-to-v3 downgrade prevented;
   v4 targets do not cap two authorized video submissions.
2. Vitest: older policy => no media targets; client validates types,
   signed values, target bounds and server-projection mismatch.
3. Full PostgreSQL 18 + Garage 2.5 + Chromium journey: owner signs
   video target **2**, audio target **1**; contributor independently sends
   1 video + 1 audio; owner sees **67%**; revoke video E2EE grant and
   observe **33%** without deleting the underlying owner-contributed
   media; earlier photo/policy/recording flows continue.

## Not included

- Video/audio per-kind *mandatory category/description/GPS/tags*,
  private per-kind instructions and evidence schema. These require
  separate signed rule semantics **and verified encrypted private
  metadata capture**. A declared GPS string alone is not physical
  attestation. Do not set hard mandatory flags until a real media
  recording/capture flow can meet and verify them.
- More than one independently allowed type without photo (v4 retains
  canonical photo-first allowed-media sets for backwards compatibility),
  time-based goals, upload limits, entitlement changes, full assignment
  editor Fieldwork migration, native Safari/hardware QA.
- Production deployment or acceptance. Automated Chromium tests cannot
  establish device/hardware origin or native iOS behavior.

Next: P1-16 private per-kind requirements and E2EE metadata with safe
preflight; separate native Safari/iOS QA gate when applicable.
