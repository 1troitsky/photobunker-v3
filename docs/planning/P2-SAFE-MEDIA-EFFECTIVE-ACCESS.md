# P2 Safe / Original — effective account-to-account E2EE access

**Status:** Draft implementation, not a public access product. Parent #106 introduced cryptographically source-bound recipient-only `safe_read`. This increment unifies live server-side access decisions for the recipient's list, signed manifest and every ciphertext chunk.

## Actual intersection (server-side)

`effective = authenticated recipient ∩ ready owner ∩ ready recipient ∩ currently pinned recipient ECDH directory ∩ immutable owner-signed grant contract and exact scope ∩ media ownership/binding ∩ BOTH MediaFile state/hash/TTL ∩ archive policy ∩ assignment association when present ∩ current server clock`.

- Grant scopes remain exactly `read` for historical independent v1 and signed assignment v2, or `safe_read` for v3 bound to **separate** source and derived JPEGs. No `original` / `public` / `download` / `edit` scopes are introduced. A v3 key envelope wraps only the derivative MediaFile DEK; source ciphertext chunks are not routable through v3 grant IDs.
- Every received-list entry runs the **same** guard used for the per-grant manifest and each physical ciphertext chunk. If owner/recipient account is not ready, recipient ECDH descriptor changes, source/derived media expires/is deleted/archived, signed hashes change, scope/id/schema binding changes or the grant is revoked, list hides the entry and reads fail closed. The list cursor advances using the **raw scanned** grant ID even if revoked rows are filtered, avoiding unintended skip of later valid rows.
- v2 assignment-scoped grants additionally require the signed assignment file-access cutoff to still permit reads, original contributor membership still accepted, and assignment owner still the exact recipient. They do **not** blindly inherit rights from merely being a team/contact. Assignment finish/schedule end does **not** prematurely delete or revoke still-valid retained file access: `AssignmentSchedule` governs admission, while signed `AssignmentRetention` governs later file access. Independently signed personal v1 grants remain separate from assignment revocation.
- Full source `read` grant is an **independent owner action**. A v3 Safe grant does not automatically revoke older v1 original grants or previously downloaded plaintext/ciphertext. UI warns clearly when the owner chooses to give the full original DEK rather than the Safe copy.
- Revalidate the immutable canonical owner-signed grant JSON + recorded SHA-256 + live owner account SPKI at each read. Database column tampering must not silently redirect source/derived IDs, key digest, grant version, expiry or scope.

## Exclusions / explicit OPEN gates

The user's `ts.md` §18 specifies eventual **`assignment ∩ file ∩ public grant ∩ time/TTL ∩ media scope`** for anonymous Public Card, including explicit allowed metadata/download fields. That is **NOT yet implemented**: no finalized signed per-file public policy, anonymous bearer token/key delivery, public download permission model or Public Card enabling exists. Do not substitute authenticated recipient grant intersection for **public** ACL; public remains OFF until its OPEN cryptographic and authorization design is decided and audited.

Server cannot verify that every sensitive pixel was masked without seeing plaintext; actual safe image preparation and owner inspection remain local. Source and derivative share **no DEK**. Existing original recipients cannot be made to forget their previously obtained DEK. Native Safari/iOS/Android and the complete Photo Editor 3.2 have not been accepted; physical GC remains OFF; Matrix stays PAUSED.

## Evidence and release criteria

- PHP features: one valid v3 source+derivative; each denied state tested across **listing + manifest + chunk**: owner retired, recipient exchange directory rotated, source/derived MediaFile mismatch, archive both sides, signed grant metadata corruption, revoked contributor membership and changed assignment owner, personal v1 grant unaffected.
- Existing Chromium/PostgreSQL18/Garage owner→recipient E2EE scenario must still prove `safe_read` decrypts the real blacked-out JPEG but cannot fetch original media or its chunks. Revoke means subsequent server reads 410; existing local recipient copy cannot be recalled.
- **Exact-head CI required**: PHPUnit on PHP 8.4 and 8.5, strict TS/build + Vitest, real Chromium/PG18/Garage, security floor. No code merge/deploy/owner acceptance implied by Draft CI.
