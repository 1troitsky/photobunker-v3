# P1 QA #311 — Identity Recovery deterministic ciphertext tamper acceptance · 2026-11-14

**Owned by:** CHAT-F · [Issue #311](https://github.com/1troitsky/photobunker-v3/issues/311), exact [CLAIM #6867404188](https://github.com/1troitsky/photobunker-v3/issues/311#issuecomment-6867404188), [coordinated START #302](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6867394335).

## Evidence, provenance and security question

- Current remote `main` at start: `6565a0fe852882ea5fc26e493df81affed687eee`; **unchanged**.
- Immutable read-only security #297 Draft PR #298 parent HEAD: `60407676c7cb9bdb649f5017cf9450aff25eedab`; own branch `qa/p1-311-identity-ciphertext-tamper-20261114` stacks on that branch because raw main's Composer lock contains the known Laravel advisory. No edits/cherry-picks into foreign #298 or main.
- First observed source FAIL: on #226 [run 43525442010](https://github.com/1troitsky/photobunker-v3/actions/runs/43525442010), HEAD `9ddb9aa171e12dc57fc84a1ab16169a9a4faac8b`, frontend **480/481, one unexpected resolution** at unchanged `crypto.test.ts:46`. The same exact head [43525451177](https://github.com/1troitsky/photobunker-v3/actions/runs/43525451177) passed **481/481**. This does **NOT** prove AES-GCM authentication bypass.
- Existing negative test constructed altered envelope via `env.ciphertext.slice(0,-2)+'AA'`; depending on existing random Base64URL suffix it can produce identical text, identical decoded bytes, or only change unused trailing padding bits. A passing `openRecovery` is therefore possible without any actual ciphertext corruption. [Issue #309](https://github.com/1troitsky/photobunker-v3/issues/309) documents analogous Folder Sync mutation with **another file**; issue #311 remains exclusive to Identity test.

## Owned diff and safety constraints

1. NARROW modification of `apps/web/src/features/identity/infrastructure/crypto.test.ts` **only** for Identity v2 negative tests. No weakening/removal of existing tamper/version/AAD/signature assertions. Decode canonical ciphertext using production `unb64`, copy bytes, flip exactly one bit of a known decoded byte, assert bytes **changed**, encode with production `b64` and assert canonical round-trip. Apply to AES-GCM ciphertext and IV tests.
2. Add direct **256 independently sealed recovery envelopes** with random distinct IVs, demonstrate genuine unmodified opening and modified AES-GCM ciphertext rejection on every envelope. Test actual wrong recovery key (same locator, different secret), AAD revision, nonce, ECDSA message tamper.
3. NEW narrow `.github/workflows/p1-identity-crypto-311.yml`: own PR-base scoped **full frontend Vitest/typecheck/build**, plus eight independent focused re-runs (256 fresh independently sealed randomized envelopes each), PHP 8.4/8.5 locked dependency audit/full PHPUnit, disposable real PG18 Identity test. Standard main-only Foundation and Storage E2E workflows do not fire on a security-branch stack; the own workflow MUST be evaluated on its exact HEAD.
4. THIS report `docs/audits/P1-IDENTITY-CRYPTO-TAMPER-311-20261114.md`.

All changes are test/QA evidence/isolated CI. **No edits** to production `crypto.ts`, PIN/Identity session, Folder Sync #309, other agents' files, payment, database migration, frontend runtime, S3, PWA, main, deploy or merges.

## Acceptance evidence (pending new CI)

- CI SHA: to be recorded after all workflow jobs complete.
- Identity tamper: real non-identical byte stream after corruption, canonical Base64URL, AES-256-GCM authenticated decrypt negative on each new random envelope. Verify no surprise successful decryption; if any occurs, STOP, mark FAIL and escalate as genuine security issue instead of making the test less strict.
- Full TypeScript + Vite build and all Vitest: **NOT YET TESTED** for new branch.
- PHP 8.4/8.5 full PHPUnit/Composer Audit and real PG18 Identity: **NOT YET TESTED**.
- Browser Chromium on real device, iOS Safari, Android PWA, end-to-end account recovery over HTTP, full physical-device / production security independent audit: **NOT TESTED** and not implied by tests.
- Do NOT claim production cryptographic acceptance from only a green test suite. No merge approval requested.

## Handoff state

- ISSUE: `in-progress` while checks are pending. Final state must use exact HEAD, run IDs and PASS/FAIL/NOT TESTED, and preserve original FAIL.
