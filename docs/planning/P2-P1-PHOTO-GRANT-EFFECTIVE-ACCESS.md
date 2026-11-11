# P2 V-22 — P1 signed effective recipient-grant read ACL

**Status:** Draft / code written / exact-head CI pending. Parent P2 V-21 #117 at `29b2125e9256a7c7720cd10a07d2a33d9a2025fa`; ancestry #116→#115→#114→#113→#111. No main merge/deployment, Matrix work, public grants or physical GC.

## Security boundary / actual gap

P1 `PhotoGrantController::create()` validates the sender's account signature, signed scope and current recipient exchange key at grant **creation**. Its existing `recipientGrant()` reads, object-stream reads and `received()` listing formerly checked only live grant state, expiry, photo state and Fieldwork retention. After grant creation, a **tampered persisted signed contract**, grant identity/scope, stale recipient exchange key or logically archived photo could still pass the *server-side* read check. An independently verifying recipient client would generally detect invalid signatures or fail to decrypt, but this was not an acceptable substitute for an authoritative backend ACL.

P2 `MediaGrantEffectiveAccess` already revalidates signed grant and dynamic ACL during each read. This vertical brings the analogous **fail-closed read barrier** to P1 ciphertext only, without changing the user's intended grant rights.

## Implementation

- New `App\Photo\PhotoGrantEffectiveAccess::requireReadable()` checks active photo/grant TTL; ready sender and recipient accounts; **current** recipient exchange-key descriptor hash; SHA-256 of exact canonical immutable contract; exact v1/v2 signed fields and immutable ID/recipient/expiry bindings; P-256 sender account signature in versioned `pb3.photo-grant.v1/v2` domain; separate v1 personal scope or exact v2 assignment binding; current assignment owner and signed retention when v2; and Browser Archive `archived/deleting` denial.
- All P1 authenticated **grant detail, ciphertext object stream, and received-grant list** call this policy. List scans at most 50 raw rows per page, hides denied rows, and advances by raw scanned cursor to avoid skipping a later valid grant when a revoked/invalid row was filtered.
- No public link, new E2EE recipient, plaintext key, changed DEK, additional physical deletion or implicit assignment consent.
- Existing P1 **personal v1** read permission remains independent of assignment lifecycle; v2 Fieldwork remains scoped and retention-bound. Historical assignment membership change semantics are **not altered** in this narrow security patch; that requires a separate explicit acceptance decision and cross-module count/read alignment.

## Tests

- Existing authenticated P1 grant fixture remains valid with actual P-256 contract signatures and valid registered exchange keys.
- New Laravel regressions mutate the persisted signed contract/hash/signature/recipient digest or recipient key-directory digest only in **disposable tests**, asserting that detail, ciphertext object reads and received list fail closed, then restoring unchanged permission.
- Synthetic impossible archived-source record blocks access even though a real archive mutation already refuses shared photos; restore permits reading again. Fabricated v1→assignment scope denies read. No production data changes.
- Required exact-head gates: PHP 8.4.27+/8.5.12+, Laravel/PG18/Garage, real Chromium P1 two-account end-to-end, strict TS/Vitest, security CI. Physical Safari/iOS/Android and owner acceptance remain NOT TESTED.

The E2EE server remains unable to read the plaintext photo, private metadata, media DEK or GPS.
