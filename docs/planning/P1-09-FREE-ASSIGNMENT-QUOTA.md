# P1-09 — server-enforced Free assignment quota

Status: **Draft, CI pending, owner acceptance pending**. Based on the unchanged
[P1-08 PR #24](https://github.com/1troitsky/photobunker-v3/pull/24)
@ `039762d3bec173b767cbb8898bda92d01e413f26`.

## Product/engineering boundary

`ts.md` §8 and §22 are authoritative: Free may create **three assignments
per calendar month**; Free has no per-upload assignment goal cap (photoGoal
is progress only). The single existing `apps/api/config/plans.php`
catalog controls the Free monthly limit and catalog version. **No paid
subscriptions have been implemented or activated** in this vertical. Every
currently enrolled account is still provisionally Free until real signed
subscription entitlements and verified settlement exist. No client may
select a higher plan with a request field.

## Enforcement

- `MonthlyCreationQuota` counts **server-created** assignment records
  with `created_at` within the current UTC calendar month, scoped to the
  authenticated owner. Finished assignments still count. No client
  `startsAt`, device wall clock, deleted filters, client-supplied account
  ID or signed command can change the period.
- Creation checks current usage and inserts under a single
  `identity_accounts` row lock / database transaction (PG18 default READ
  COMMITTED). Same-account concurrent creation is serialized; no oversell
  when two tabs race.
- Replay of the **same successful signed operation** returns the previously
  committed receipt **before** checking quota, even when the month fills,
  and never increments usage twice. Unrelated operationId collisions and
  changed same-ID contracts still fail 409.
- A new assignment over the Free monthly limit gets **403** with stable
  `assignment.monthly_quota_exceeded`, limit and UTC reset boundary. No
  database mutation. Independently, a named Laravel technical limiter uses
  `config/operational_limits.php` (initial 40 requests/minute) keyed to
  the authenticated server-side account, not a shared NAT/IP address.
  Unauthenticated traffic falls back to an IP-keyed limiter. Technical 429
  and plan quota 403 are intentionally distinct; neither bypasses the other.
- A `(owner_account_id,created_at)` index supports bounded quota counting
  without rescanning other accounts.
- `GET /assignments/v1/usage` reports only the authenticated caller's
  `planId`, `catalogVersion`, `periodStart`, `periodEnd`, `limit`,
  `used` and `remaining`. It never returns title, instructions, GPS,
  personal media, Recovery Key, or another account's usage.

## Local-First UI

The Vue assignment screen loads encrypted local drafts immediately, and
fetches quota without holding the shell. With a fresh server answer it shows
`used/limit`, remaining and UTC reset month. Offline or after network
failure it **does not invent a remaining quota**.

The user may create an encrypted draft locally without network admission.
When the server later rejects creation, the outbox operation and locally
encrypted original draft remain durable and visible with a `conflict`
state, rather than being shown as a server-accepted assignment.
Terminal rejection does not delete the draft and is not silently retried
every time the browser gains connectivity. The current signed contract
cannot be assumed to remain valid for a future month without recapturing
an authorized creation timestamp / a separate re-sign action; a future
retry UX will require a dedicated versioned command.

## Gates

- PHP 8.4/8.5 tests: initial Free three remaining, actual three accepted
  month-to-date, fourth rejected with no DB side effects, same signed
  operation ACK after exhaustion, finished assignments still count,
  owner isolation, prior calendar month excluded, catalog values, and
  independent per-account 429 technical limiter even behind a shared IP.
- Frontend: typed validated usage, local-first nonblocking list, no
  plaintext persisted in local draft, conflict visible in Active list.
- Chromium in disposable PostgreSQL18/Garage2.5: complete earlier
  signed-policy/GPS/E2EE flows, then two additional successfully admitted
  Free assignments and a fourth locally encrypted rejected draft.
- Agent QA Round 3 [Issue #25](https://github.com/1troitsky/photobunker-v3/issues/25)
  remains fixed to PR24's SHA and is independent; DO NOT modify that base.

This is NOT a billing, paid entitlement, quota-unit policy, video/audio
or production launch acceptance. No merge, deploy or main mutation.
