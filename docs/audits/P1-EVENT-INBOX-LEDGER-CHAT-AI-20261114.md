# P1 #406 — PostgreSQL durable event inbox (CHAT-AI)

**Source of truth:** \`ts.md\` §21.4 and existing Issue #191 / \`EventEnvelope\`, \`EventConsumer\`, \`EventInboxLedger\`. **Branch:** \`feat/p1-406-durable-event-inbox-chat-ai-20261114\` from accepted \`main@8ed66c438d090efd218efa80b027f0b2f854db4b\`. No approval to merge main.

## Scope: actual admission receipts, no producer/subscriber activation

- **New** \`PostgresEventInboxLedger\` implements the existing interface, uses a real PostgreSQL transaction and per-account advisory transaction lock, with a unique \`(account_id,event_id)\` receipt and unique \`(account_id,subject_type,subject_id,revision)\` stream position. All queries are tenant-scoped, independent of the hash advisory lock. Database uniqueness is an additional last defense.
- **New** \`event_inbox_receipts_v1\` has only canonical opaque account/event/subject UUIDs, \`subject_type\`, allowlisted \`event_type\`, \`schema_version\`, positive \`revision\`, integer \`occurred_at_ms\`, canonical SHA-256 metadata fingerprint, \`admission_state\` (\`accepted\`/\`deferred\`), and timestamps. No event payload, filename, GPS, media bytes, ciphertext, Recovery Key, device secret, tokens or authorization capability.
- Existing \`EventConsumer\` must supply trusted authenticated server-side account scope; ledger does not authenticate producer input, establish authorization, accept client claims directly or grant media access.
- Duplicate exact eventId/fingerprint already accepted: **Duplicate**. Same eventId with altered canonical metadata, or a different eventId at the same stream revision: **Conflict**. A missing predecessor at a gap of at most 64 revisions: **Deferred**, persisted. When the predecessor is admitted, the **exact same deferred event must be retried**; only then its receipt transitions to **Accepted**. Invalid or dangerously distant gaps and per-account outstanding deferred count beyond 512: **Quarantined** without persisting dangerous input.
- An **Accepted** event is an inbox ADMISSION receipt, not a subscriber-effect ACK. We intentionally do not advance delivery checkpoints or mark subscriber work done. Durable deferred storage allows a later separately reviewed dispatcher; this branch does **not** ship that dispatcher or guarantee the deadline for resolving gaps.

## Original full contract vs this partial vertical

Existing #191 contract is in current main (historical Draft PR #247 source already inherited), so the new diff contains ONLY five new paths and does not reimport old code or modify shared Event Envelope classes. There is still no API producer/outbox transaction, queue, automatic deferred replay, DLQ/scheduler, poison recovery or new event types (\`MediaCaptured\`, \`MatrixRoomMembershipChanged\`, \`ReleaseVerified\`): **NOT IMPLEMENTED**. No cross-module integration is activated. There is no claim of distributed exactly-once, server-side feature delivery or full §21.4 completion.

## QA gates and safety

1. \`apps/api/tests/Integration/PostgresEventInboxLedgerChatAITest.php\` has hard pre-migration checks for GitHub Actions, fixed disposable database \`pb3_ci_p1_events_406\`, \`APP_ENV=testing\`, localhost PG and dedicated QA flag. This must not execute against a production database.
2. Dedicated \`.github/workflows/p1-event-inbox-ledger-chat-ai.yml\` uses disposable **PostgreSQL 18**, locked patched PHP/Composer, and the named test without the default PHPUnit config (which forces SQLite). Tests use Laravel migrations and DB; no synthetic data store.
3. Negative coverage: cross-account/extra sensitive envelope quarantine; durable replay on a new service object; mutated eventId fingerprint; competing revision; other-tenant separation; out-of-order persisted defer/replay; max 64 gap/512 outstanding pending; genuine separate PDO connections and account advisory lock contention; no private payload row.
4. Existing Foundation/Security/UX/real PG18/Garage/Chromium workflows remain mandatory. Do not pass by disabling, skipping or relaxing unrelated failures. Exact commit SHA and actual outcomes must be added to Issue #406/PR after CI completes.

**Explicit NOT TESTED until evidence:** new dedicated PG18 integration job, full exact-HEAD CI, independent concurrent two-process admission race (two PDO lock contention is not the same as simultaneous event producer effects), real server-origin authenticated event producers, queue/retry worker, source-to-consumer delivery guarantees, physical iOS/Android. No live S3/Matrix/backup/payment touched.

No \`main\`, foreign PR, pre-existing routes, workflows, tests, domain classes, existing migrations, destructive production data, or deployment mutated.
