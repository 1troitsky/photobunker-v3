# P2 V-20 — P1 photo_records owner-verifiable contributor consent

**Status:** Draft / code written / exact-head CI required. Parent #115 at `6226bfae7915b34b0c36f9c787362e51df3d6804`, ancestors #114/#113/#111. No merge into `main`, no Matrix work, no public grant or physical cleanup.

## User journey and trust boundary

P1 camera photos remain supported alongside imported P2 MediaFiles. A contributor can capture an encrypted P1 photo, obtain an explicit recipient-specific E2EE grant, and separately sign the P1 assignment submission receipt. The owner used to see only the server-derived submission ID, photo ID, grant ID and contributor ID. **This was not enough for the owner device to cryptographically verify contributor consent independently of the server.** P2 MediaFile receipts gained this check in #113, whereas P1 had not.

This vertical makes the existing signed P1 receipt inspectable, and never claims camera authenticity, hardware-origin, GPS accuracy, verified physical location or a newly approved public scope.

## Implemented

1. Authenticated owner-only `GET /assignments/v1/:id/submissions` now returns the original immutable P1 `contract`, P-256 `signature`, server-stored SHA-256 `contractHash`, and `policyRevision`, in addition to existing IDs. No E2EE private photo, keys, descriptions, tags, category or GPS. The existing 50-row cursor from #115 is preserved.
2. Owner device checks strict exact canonical `pb3.assignment-submit.v1\n` consent with all nine required fields, six UUIDs, assignment identity, contributor identity, photo/grant IDs and signed policy revision. It independently computes SHA-256 of the exact raw contract and compares it to stored contract hash.
3. The owner uses its previously independently fingerprint-confirmed `pinnedPeer` contributor key (same trust mechanism as #113) and checks the actual P-256 signature. An altered grant, different photo/assignment/contributor/revision, forged signature/hash, changed/unpinned peer or unsupported fields **fail closed**. Failed proof is explicitly **not verified** in the owner UI, not presented as a cryptographic confirmation.
4. One directory lookup per contributor per page; every P1 receipt is still checked separately. Initial and subsequent pages are verified, while actual confirmed progress remains server-authoritative and no locally queued evidence is counted.
5. E2E P1 existing two-account photo path checks the visible verified proof plus a forged-grant negative verification, without changing encryption, transfer, user identity, historical receipts or the separate P2 MediaFile path.

## Verification and remaining limits

- PHP regression: the same valid P1 signed submission can be fetched by the owner with its complete original signed contract, signature, SHA-256 and revision; outsider remains 404.
- Real cryptographic Vitest: actual P-256 signed P1 consent and SHA-256; rejects wrong signed scope/asset/revision, noncanonical extra metadata, signature/hash forgery and absence of an independently pinned signer; confirms a per-page single-key fetch with per-receipt verification.
- Chromium E2E: existing real P1 photo capture, E2EE grant, owner fingerprint validation and decryption additionally assert verified consent and forged grant rejection.
- **Exact-head CI NOT YET CLAIMED PASS.** Must confirm PHP 8.4.27+/8.5.12+, PostgreSQL18/Garage/Chromium, strict TypeScript/Vitest and security floor. Native Safari/iOS/Android and independent owner acceptance NOT TESTED.
- Client proof is solely *account-signed assignment submission consent*. Original P1 photo capture metadata remains a separate signed/encrypted artifact; the receipt alone cannot prove a real-world recording event. Server may still report a live submission with unverified signature; UI must distinguish the statuses, never silently remove server-derived progress.

No public tokens, anonymous readers, extra media DEKs, sharing expansion, archive GC or Matrix.
