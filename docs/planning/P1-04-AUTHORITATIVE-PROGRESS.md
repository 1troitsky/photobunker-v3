# P1-04 — authoritative photo progress (Draft PR, stacked)

Status: **IMPLEMENTED IN DRAFT; LATEST CI AND OWNER ACCEPTANCE REQUIRED**.
Base: `p1/04-signed-state-transitions` (Draft PR #14). Parallel local QA has a separate branch and is not merged.

## Source of truth

A signed assignment creation policy can optionally contain a photo target `photoGoal=1…9999`. This is **progress only** and never a file/quota limit.

The authorized `GET /assignments/v1` response carries the *derived, unsigned* `confirmedPhotoCount`, computed by a correlated SQL count of signed assignment submissions whose owner-visible receipt is currently eligible:

- contribution refers to an `active` contributor-owned, non-expired `photo_records` row;
- grant is `active`, not expired, refers to that photo and is explicitly addressed to that assignment owner;
- contributor account is identical in photo, submission and grant;
- assignment is included in the caller's authorized owner/accepted-participant listing.

It is **not** derived by counting the first 50 `/submissions` results; photo goals can be up to 9999 and uploads can exceed goals. This does not inspect or decrypt ciphertext.

A revoked or expired grant removes the submission from the **currently authorized** count. It does not retroactively erase a previously delivered local copy. `confirmedPhotoCount` is a server-derived UI metric, **not an owner-root-signed policy field or permission to read/decrypt media**.

## UI interpretation

- For a goal: show actual confirmed receipts `N / goal` and progress percentage `min(N,goal)/goal*100`. If `N > goal`, display actual N and cap the bar at 100%; goal never blocks capture or upload.
- For no goal: show confirmed N, with no artificial overall percentage.
- Local encrypted captures and queued/retry signed submissions are counted **separately** as waiting; they are not presented as server-confirmed results.
- Before the first authenticated server listing, show “ожидает подтверждения”, not a fabricated `0`.
- Top counters “Всего / Активных / Готово” are derived from locally visible assignments and current authenticated server states; “Готово” reflects the separately signed `finished` lifecycle state, not achievement of a photo goal.
- An offline account may not have the current count. Do not treat stale cached counts as fresh receipts.

## Acceptance

- PHPUnit confirms real count=1 after receipt, count=0 after grant revocation, >50 counts independently of paginated listing, expiry and outsider isolation.
- WebCrypto test ensures derived count is a safe nonnegative integer, not part of signed capture policy.
- Chromium E2E creates goal=30, B submits encrypted photo with an explicit E2EE grant, and A sees confirmed `1 / 30`.
- Native Safari, physical iOS camera, final Fieldwork 5.0 progress cards, individual review decisions, historical count at review time and multi-media progress remain later acceptance gates.

This is a small, functional photo-only vertical; it does not claim the full approved Assignments 5.0 editor/UI.
