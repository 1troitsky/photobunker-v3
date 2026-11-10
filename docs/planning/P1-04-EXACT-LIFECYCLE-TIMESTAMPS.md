# R2-01 — exact server millisecond event boundaries

Status: **product fix in Draft PR, latest CI and independent QA recheck required**.
Input: [QA Round 2](https://github.com/1troitsky/photobunker-v3/pull/17), defect R2-01.

## Bug

Laravel formats bound DateTime values as whole-second `Y-m-d H:i:s`.
The v2 photo contract has signed `capturedAt` in milliseconds, while
`assignment_state_events_v1.created_at` lost its fractional second.
A legitimate capture at `14:28:48.100` preceding owner finish at
`14:28:48.750` appeared later than the persisted `14:28:48.000`
and was refused with 409. Device ciphertext was retained.

## Protocol and migration

- Migration `2026_11_09_000006_add_exact_assignment_event_time.php`
  adds a nullable, integer `occurred_at_ms`, leaving existing signed owner
  contracts and readable historical `created_at` unchanged.
- Every new signed `finish`/`resume` writes the server-generated millisecond
  timestamp in the **same transaction** as the state revision and append-only
  event. `created_at` is derived from that same instant, even if the DB
  converts it to whole seconds.
- Photo reservation compares the signed device time claim against exact
  `occurred_at_ms` boundaries. A claimed photo **strictly before** finish
  can sync after finish as private ciphertext; photos in finished intervals
  remain invalid, and submission still requires an active assignment.
- Existing rows with `occurred_at_ms=NULL` are genuinely ambiguous within
  the stored `created_at` second. Within this second the API **fails closed
  with 409** rather than inventing a millisecond boundary or allowing
  potentially post-finish capture. Earlier whole seconds still work.
  An administrator must not invent historic event precision.
- Each exact timestamp is checked against the `created_at` UTC second to
  detect corrupted/mismatched state. Event revision order and state
  alternation remain enforced.
- Existing `capturedAt` is still an untrusted device-clock claim; this fix
  only prevents *server-side truncation* of a real owner event. It does not
  provide hardware attestation, cross-device clock synchronization or
  prevent a malicious enrolled device from lying about capture time.
- No plaintext JPEG, description or GPS is stored by the server.

## Verification

- PHPUnit tests freeze a subsecond server clock (XX.750), store a finish,
  verify exact integer timestamp and replay, allow v2 capture at XX.450,
  reject same/after-finish capture, and verify old second-only history
  fails closed within the ambiguous second.
- Existing feature/E2E signed owner lifecycle and full PostgreSQL 18 / Garage
  CI must pass on latest head.
- Independent QA Round 2 repro is still required on the resulting branch
  with millisecond evidence and a 3/3 repeat threshold; the product fix alone
  does **not** close QA or hardware acceptance.

No merge to main; Draft only.
