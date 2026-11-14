# PB3 / P4 #238 — two-Matrix-server read-only metadata preflight

**Agent:** CHAT-Z · 2026-11-14 · **base:** accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b`.

**Verdict:** **PARTIAL IMPLEMENTATION / LIVE FEDERATION NOT TESTED**. This is a bounded regression harness, **not** the full #238 product delivery, E2EE proof, Synapse federation acceptance or proof of user-controlled homeserver activation.

## Scope and ownership

Only four new, independent paths:
- `scripts/matrix-federation/verify.mjs` — read-only optional live smoke with strict inputs and sanitized failures.
- `scripts/matrix-federation/verify.test.mjs` — disposable synthetic API stubs and fail-closed negative cases; no real Matrix server.
- `.github/workflows/p4-matrix-federation-238.yml` — Node 22 tests + explicit no-live assertion; runs on PR to `main`.
- This audit.

The original #237/#329/#369/#370 Matrix BYO HTTPS preflight, all Matrix SDK/crypto state, web UI, main, foreign PR branches, shared configuration and progress table are **untouched**. This stage requires an operator-supplied *existing* encrypted Matrix room event previously created by genuine E2EE clients; it never sends messages or handles plaintext. Current `main` does not yet accept full Matrix PB3 E2EE (#212/#213/#292).

## What an EXPLICIT live smoke would measure

Given two distinct homeserver endpoints and three disposable, separately authenticated Matrix users (A, B, outsider C), first check `/account/whoami` for all three. A and B must have distinct MXID server names and must each see both users joined to an existing room via their independent server's `/joined_members`. Both origins must return an exact matching `m.room.encrypted` event ID and Megolm envelope fields from that room. The authenticated outsider must not appear among joined members and its event GET must be rejected with 403/404 **after successful whoami**; 401 is not counted as an ACL proof. Refuse token redirects, invalid/missing credentials, duplicate identities, HTTP on non-loopback origins, event divergence, unauthenticated/malformed responses.

CLI is **OFF by default**: `node scripts/matrix-federation/verify.mjs` returns code 2 / `NOT TESTED`, no outbound traffic. To opt into a live read-only run, the test operator must explicitly supply the following ephemeral environment variables (never commit them or attach debug traces) and `--live`:

```bash
MATRIX_FED_A_URL=https://matrix-a.example.test
MATRIX_FED_B_URL=https://matrix-b.example.test
MATRIX_FED_OUTSIDER_URL=https://matrix-b.example.test
MATRIX_FED_A_USER=@alice:matrix-a.example.test
MATRIX_FED_B_USER=@bob:matrix-b.example.test
MATRIX_FED_OUTSIDER_USER=@outsider:matrix-b.example.test
MATRIX_FED_ROOM_ID='!existing-room:matrix-a.example.test'
MATRIX_FED_EVENT_ID='$existing-e2ee-event'
# MATRIX_FED_A_TOKEN / MATRIX_FED_B_TOKEN / MATRIX_FED_OUTSIDER_TOKEN must be injected securely
node scripts/matrix-federation/verify.mjs --live
```

Local `http://localhost` / `127.0.0.1` supported solely for disposable Synapse deployments; external origin requires HTTPS. The runner is **read-only**, does not validate SSL pinning independently, does not provision Synapse and does not infer cryptographic provenance from server-reported JSON.

## Evidence status

| Gate | Status | Required next |
| --- | --- | --- |
| Config validation / safe network defaults / no credentials in result | NEW UNIT CONTRACT; CI to verify at PR HEAD | Verify Node 22 test run and exact commit |
| A/B whoami, both membership views, matching encrypted event, outsider 403/404 | SYNTHETIC CONTRACT ONLY | Actual two independent disposable Synapse installations and pre-existing SDK-authored event |
| Real two-server federation delivery and decrypt | **NOT TESTED** | Genuine E2EE SDK clients verify decrypted plaintext + cross-device signatures independent of server |
| E2EE voice/media attachments, key-only Recovery 4S | **BLOCKED / NOT TESTED** | Full #212/#213 acceptance, actual grants/revokes/key sharing |
| Token revoke, malicious homeserver / outage / retry, Matrix isolation from Camera/Browser | **NOT TESTED** | Real service stop/start, signed revocation, full PWA app scenario |
| Physical iOS/Android, Unlimited+ BYO + tariff activation | **NOT TESTED** | Owner-approved production model and hardware acceptance |

**Security note:** Matching `m.room.encrypted` events on two servers demonstrates only read-only **server-reported encrypted-event agreement** under authenticated sessions. It does *not* prove actual E2EE encryption, decryption or trusted-device membership; an untrusted server can fabricate response JSON. Full #238 remains OPEN and must not be marked `review` or merged for release solely from this preflight. No production data or credentials are required for the synthetic job.

**Workflow evidence:** add actual exact-HEAD CI run URLs and test counts in #238 Issue/PR comments after GitHub Actions reports completion. Do not silently conflate no-run / pending with PASS.
