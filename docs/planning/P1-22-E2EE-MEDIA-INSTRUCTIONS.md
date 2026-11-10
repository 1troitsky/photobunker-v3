# P1-22 — E2EE instructions for photo, video and audio

**Status:** stacked Draft, **not merged** or accepted. Base: P1-21 [PR #39](https://github.com/1troitsky/photobunker-v3/pull/39), exact HEAD `3c499d672ad108ce1c2109c2b7a58e22f20f235b`. The new branch does not update `main`.

## User journey

The owner opens the four-tab Fieldwork editor → **Файлы** and sets separate **photo/video/audio instructions** (up to 2,000 UTF-16 code units each) alongside existing signed media targets. These are *private instructional text*, not public signed policy labels. Saving explicitly queues a P1-19 owner-signed `pb3.assignment-private.v2` revision, with freshly encrypted AES-GCM ciphertext under the existing immutable assignment DEK. The independent `policy` operation still controls which kinds of captures are permitted; instructions alone never grant that capability.

An accepted participant opens the assignment detail and reads decrypted per-type instructions only for allowed media kinds. A warm-offline previously verified assignment snapshot stores the new private content only in the existing per-account AEAD-encrypted summary. Server list/receipt/progress/retention APIs contain only ciphertext and authenticated signed amendment fields.

## Compatibility and trust

- Legacy decrypted assignment content `{version:1,title,instructions}` remains readable, and empty per-kind instructions are rendered for that data.
- The new *encrypted plaintext payload* is version 2 with exact fields and order `{version,title,instructions,photoInstructions,videoInstructions,audioInstructions}`. This does **not** change the P1-19 owner-signed amendment domain or API envelope version: the opaque ciphertext is still signed in `pb3.assignment-private.v2` with the usual previous-hash/CAS/idempotency/IV gates.
- Strict client-side checks reject malformed, unknown or overlong v2 media fields; the old v1 content remains supported. Changing a v2 assignment back to a v1 payload is forbidden to avoid silently discarding private media instructions. Old clients that cannot parse v2 must be upgraded; no downgrade-on-read fallback is allowed.
- A recipient's previously accepted assignment-invite DEK can open the new private content, preserving key continuity. This is **not** a rekey or revocation protocol. Per-file media E2EE access grants remain separate.
- Changing, hiding or removing instructions is not a claim that previously authorized recipients can no longer remember or retain earlier copies.
- Revisions use existing account-scoped encrypted durable outbox; an enqueued item is **not** a server ACK.

## Evidence and gate

New Vitest tests cover v1→v2 compatibility, accepted-recipient decryption with unchanged DEK, tampered AAD/invalid v2 shape/oversized inputs, absence of cleartext instructions from the signed outbox and ciphertext-only cache. Extended existing two-account PostgreSQL 18 / Garage 2.5 / Chromium E2E covers owner saves, recipient detail, same recipient invite, signed revision chain, no plaintext in server contract, and warm-offline encrypted cache.

CI pass must be checked against the **final SHA** on GitHub before reporting this feature as tested. Not covered: native Safari, hardware camera, BYO S3, physical delete, production or owner acceptance. No new deletion authority.
