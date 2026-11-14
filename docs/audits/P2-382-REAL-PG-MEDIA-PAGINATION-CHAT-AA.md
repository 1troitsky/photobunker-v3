# P2 / Issue #382 — 10k+ REAL PostgreSQL 18 MediaFile index QA (CHAT-AA)

**Bounded QA only**, 2026-11-14. Base: accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b`. Exclusive new branch `qa/p2-382-real-pg-media-index-chat-aa-20261114`. Outcome **PENDING exact-head CI**, not accepted from source inspection. Draft PR / workflow links are recorded in Issue #382 after creation.

## Why

- Product `ts.md` §12, §21.1, §25.19: tens of thousands of media and bounded cursor pagination without duplicates/skips or account disclosure.
- Existing #194 / #253: 10,051 encrypted **synthetic client** metadata entries in 202 browser pages and a distinct **real** two-page A→B E2EE case (50+1). That does **not** demonstrate 10k **PostgreSQL** rows or all database page boundaries.
- Server `MediaV1Controller::index` uses a raw UUID after cursor and 50+1 bounded keyset queries, scoped by server-authenticated account, active state, server TTL and archive/deleting anti-join.
- Product signed cursor issue #254 explicitly **HOLD / NO CLAIM** pending owner-approved version, TTL, HMAC key-ring/rotation and migration/replay decisions. This QA **does not change, implement or validate MAC signing**; it cannot clear #254.

## Actual isolated test

Exclusive file: `apps/api/tests/Integration/MediaIndexRealPostgres382Test.php`. Dedicated isolated workflow: `.github/workflows/p2-real-media-index-382.yml`.

- Disposable PostgreSQL **18** service `pb3_ci_p2_382`, real Laravel migrations, application HTTP `GET /media/v1` route/controller and per-request session actor. No HTTP mock, no fake server cursor list, no production DB. Test refuses to bootstrap DB unless `GITHUB_ACTIONS=true`, `PB3_PG_INDEX_STRESS=1` and exact disposable test DB/host/environment are present before `RefreshDatabase`.
- Bulk SQL seeds **10,134** actual MediaFile table rows: 10,055 active synthetic owner rows, **77** different-account rows, and 2 intentionally hidden rows (pending / expired). Two owner rows are archived and two deleting. Only **10,051** are initially visible. All seed rows are synthetic **index metadata**, have no valid cryptographic signatures, no actual S3 ciphertext/uploads; index never uses their manifests.
- Traverses every page with genuine Laravel index query, checks each page is at most 50, cursor=last ID if more data, strictly increasing UUID, no duplicate/replay, no skipped eligible ID and no private-like fixture strings in HTTP JSON. Expected dynamic result 10,051 rows across **202 pages**.
- At page 2, a future row becomes expired and another is archived; two future UUIDs are added (must appear later), plus one UUID *behind already visited cursor* (must **not** reappear in forward-only keyset semantics). This is **not a snapshot guarantee**, and is not a true simultaneous multi-process race.
- Switches to independent authenticated account with 77 rows (50+27); asserts neither owner ID nor private fixture leaks. Invalid `after` UUID must fail 422. Reports exact row/page counts and measured elapsed milliseconds in CI; **no invented throughput SLA**.
- Separate default 4 PB3 CI workflows remain mandatory on the same Draft SHA. New isolated PG18 job supplements, not replaces, the existing PG/Garage/Chromium test gate.

## Evidence and strict limits

**PENDING:** recorded separately against the exact immutable code HEAD via GitHub Actions and Issue #382; do not mark PASS until job logs prove counts and no assertion failure.

This does **NOT** prove cryptographically signed cursor (#254 HOLD), production E2EE authenticity of the 10k seeded rows, Garage storage fidelity, browser rendering/10k private decrypt, physical iOS/Android performance, server concurrency under multiple database processes, long-term snapshot consistency, or any release SLA. Those require their own separate acceptance. No production `MediaV1Controller`, `routes/web.php`, shared pagination helper, old QA tests, main, other agents' files or branch modified. No merge/deploy authorized.
