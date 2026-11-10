# P1-20 — Signed, versioned assignment scheduling (Fieldwork «Основное»)

**Status:** Draft, pending final CI. Stacked on P1-19 [Draft PR #37](https://github.com/1troitsky/photobunker-v3/pull/37) exact commit `2a1c25b40f3ef2e091e9f2059ac5e8b31b1a7a53`. PR #38 (P1-20) is not merged, deployed or owner accepted. `main` is immutable without explicit owner approval.

## What ships

A signed owner-account-controlled **time-window amendment**, separately versioned from capture-policy v6, text AEAD private v2, and state v1. Changing a start/end time does **not** tamper with the original signed creation contract, E2EE DEK, invitation ECDH envelope, TTL or physical storage.

- `startsAt`: non-null Unix ms. `endsAt`: null or Unix ms strictly greater than start.
- `blockBeforeStart` and `blockAfterEnd` are independent booleans. OFF means the configured date is informational; the assignment can continue to accept new authorized submissions, but all independent identity, explicit E2EE grant, capture policy, assignment state and resource TTL checks still apply. `blockAfterEnd` must be false when `endsAt=null`.
- **Legacy compatibility**: original signed v1 root dates remain hard admission gates (start always, end if present), as before. Owner explicitly saving a new signed schedule may disable either gate. No automatic historical authorization change; the server makes admission decisions based on the latest active schedule using the authoritative clock. A device's signed timestamps alone do not attest when recording actually happened.
- New DB columns: `schedule_revision` (1 root), `latest_schedule_contract`, `latest_schedule_signature`; append-only `assignment_schedule_events_v1`. Original `starts_at`, `ends_at`, root `contract_json`, root signature, policy and private ciphertext are immutable. Never copy new schedule dates over immutable root.
- Owner-signed command domain: `pb3.assignment-schedule.v1\n` over JSON bytes with **exact ordered fields**: `version`, `operationId`, `assignmentId`, `ownerAccountId`, `rootPolicyHash`, `previousScheduleHash`, `fromScheduleRevision`, `toScheduleRevision`, `startsAt`, `endsAt`, `blockBeforeStart`, `blockAfterEnd`. Parent hash is SHA-256 of the preceding signed schedule command or root signed creation contract for first amendment. Idempotent lost-ACK replay even after further edits/finish; conflicting or stale CAS, wrong owner, wrong signature, fake dates, no-op edits fail closed.
- `POST /assignments/v1/{id}/schedule` requires enrolled owner, exact Origin, CSRF and owner-root-signature. `GET /assignments/v1/{id}/schedule-history` is accessible to owner or **accepted** participant, not an unaccepted invitee, without leaking keys or private metadata.
- Signed listing still exposes **root** `startsAt` and `endsAt`; effective time is computed on the client *only after verifying* the owner signature and full history. Snapshot contains latest `scheduleRevision`, `scheduleAmendmentContract` and `scheduleAmendmentSignature`. Clients reject rollback, equivocation and malformed signed dates, with an account-scoped persisted authenticated snapshot.
- Fieldwork Editor 2.2, tab «Основное»: explicit datetime-local fields + two real toggles, revision-aware Save and Cancel, durable signed offline outbox. Unchanged minutes preserve original subminute precision to avoid silent timestamp edits. Owner cannot be tricked into signing stale or unsigned new dates after a concurrent edit.
- All photo submission, media submission, media recording intent, recipient-grant preflight, state-resume admission and local capture pathways use effective latest time policy; the backend uses its own receipt time for current upload admission. Previous media E2EE grants and receipts remain immutable.

## Intentionally NOT implemented

Time limits are **not** automatic deletion deadlines and do **not** expand the TTL of individual files, media grants, or subscription entitlements. Do not confuse `finished` with deletion, archive or revocation. User-selected automatic removal of files and assignments requires a separate authority-checked, outbox-safe, idempotent tombstone → background GC → proof-of-physical-deletion implementation, including all storage locations. No physical cleanup is triggered by signed schedule amendments.

Future hardening: binding the exact schedule epoch to recording proof for more precise **historical** capture timestamp attestation. Existing `pb3.assignment-media-capture.v1` remains owner-policy-revision bound; the signed latest schedule controls **current admission**. A signed device timestamp is not hardware or clock attestation. Captures may be rejected by the server if the schedule changes before submission; offline UI does not promise server acceptance.

## Evidence checklist

- PHP (8.4/8.5): root immutable, independently signed schedule revision, gate ON/OFF before/after, parent hash, original default, lost ACK, stale CAS, forged signature/invalid dates, unauthorized history versus accepted member, no deletions.
- Vitest/TS: local datetime ms retention and DST invalid-date rejection, signed event shape and account signature, schedule rollback/equivocation refusal, offline encrypted outbox/cached signatures.
- Chromium + PostgreSQL 18 + Garage 2.5: original two-account media assignment journey still works, plus actual owner schedule edit with future start, accepted contributor independently verifies and enforces block-before, second owner revision permits before-start and blocks after-end; original owner-signed root and accepted private AEAD text remain authentic.
- Mobile Safari, physical iOS/Android: NOT TESTED. Cold offline PWA bootstrap remains outside scope. No `main` merge.
