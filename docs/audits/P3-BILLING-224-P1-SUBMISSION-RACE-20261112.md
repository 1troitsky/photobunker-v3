# P3 #224 — независимый разбор Chromium P1-13 / Identity bootstrap race

**Дата:** 2026-11-12 · **Изолированная ветка:** `p3/billing-versioned-entitlement-224`.
**Product+UX parent:** PR #187 `7a309508cc140897ae6dd75f8d473a89c7296be2`; `main`, PR #265/#266 не менялись.

## Источники и сохранённые исходные отказы

- [GitHub Actions run 43221689388, attempt 1 and 2](https://github.com/1troitsky/photobunker-v3/actions/runs/43221689388), SHA `528bd27ec2d8000c2ed567558bf57f6d756260b1`.
- **Attempt 1:** 59 PASS / 1 FAIL, `tests/e2e/p1-assignment-media.spec.ts:514`. Три требуемые `media-submit` операции: две с настоящим HTTP 201 `/assignments/v1/{id}/media-submissions`; третья вообще не отправила запрос.
- **Attempt 2:** 59 PASS / 1 FAIL, `tests/e2e/p1-assignment-media.spec.ts:253`. После клика фото-отправки не появилось ни одного `POST /assignments/v1/{id}/submissions`.
- Скачаны и вручную разобраны оба реально сохранённых Playwright ZIP trace: artifact IDs `13944663784` (attempt 1, SHA-256 `4f567c2df02138c98a2dd63d1d5f9c0737a73a0e7ec995d2e1654eed4830b131`) и `13946995645` (attempt 2, SHA-256 `88f3170970c5e84041e1edcb58bd341438c28dbb65abcfc4d32a111919b8192f`).
- **Trace auth interleaving:** attempt 2 B click `Отправить в задание` at Playwright monotonic **11484 ms**, authenticated `identity/v2/challenges` request started **11321 ms** and `identity/v2/proof` request started **11535 ms**. The clicked operation overlaps real trusted-device proof from page navigation. Attempt 1 also reauthenticates during rapid B navigation/next submit (proof at 19859 ms preceding media click at 19947 ms).
- No `GET/POST billing/v1` requests in either trace. No changed Billing path imports or hooks into P1 assignment/media. `P1-13` was inherited unchanged from parent; all 10 original #224 code changes are server-side new Billing/Plan code, one `routes/web.php` registration and tests/docs.

## Root cause and security policy

**Existing product lifecycle race, not Billing regression or mere random test timeout.** Rapid user click can happen while `resumeExistingDevice()` is proving the same PB3 device (`/challenges` → `/proof`) and replacing `activeSession` with a new `online:true` object. The E2EE submission preflights intentionally check `activeSession.value !== session` **after every async read and before any DEK grant**; this correctly rejects a moving identity, but a legitimate same-device refresh can strand a click before a durable signed outbox operation is created. Merely retrying the Playwright assertion, or bypassing the E2EE identity fence, would conceal or weaken the defect.

## Minimal product correction

The affected user flows are `AssignmentsView.vue::submit(photo)` and `::submitMedia(media)`, sharing new `awaitStableSubmissionSession()`:
1. Capture the actual active account/device/public-key/revision identity boundary.
2. **When online**, await the already in-flight `reauthenticate()` which itself waits `pendingSessionResume`; reject a real account/device/AKEK revision change. Do not fabricate proof or change server grants.
3. After proof, await fresh server-backed `refresh()` so a stale pre-bootstrap card cannot become write authority. If session identity changed again during refresh, fail closed.
4. Existing `preflightAssignmentPhotoGrant`/`preflightAssignmentMediaGrant`, signed owner policy, scope/time/retention/ACL, P-256, AES-GCM, explicit personal-media consent and independent server ACK checks are **unchanged**.
5. **Offline** keeps the existing signed, cached-policy Local-First path (no network reauth is forced). No assertions, test timeouts, retries or security expectations changed.

This fix is specifically an Identity/UI initialization fence; it does **not** make revoked devices valid, allow paid plan bypass, or make Matrix/Storage changes.

## Acceptance protocol

- Run exact new HEAD Foundation PHP 8.4/8.5 + full Vitest/TS build, Security, UX guard and disposable PostgreSQL18/Garage/Chromium.
- Preserve BOTH historical FAIL runs. Review full Chromium P1-13 end-to-end: photo/grant receipt plus three distinct E2EE media submissions, not a mocked transport.
- Only mark #224 `review` after **4/4 PASS on the exact final commit**.
- Deferred Billing boundaries: #192/#200/#203 paid atomic quota admission, #225 trusted payment, #227/#228 audited grants, OPEN GB-vs-GiB, no production paid activation from browser.

**Raw traces deliberately NOT committed**: they may contain account/device identifiers and runtime payloads. Keep original short-retention GitHub artifacts as source evidence.
