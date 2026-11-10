# P1-24 — AEAD-protected assignment instructions while capturing

**Status:** standalone stacked Draft over P1-23 PR #41, base SHA `2635055ac6d72d6cd200a950efb73079cc466853`. Nothing merged or deployed. Accepted Fieldwork Editor UX is a guide; this slice adds functional private in-camera assistance, **not** a new signed authorization protocol.

## Real workflow

1. The owner edits confidential photo/video/audio instructions in the P1-22 Fieldwork **Файлы** tab. They become versioned E2EE ciphertext under the immutable root assignment DEK, in the independently owner-signed append-only private history.
2. A participant independently confirms owner's key, accepts the invitation, opens the assignment detail online; client verifies the signed private revision and securely caches its decrypted summary **as account-AKEK-encrypted ciphertext** in IndexedDB. The cache is cryptographically scoped to the *exact* signed private amendment contract.
3. On **Camera** with that assignment selected, the client first independently verifies the locally signed assignment policy and accesses the existing account-bound AEAD summary. Only after successful decryption does it display general instructions and the **selected capture kind's instructions** (photo, video, audio). Switching kinds updates the text; disallowed types have no per-kind instructions and capture remains disabled.
4. If a summary is not present for that exact signed revision, invalid/tampered, or inaccessible for that account, **do not** show older/plaintext instructions or fabricate success. Show a clear link-free message to open the assignment detail to verify and decrypt content. Camera and signed capture may otherwise operate based on the independently verified public policy; inaccessible instructional text does not silently relax capture-policy obligations.
5. Account/device/key changes, assignment switching, unmounts and in-flight async failures clear volatile instruction state. No new plaintext persistent storage, S3 key, server endpoint, admin access, implicit share, or media grant.

## Security boundaries

- Versioned P1-22 E2EE plaintext stays opaque on the server. The P1-19 signed private amendment must already have passed owner signature, continuity and rollback checks before a cached summary is trusted.
- The camera reads only warm, already-verified, **AEAD-encrypted** account cache; it does not claim to fetch/decrypt every newly received assignment in camera by itself. The user can explicitly open the assignment to refresh the verified encrypted summary. Cold offline bootstrap remains unsupported.
- Displayed private text can be seen by the currently authorized device user. No claim of forward secrecy, actual key revocation, fresh server authorization while offline, anti-screenshot protection, or device trust attestation.
- Camera signed capture intents and server enforcement are unchanged. Instruction text is guidance, **not** a signed required form field or file-content authority.

## Acceptance and evidence

- Chromium on disposable PostgreSQL18/Garage2.5 with two accounts: actual owner private edit → accepted participant private read/cache → fresh camera route → PHOTO specific instruction, VIDEO only video instruction, AUDIO only audio; no cross-kind display.
- Existing negative E2EE tests: invalid version/tag/binding, missing or changed private signed revision returns no cached data; stale account cache doesn't cross accounts; owner signed policy still checked for camera capture.
- PHP8.4 and 8.5, TypeScript, Vitest, build and security CI must pass on exact current PR SHA.
- **OPEN:** if an account has no warm encrypted summary, camera deliberately displays unavailability rather than silently fetching a potentially untrusted E2EE envelope; full offline cold bootstrap/physical iPhone/Android/Safari not tested. Key reissuance, per-file permissions, multi-S3 deletion, owner acceptance and main merge not included.
