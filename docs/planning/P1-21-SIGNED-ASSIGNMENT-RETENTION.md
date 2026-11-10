# P1-21 — Signed assignment retention and non-destructive logical tombstones

**Status:** Stacked Draft PR [#39](https://github.com/1troitsky/photobunker-v3/pull/39) on immutable tested P1-20 [#38](https://github.com/1troitsky/photobunker-v3/pull/38) `bb04b62e14ea611ce2dc8cd85dc99fc8df228282`. **Not merged, deployed or owner accepted.** This document describes implemented scope, not permission to enable destructive deletion.

## Rights and user-visible behavior

Assignments may have two independent **owner-account-signed association access deadlines**, both null/OFF by default:

- `filesAccessUntil`: assignment-scoped receipt/listing/grant/capture access closes at the authoritative server time. A contributor-owned photo/audio/video object remains available to its rightful owner and to recipients through independent valid grants and TTL.
- `assignmentAccessUntil`: the assignment association, its E2EE private title/instructions, invitations and owner/recipient listing become inaccessible to accepted participants; an authenticated owner can still inspect non-secret retention status and signed history for auditing.
- The assignment-access deadline cannot precede the files-access deadline. Neither deadline can be before the active signed assignment schedule end or at/before the server's current time when signed. Deadlines are independent of `startsAt`/`endsAt` admission gates and **never extend** individual S3 object TTL or recipient rights.
- Setting `deleteOriginals:true` is expressly rejected by the server and never offered as an active control in Fieldwork. The disabled UI is intentional. Owner of an assignment is not automatically owner of contributed media.

An existing deadline cannot be revised after it has elapsed, even to remove the deadline. Expiry is enforced at read/write authorization time regardless of whether the maintenance scheduler is running. Client-side warm offline snapshots verify the owner signature and decline expired assignment operations instead of implying server acceptance.

## Signed history, identity and replay invariants

Domain-separated owner-account signature `pb3.assignment-retention.v1\n` covers an exact canonical JSON object with:

`version, operationId, assignmentId, ownerAccountId, rootPolicyHash, previousRetentionHash, fromRetentionRevision, toRetentionRevision, filesAccessUntil, assignmentAccessUntil, deleteOriginals`.

- Immutable root signed creation policy remains unchanged. Each valid amendment has a monotone CAS revision and hash of the immediately preceding signed event (or root on first amendment). Stored events are append-only; the client verifies complete history on authenticated online listing and refuses signature, ancestry, snapshot, rollback and equivocation mismatches.
- Owner alone may sign updates, with an enrolled identity/device and the existing CSRF/origin checks. Accepted invitees can read signed history while their assignment access is valid; pending invitees and outsiders get 404. Owner status is owner-only.
- Identical replay after lost ACK returns the previous acceptance without creating another event, including after further revisions. Different payload with reused operation ID, bad domain signature, stale revision and wrong owner are rejected.
- The browser writes the signed operation to its account-scoped durable outbox. `queued` is **not** a cloud receipt. Changing identity clears the in-memory private context; no private text, media or DEK is included in the public retention contract.

## Logical lifecycle only

`pb3:assignment-retain --batch=N` is disabled unless `PB3_ENABLE_ASSIGNMENT_RETENTION` is explicitly enabled. In the `assignment_retention_tombstones_v1` ledger, it records a due file or assignment association cutoff once, with bounded retries and stable root/owner references. Missing one deadline does not prevent reconciliation of the other; the ledger is idempotent.

This job **does not** issue S3 DELETE, remove grant rows, delete participant media, mutate object location maps, erase the original signed assignment policy or claim physical deletion. Status reports `physicalDeletionConfirmed:false` and `physicalStatus:not_authorized`. Pre-existing independent owner-file TTL cleanup remains separately operator-gated.

## Verification and acceptance gates

Automated regressions are added in `apps/api/tests/Feature/AssignmentV1Test.php`, `retention-editor.test.ts`, and `retention-outbox.test.ts`:

1. Valid signed revision, accepted-member/owner visibility, pending/outsider denial, invalid `deleteOriginals`, reversed deadlines, forged signature, stale CAS and lost-ACK replay.
2. Immediate server cutoff independent of disabled scheduler, separate file vs assignment cutoff, bounded `dueIds` rescan, persistent idempotent ledger and explicit contributor-original preservation.
3. Local-time input lossless millisecond handling, malformed/reversed/expired deadline refusal, signed owner offline operation, root hash, no plaintext, and negative rollback/equivocation/forgery/projection tests.

**Verify exact final SHA and 3 workflows in PR #39** before considering this gate passed: PHP 8.4/8.5 security-floor/Laravel tests, Vitest/TypeScript/build, and actual disposable PostgreSQL 18 + Garage 2.5 + two-account Chromium E2E. Previously green pre-regression CI is not sufficient for these new tests.

**Not tested / not accepted:** physical iPhone/Android, native Safari, cold offline service-worker bootstrap, external independent cryptographic review, production workload, operator enablement, or owner acceptance. Existing Chromium suites check regressions but do not independently prove full retention UX on real devices.

## OPEN — separate future consent/deletion protocol

A destructive implementation requires explicit **contributor-owned deletion authority** for each independently owned media object; proof of that authority and scope tied to exact signed object/version IDs and recipient rights; safe lost-ACK/replay/revocation semantics; provider-specific object version/generation fencing; all configured primary/replica/BYO locations; durable reconciler, verified physical absence, partial failure recovery, backup/retention consequences; and independent safety review. No assignment-owner signature alone authorizes deleting contributors' originals. The future contract must not be guessed or silently activated in P1-21.
