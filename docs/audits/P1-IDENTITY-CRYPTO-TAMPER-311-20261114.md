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

## Exact-head acceptance evidence — code SHA `c05256fa02409e1c2ce5552e7e32ccd447af73c8`

- **Exact code/test/workflow SHA:** `c05256fa02409e1c2ce5552e7e32ccd447af73c8`. [CI 43526888071](https://github.com/1troitsky/photobunker-v3/actions/runs/43526888071) **4/4 jobs PASS**, [independent CI 43526896000](https://github.com/1troitsky/photobunker-v3/actions/runs/43526896000) **4/4 jobs PASS**. Both runs compile and test the same exact code SHA.
- **Frontend TypeScript / Vite build:** PASS. Full **451/451 Vitest** (83 files) PASS. Focused **8/8 independent extra Identity cryptographic suite repetitions PASS** per full CI run. Each repetition includes **256 fresh AES-GCM recovery encryptions with unique random IVs**, canonical decoded-byte XOR, successful original open, and rejected changed ciphertext: at least 2,048 separately sealed envelopes per CI run, at least **4,096** across the two independent full runs (beyond the full-suite copies). The explicitly added wrong Recovery Key material, wrong account ID, IV mutation, revision AAD mutation and ECDSA message + signature-byte negatives PASS. The code does not skip, mock or downgrade WebCrypto verification.
- **PHP 8.4.27+ and PHP 8.5.12+:** full locked Composer validate+audit PASS, full PHPUnit **245/245 tests / 3,661 assertions on each version** PASS.
- **Real disposable PostgreSQL 18:** migrations and `IdentityV2Test.php` **4/4 tests / 34 assertions PASS** (PHPUnit explicitly bypasses root phpunit.xml SQLite override, exercising actual PG18).
- [Security 43526895964](https://github.com/1troitsky/photobunker-v3/actions/runs/43526895964) **PASS**, [UX scope 43526896064](https://github.com/1troitsky/photobunker-v3/actions/runs/43526896064) **PASS** on the exact code SHA.
- **Prior original intermittent failure remains preserved:** [43525442010](https://github.com/1troitsky/photobunker-v3/actions/runs/43525442010) Vitest 480/481 FAIL, identical SHA [43525451177](https://github.com/1troitsky/photobunker-v3/actions/runs/43525451177) 481/481 PASS. The old Base64URL suffix corruption was nondeterministic; a real decoded byte XOR now never accidentally becomes a no-op. No evidence of AES-GCM bypass in the confirmed tests.
- **NOT TESTED:** real browser Chromium/iOS Safari/Android hardware, full 2-device E2EE over remote Garage, independent formal crypto audit, real deployment. Native/device and production readiness cannot be inferred from Node WebCrypto/PG18 results. The existing P0 Foundation/Storage workflows only auto-trigger for their configured bases; the new scoped CI is explicit and narrower than full storage end-to-end.
- **Result:** #311 *QA test reliability slice verified*. Reviewer can accept these checks for review; not permission to merge, nor evidence of production-grade end-to-end E2EE acceptance.

## Handoff state

- ISSUE: candidate `review` after exact-head independent checks; hold for owner review, no merge or main mutation. Preserve old FAIL and separate #309 Folder Sync scope.
