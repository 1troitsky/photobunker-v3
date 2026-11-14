# PB3 #358 — Post-navigation identity bootstrap QA (CHAT-V, 2026-11-14)

## Baseline, provenance, and scope

- Exclusive [Issue #358](https://github.com/1troitsky/photobunker-v3/issues/358), [CLAIM](https://github.com/1troitsky/photobunker-v3/issues/358#issuecomment-6875052582), [journal #302](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6875029139).
- Accepted immutable parent `main@8ed66c438d090efd218efa80b027f0b2f854db4b` after owner-authorized #336.
- Original untouched [Notifications Draft #353](https://github.com/1troitsky/photobunker-v3/pull/353) `88ddcccd0f73a7b219c08df49ea132f193447961`: real PG18/Garage/Chromium [workflow 43577629553 attempt 1](https://github.com/1troitsky/photobunker-v3/actions/runs/43577629553/attempts/1), job `132395248207`, **91/93**, two unmodified cross-feature E2E failures. Same HEAD [attempt 2](https://github.com/1troitsky/photobunker-v3/actions/runs/43577629553/attempts/2), **93/93 PASS** without source edits. This cannot be explained by Notifications code alone and does not prove the flakes benign.
- Errors in attempt 1: `assignment.offline` at `p2-browser-av-assignments-premerge-20261114.spec.ts:71` (server list immediately after signed mixed-creation operation); `identity.account_locked` at `p2-browser-video-clip-ui-215.spec.ts:27` (enqueue immediately after hard navigation). The original failure traces are preserved in the existing workflow artifact; no retries or sanitizing edits to source test assertions.
- Branch: `qa/p2-358-session-race-chat-v-20261114`; two existing P2 E2E files plus **one NEW** focused fail-closed E2E and **this NEW** audit only. No code under `apps/`, shared Playwright config, workflow or main changed.

## Mechanism verified from source (not a claim of reproduced root cause)

`apps/web/src/main.ts` mounts the Vue app and routes at line 16; it starts `void resumeExistingDevice()` at line 21. `session.ts` verifies and decrypts a saved local device asynchronously, sets `Session.online=false` in local-first mode, and only promotes that exact session to online after a REAL signed `/identity/v2/challenges` + `/identity/v2/proof` exchange. `requireSession()` throws `identity.account_locked` before a local device is restored; `listServerAssignments()` correctly throws `assignment.offline` until proof. The two original tests used `page.goto` without awaiting this second independent asynchronous lifecycle. DOM navigation completion is **not** identity proof completion.

This is a concrete unsafe test assumption consistent with both observed error sites; exact Chromium trace-level causal replay and cold-repeat CI are still required before calling the incident fully closed. Do not replace legitimate local-first states with an online fiction.

## QA-only remedy

- At each problematic hard navigation, wait for **actual** `activeSession.value.online===true`, matching the previously registered account ID **and device ID**; wrong-account/device state fails explicitly rather than being accepted. Bounded Playwright polling observes the real state, does not trigger extra logins, fake responses, sleep, resend encrypted media, lower assertions or turn on retries.
- New negative E2E creates a genuine key/account, then **aborts** only the real login-challenge request on reload; it verifies local encrypted device remains `online=false`, server-authoritative Assignment list remains denied (`assignment.offline`), and recovery to `online=true` is possible only after unblocking the route and completing actual signed `reauthenticate()`. It also confirms `identity.account_locked` with no account.
- A blocked challenge is a network-fault injection, **not a mocked proof/receipt**. Revoked device / explicit server revocation is NOT TESTED by this isolated patch.

## Verification matrix

| Gate | Status | Evidence |
|---|---|---|
| Source attribution of original two CI failures | PASS (logs) | 43577629553 attempt 1 / job 132395248207 |
| Same-HEAD clean rerun in original PR | PASS (historical) | 43577629553 attempt 2, 93/93 |
| New branch exact-HEAD Foundation/TS/Vitest/Composer | PENDING | Capture after new Draft PR CI |
| New branch PG18/Garage/Chromium (including negative case) | PENDING | Capture after new Draft PR CI |
| Three independent cold CI repeats | NOT TESTED | Not implied by one green rerun |
| Real physical iOS Safari / Android PWA | NOT TESTED | Requires devices |
| Real revoked-device end-to-end denial | NOT TESTED | Separate security acceptance |
| Merge to main/deploy | NOT REQUESTED | Explicit owner authorization required |

## Release gate

The new test only makes genuine security bootstrap readiness explicit to automation; it does NOT fix a production session bug by itself. Any remaining exact-HEAD failure, or evidence of a real misordered automatic login, must be investigated separately without relaxing fail-closed authentication.
