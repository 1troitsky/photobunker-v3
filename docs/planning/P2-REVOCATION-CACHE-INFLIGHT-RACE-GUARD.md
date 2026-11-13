# P2 V-28 — close post-revocation in-flight summary-cache and capture proof races

**Status:** Draft / exact-head CI pending. Stacked on #122 `51ee44ba53e0466d91d2029f3ceab93442dc1433` (3/3 PASS). No production/main changes, Matrix, Public Card, new media grants, physical purge, upload deletion or key rotation.

## Reviewed race

V-27 independently verifies the original owner-signed invite and owner-signed revocation, then atomically records an account-scoped immutable removal tombstone and removes old local invitation, authenticated policy and disposable AKEK-encrypted assignment summary. Server enforces removal separately.

The existing `cachePrivateAssignment()` completed potentially slow P-256/AES-GCM steps and then wrote its ciphertext summary without consulting the tombstone. An async task that started **before** the signed removal could therefore **recreate the obsolete private summary AFTER revocation**. `readCachedPrivateAssignment()` similarly could read a stale summary or complete an in-flight decrypt after revocation; `signedCaptureBinding()` checked the tombstone at entry only, allowing a long-running local capture validation to produce a stale signed capture binding despite the revocation being committed during its asynchronous checks.

## Narrow change

1. `cachePrivateAssignment()` does not alter crypto or key hierarchy. After AES-GCM encrypt, perform a **single Dexie rw transaction** over `revocations` and `privateSummaries`; check the recipient/account/assignment tombstone then write the ciphertext. If removal committed first, reject `assignment.member_removed` and never store the summary. If the summary transaction commits first, the removal transaction will then clear it. Both serializations reach the safe final state.
2. `readCachedPrivateAssignment()` checks the revocation record **before** touching old ciphertext and **after** AES-GCM decryption, before returning any former private title/instructions. The last post-decrypt check prevents a completed concurrent signed removal being followed by an application-visible stale private summary. It does not claim remote erasure of historic plaintext already used in another frame.
3. `signedCaptureBinding()` rechecks the tombstone after verification and metadata policy/requirements validation, immediately before returning the locally signed capture-context binding, closing the asynchronous window. The backend continues to reject removed member upload/submit independently.
4. The final Fieldwork Vue `hydrate()` commit independently loads the account's verified tombstone IDs and filters recipient cards **immediately before publishing reactive rows**. This prevents a stale private title that was decrypted in an in-flight task from being rendered after a concurrently verified owner removal; owner-authored tasks are not filtered. An unpinned/forged notice never creates that tombstone.
5. Neither the P1/P2 signed encrypted photo/video/audio media local outbox nor personal photo originals, other account assignment summaries, owner-authored assignments, or pending job queue is deleted. A permanently offline device cannot learn new remote removal until authenticated reconnect and proof confirmation.

## QA

- Expanded fake IndexedDB Vitest: includes verified-only account-scoped tombstone IDs used by the final UI display fence, plus verified real P-256 owner removal refuses a *new* summary cache write/read, refuses a tampered stale raw summary inserted after removal (before decryption); preserves the contributor's queued operation. Unverified/unpinned notice has no power to purge cache or prevent otherwise allowed cache operations.
- Extended existing two-account real Chromium A↔B signed invitation → accepted → owner signed exclusion → independently verified removal → offline test: after offline tombstone, both `cachePrivateAssignment` and `readCachedPrivateAssignment` must return `assignment.member_removed`, in addition to already existing offline signed capture rejection.
- Required exact-head gates: PHP 8.4.27+/8.5.12+, Vue strict TypeScript and Vitest, real PostgreSQL 18/Garage/Chromium, security floor; native iOS/Safari/Android and independent owner acceptance NOT TESTED.

No main merge/deploy or destructive actions. Exact-head PASS may only be claimed from this PR's own current commit.
