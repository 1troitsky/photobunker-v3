# PB3 Matrix — M-04A bounded pre-send membership recheck

**Product baseline:** Draft PR #81 exact `5f13992b94b90157a38d25b3fe27543e3e8642f1` (not the QA-only #133); **independent re-acceptance:** [QA #133](https://github.com/1troitsky/photobunker-v3/pull/133) exact `0aa993e3944e02d7c87908cca8a4573cc61a9ea0`.

## Why this patch exists

The independent local-agent result confirms **M-02** same-root/AKEK signed recovery-key rotation, Matrix4S escrow and true Lost ACK; **M-03B** own-device real Synapse logout (same bearer 401); other-device PB3 isolation and stock Vite routing. It does **not** certify M-01 full PB3 A↔B SAS/QR production Messenger or M-04 adversarial ACL/key sharing. Matrix must remain outside `main` and Send UI stays disabled until that separate acceptance.

An adversarial event can change joined or invited members **after** the existing `matrix-text-outbox.ts::preflight` read but **before** the awaited SDK send/resend operation. The original source only reads authoritative joined members and `roomState()` once prior to returning from preflight. This is a time-of-check-to-time-of-use interval, even though the SDK already enforces `OnlySignedDevicesIsolationMode`.

## Narrow change (M-04A, not the whole M-04 gate)

- Extract the existing room-membership policy into `verifyFreshPrivateRoom()`. It checks encrypted Megolm room, local current membership, fresh server joined list, pending invites, invite-only join policy and non-world-readable history. No new plaintext, tokens or persisted state.
- Preserve the original full PB3 root/device binding and independently approved Matrix Ed25519/cross-signing checks, then **independently re-read the same authoritative membership immediately before each new send or SDK NOT_SENT replay**, requiring the originally verified own MXID and held exclusive crypto lease.
- For an existing SDK `SENT` echo, no new SDK encryption/send occurs, so only the original full preflight applies before verifying the actual raw server `m.room.encrypted` receipt.
- A failed second check keeps the durable AES-GCM outbox item **queued**, never fabricates `server_accepted`, never skips an older ambiguous operation and never regenerates its Matrix transaction ID.

## Deterministic adversarial tests

Four additional Vitest scenarios inject a **server state change between the first and second real production guard invocations**:
1. Third participant joins after initial trust check: no `sendMessage`.
2. Third participant is **invited** after the first `roomState()`, though joined-only list stays at two: no `sendMessage`.
3. Remote second `roomState()` read fails: keep encrypted item queued; no `sendMessage`.
4. Same race with existing `NOT_SENT` SDK local echo: no `resendEvent`, no new `sendMessage`, original txnId remains queued.

Existing positive real-transport integration job remains enabled; no Matrix server ACL, identity, crypto or UI settings weakened.

## What is **NOT** solved

**This is NOT an atomic Matrix room permission/key-sharing transaction.** An adversary can still update room membership after the final HTTP poll but before the SDK encrypts/sends a Megolm room key. SDK isolation mode protects against unsigned devices, not a newly joined cross-signed but unauthorized member. The separate M-04 gate must verify full concurrent room membership, device cross-signing/key-sharing and PB3 ACL revision races against a **real disposable Synapse** with adversarial concurrency and inspect who actually receives the room key. Until then, do **not** claim race-free send or enable Messages UI Send.

M-01 (full PB3 account/device/Contact approval→Matrix SAS/QR→private room→E2EE send/receive/backfill/reload), M-03 cross-device remote bearer revoke/Panic, historical Megolm decrypt under account recovery, physical iOS/Android, and integration with Product+UX #187 are all separately unaccepted.

## Branch boundaries

Only `apps/web/src/features/messages/application/matrix-text-outbox.ts`, its unit test, and this documentation change. **Draft PR** stacked on #81; no `main`, no #187, no other parallel lanes, no destructive operations or PWA feature enablement. Unit assertions are adversarial fixtures, not independent real-Synapse race acceptance. Record **exact HEAD CI** before marking the narrow M-04A patch reviewed.
