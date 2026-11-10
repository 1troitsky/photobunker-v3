# P1-04 — integration of R2-01 and R2-02 fixes

Status: **Draft; combined CI/independent owner acceptance required**. No main merge or deploy.

## Sources

- Base: PR #18 `p1/04-exact-state-boundaries` @ `bab9a1a450e731e01333ea04d2e3ff424028aafc` (R2-01 server milliseconds, derived from PR #16).
- Camera implementation and tests: PR #19 `fix/p1-camera-session-race` @ `cacfff0911ff6687b1d79d8ae00ceff7aee413b7`.
- The branches are parallel children of PR #16. The camera PR has **no** server/migration changes; the timestamp PR has **no** camera changes.
- Code, tests, camera audit and sanitized evidence from PR #19 copied verbatim to the new integration branch; the original Draft PR #19 remains unchanged. This is a new integration commit chain, **not** a merge into `main`.

## Product behavior

1. Late native `getUserMedia` after online hydration can attach for the *same* account/device/key identity; true identity transitions cancel pending intent, revoke old streams and prevent stale camera results after unmount.
2. Offline v2 capture binds previously owner-signed and independently pinned policy without directory network dependency. It remains encrypted in contributor's durable personal outbox during outages.
3. On server-side owner finish/resume, event `occurred_at_ms` records exact millisecond boundary, avoiding SQL DateTime binding truncation. The authoritative late upload uses historical active intervals and the member's accepted consent; ambiguous **pre-migration** seconds fail closed.
4. Server validates assignment membership and accepted signed policy again when the outbox eventually reserves media. Neither client-side cached state nor signed device clock can grant server rights alone.

## Required combined checks

- TypeScript, 43+ Vitest, PHP 8.4.27 / 8.5.12 security floor and PHPUnit including subsecond R2-01 tests.
- Chromium suite including existing E2EE A→B→A, warm offline lists, assignment finish/resume, camera session race/permission lifecycle and hardware-synthetic photo capture with real PostgreSQL 18 / Garage 2.5.
- Independent Round 2 R2-01 **3/3** real-browser subsecond capture acceptance on this specific integration branch is **NOT YET TESTED**; same for native Safari and physical iOS/Android.
- Trusted signed PWA boot remains BLOCKED BY DESIGN; these changes do not register a Service Worker.

Do not claim release/owner acceptance from CI alone.
