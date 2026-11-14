# P3 #229 — privacy-safe telemetry durable ingestion: isolated acceptance (2026-11-14)

## Ownership and ancestry
- Agent: CHAT-I, live journal [START](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6869246542), exclusive [CLAIM](https://github.com/1troitsky/photobunker-v3/issues/229#issuecomment-6869270202).
- Own [Draft PR #317](https://github.com/1troitsky/photobunker-v3/pull/317), branch `feat/p3-229-telemetry-db-20261114`.
- Base is READ-ONLY #297 security patch [Draft #298](https://github.com/1troitsky/photobunker-v3/pull/298) SHA `60407676c7cb9bdb649f5017cf9450aff25eedab`, parent main `6565a0fe852882ea5fc26e493df81affed687eee`. This avoids inherited unpatched Composer CVE; **do not merge #298 or this PR automatically**.
- Product source commit `e6d076b60965725c60f21e432ee1448f665a19b8`; corrected CI-only HEAD before this doc: `cf70cec516ac0f65893b02b7d0123b33f017ce5d`.
- Exactly five new owned implementation/test/CI paths before this doc, no shared routes/auth/Admin/Telemetry contract changed.

## Implemented and VERIFIED narrow slice
- Internal `DatabaseTelemetrySink` implements existing `TelemetrySink` #195 contract (already present in main) for **trusted server-only** `TelemetryRecord`, with an atomic receipt + day/week/month counter + distinct-actor write.
- Per-account HMAC event receipt, SHA-256 fingerprint and per-period HMAC actor tokens; storage omits raw account ID, event ID, event timestamp, file/folder, GPS, IP, message content, key material and arbitrary metadata. Tokens are **pseudonymous, not anonymous**; HMAC secret protection and rotation remain open.
- Duplicate identical event receipt is not counted twice; same-token changed event becomes Conflict. Separate writer processes must not race lost updates. SQL failures throw rather than report success.
- Calendar periods are UTC day, ISO week-year, month. Manual `prune` removes receipt rows only after 8-day retry safety and actor tokens only after full period + 8 days. Caller-supplied clock >5min ahead of wall clock fails closed. Aggregate counters are intentionally retained until owner approves retention policy.
- New migration creates only `telemetry_event_receipts`, `telemetry_counters`, `telemetry_active_tokens`, with composite unique keys. No HTTP ingestion, background job, API metrics endpoint, dashboard or automatic data collection enabled.

## Evidence exact SHA and known failure
- Initial source `57d6dc778c188c5017ffd6c3a23871051e4e4ef8`: real PG18, two independent PHP CLI processes racing same HMAC token: **PASS**, [run 43540432910](https://github.com/1troitsky/photobunker-v3/actions/runs/43540432910). Security and UX PASS.
- `c5bcb7bfb503927db8d0ab3e5a29bf051e8e9015`: new isolated SQLite PHPUnit 3 tests/37 assertions PASS, real PG18 race PASS, security/UX PASS [run 43540533194](https://github.com/1troitsky/photobunker-v3/actions/runs/43540533194).
- Product `e6d076b60965725c60f21e432ee1448f665a19b8`: full-suite workflow **FAIL** in PHP8.4 and PHP8.5 because new CI job injected HTTP/PG environment into the existing app test bootstrap; 156 unrelated 403 responses, while targeted telemetry 3/37 PASS. [run 43540689144](https://github.com/1troitsky/photobunker-v3/actions/runs/43540689144). No foreign tests modified, failure preserved rather than masked.
- Corrected CI workflow-only HEAD `cf70cec516ac0f65893b02b7d0123b33f017ce5d`: [P3 PostgreSQL run 43540812952](https://github.com/1troitsky/photobunker-v3/actions/runs/43540812952) **PASS, 2/2 jobs**:
  - PHP **8.4.27**: targeted TelemetryDatabaseSinkTest **3/3, 37 assertions PASS**; full suite **248/248, 3698 assertions PASS**; true independent two-process PostgreSQL 18 receipt collision/dedup/atomic day-week-month counters **PASS**; Composer Audit **0 advisories**.
  - PHP **8.5.12**: same **3/3 targeted**, **248/248 full**, **3698 assertions**, real PG18 two-process race **PASS**, Composer Audit **0 advisories**.
  - [Security floor run 43540812993](https://github.com/1troitsky/photobunker-v3/actions/runs/43540812993) **PASS** and [UX scope run 43540813050](https://github.com/1troitsky/photobunker-v3/actions/runs/43540813050) **PASS**. Thus **3/3 workflows / 4/4 jobs PASS** for tested code + workflow exact HEAD, before this QA-document-only commit.
- Logged exceptions in full-suite negative Billing tests are intentional test vectors; total PHPUnit process exits PASS.

## Limitations / release gates
**NOT IMPLEMENTED / NOT TESTED:** production service hooks and consent/sampling, durable domain outbox delivery, real admin MFA/RBAC #227, safe export/API and dashboard from real source events, business source reconciliation, automatic retention scheduler, counter TTL / policy, HMAC key rotation, full metrics taxonomy, high-cardinality/outlier bounds, load beyond 2 workers, S3 outage relevance, real phones/iOS/Android, E2EE end-to-end analytics validation. The isolated safe kernel alone **does not complete Issue #229** or P3 and must not be presented as a working dashboard.

## Next safe step
Keep #229 `in-progress`, PR Draft, CLAIM active. On owner continuation: reread #302 and competing PR/claims and then either isolate server-authenticated event-source ingestion with source-level tests (without public HTTP/forged events), or take an independent free Issue if #227/admin dependencies prevent safe progress. **Never merge/deploy/modify main without owner permission.**
