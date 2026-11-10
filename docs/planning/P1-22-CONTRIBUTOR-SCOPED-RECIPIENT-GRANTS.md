# P1-22 — Contributor-signed assignment-scoped E2EE recipient grants

**Status:** [Stacked Draft PR #45](https://github.com/1troitsky/photobunker-v3/pull/45), based on the tested P1-21 [Draft PR #39](https://github.com/1troitsky/photobunker-v3/pull/39) at `3c499d672ad108ce1c2109c2b7a58e22f20f235b`. Not merged, not deployed, not owner accepted.

## Problem and safety boundary

P1-21 introduced signed association deadlines without deleting contributor-owned photo/video/audio. Old **independent signed v1 personal E2EE grants** can remain valid after a Fieldwork assignment closes, because the contributor owns the original and separately authorized the recipient. Revoking the old personal grant based solely on an assignment owner policy would breach contributor consent.

For **new Fieldwork submissions**, the contributor can issue a **signed v2 grant explicitly bound to one assignment**. After assignment file/association expiry, new grant reads are denied at the API, independent of the owner's personal v1 grants, the maintenance scheduler, and user-reported clocks. The contributor's original E2EE asset and its other recipients remain untouched.

## Protocol and admission

- Photo domain: `pb3.photo-grant.v2\n`. Media domain: `pb3.media-grant.v2\n`. The exact existing v1 personal domain, object fields, ECDH context, AES-GCM and read semantics remain untouched.
- **New v2 fields:** `version=2`, `assignmentId`, plus each already-accepted signed grant's original immutable identity, asset/chunk bindings, recipient key digest, scope `read`, expiry and encrypted DEK envelope(s). Exact canonical JSON key ordering is validated by PHP; no unsigned fields or arbitrary URL/object names.
- The recipient's exchanged ECDH key wraps the uploader-owned per-asset DEK using **new versioned AAD** `pb3.recipient-dek.v2\n` (photos) or `pb3.media-recipient-dek.v2\n` (video/audio) that includes the assignment ID. One grant cannot be copied into a different Fieldwork and still pass the owner-signed context.
- Assignment must exist and be active; actual assignment owner must match the E2EE **recipient**, actual contributor must be an **accepted contributor** in the same assignment. Server checks *current* signed schedule admission and independent P1-21 retention deadlines under a locked assignment row.
- New v2 grant expiry is clamped to original asset TTL, one-day E2EE grant ceiling, and whichever of the authenticated signed `filesAccessUntil` / `assignmentAccessUntil` arrives first. The server independently checks all constraints, not just the client projection.
- At each physical read or grant detail request, server checks grant recipient, original owner and asset TTL, plus referenced assignment's effective deadlines, **regardless of scheduler**. Expired scoped grants disappear from `/received`. A scope deliberately bound to a deleted/unavailable assignment never falls back to a personal v1 ACL.
- New photo/video/audio Fieldwork UI submissions always issue v2 grants. Separate personal Share UI still issues v1 (no invisible retrospective restriction). The assignment submission routes refuse a v2 grant signed for **a different assignment**, even if it has the same owner account. Existing v1 submissions remain valid until their existing grant TTL or independent owner revocation.
- No new S3 API, object deletion, owner key custody, server plaintext or new backend E2EE scope. The P1-21 logical tombstone ledger remains independent.

## Verification gates and limitations

- PHPUnit: actual synthetic ciphertext/grant/read for both photo and media: valid signed v2 before cutoff, denied after cutoff, no deletion of uploader originals or state, independent signed personal v1 continues; unaccepted contributor, wrong domain signature, wrong assignment owner, expiry beyond policy and wrong-assignment submission denied.
- Vitest: exact optional assignment field for signed media v2, malformed IDs/extra fields rejected, v1 cannot silently acquire assignment scope. Existing ECDH, AEAD and media receipt regressions remain green.
- Chromium + PostgreSQL18/Garage2.5: accepted two-account Fieldwork contributor submits photo, video and audio using v2 assignment scopes and actual recipient decrypts through new v2 ECDH context; assertion checks signed `assignmentId` and `version=2` for each.
- **No physical deletion**: v2 access expiry is not evidence that the recipient erased previously downloaded plaintext; it is not a remote key wipe. Pre-existing personal v1 grants are intentionally independent and may still authorize a read. The contributor owns originals and grants; the Fieldwork owner cannot force a third-party S3 DELETE.
- **OPEN**: actual per-asset contributor-authorized deletion contract, consent/revocation and versioned provider-specific all-location S3 GC with proof of absence. That is a separate high-risk destructive phase with independent audit/feature gates.
- Native Safari, physical devices and external security audit: NOT TESTED. This Draft PR cannot be called production-ready solely by green CI.

## Related documents

- [P1-21 retention](P1-21-SIGNED-ASSIGNMENT-RETENTION.md)
- [Current module readiness map](../status/CURRENT.md)

Do not create a new `docs/status/history` report on every intermediate PR: archive one report only at the completion of this major grant/access block.
