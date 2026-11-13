# P2 QA #309 — deterministic Folder Sync ciphertext tamper · 2026-11-14

**Owner:** CHAT-F · [Issue #309](https://github.com/1troitsky/photobunker-v3/issues/309) · [exclusive CLAIM #6867554759](https://github.com/1troitsky/photobunker-v3/issues/309#issuecomment-6867554759) · [coordination START #6867550050](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6867550050).

## Original defect evidence and bounds

- Exact code evidence from Issue #309: original [Foundation CI 43522314912](https://github.com/1troitsky/photobunker-v3/actions/runs/43522314912) at `85d12905a55e678edfc0548845ce3c837f608401` had one FAIL in `apps/web/src/features/browser/application/folder-sync-crypto.test.ts`, test `rejects altered ciphertext, revision rollback and forged signature`; same SHA targeted frontend rerun [job 132220100537](https://github.com/1troitsky/photobunker-v3/actions/jobs/132220100537) 517/517 Vitest PASS without product changes.
- Old test used `corrupt.envelope.ciphertext.slice(0,-2)+'AA'`. If last bytes already match (or only unused Base64URL tail bits differ), the mutation may become a **decoded ciphertext no-op**. This produces nondeterministic negative-test results, **not evidence of a real cryptographic bypass**. Analogous separate Identity issue #311 was independently verified and [Draft PR #312](https://github.com/1troitsky/photobunker-v3/pull/312) remains in review, but the work and test filenames are distinct.
- Current remote `main` at start `6565a0fe852882ea5fc26e493df81affed687eee`, unchanged. Own branch `qa/p2-309-folder-sync-ciphertext-tamper-20261114` stacks on **read-only** patched security #297 [Draft #298](https://github.com/1troitsky/photobunker-v3/pull/298) commit `60407676c7cb9bdb649f5017cf9450aff25eedab`; no edits/merge into #298 or main.

## Implementation — test-only, no production crypto modification

- NARROW MOD `apps/web/src/features/browser/application/folder-sync-crypto.test.ts`: test-only canonical decoder of full-size Base64URL ciphertext (Folder Sync supports >8KiB), XOR exactly one concrete decoded byte, assert byte inequality and canonical round-trip using existing production b64; never rely on textual suffix.
- In real end-to-end module call to `verifyAndOpenFolderSync`, the **original signature on a modified canonical contract must fail** `browser.sync_signature_invalid`. With **fresh valid ECDSA signature produced by the actual account private key over the altered contract**, signature validation succeeds and AES-GCM **must separately reject modified ciphertext** with `browser.sync_key_or_cipher_unavailable`. Both independent gates are checked rather than accepting a generic failure that could stop before AEAD.
- Repeat **128 distinct newly minted account packages / signing keys / UUID operations / independent AES-GCM folder snapshots**, verify normal read by second separately identified device sharing its account package, then both tamper gates. Assert unique IVs and operations. Existing revision rollback, wrong AKEK, forged signature, oversized encrypted snapshots and canonical parsing tests remain.
- NEW scoped `.github/workflows/p2-folder-sync-tamper-309.yml`: independent PR-base frontend full TypeScript/Vite/Vitest, **eight extra focused runs** (>=1024 new snapshots per CI execution) and patched PHP8.4/8.5 locked Composer Audit/full PHPUnit, disposable PostgreSQL18 Browser Folder Sync backend acceptance. Does not edit shared/main-targeted workflows.
- THIS report `docs/audits/P2-FOLDER-SYNC-TAMPER-309-20261114.md`. Own PR diff must contain **exactly these three paths**.

## Validation (pending)

- Current code SHA: to record after CI; **NOT YET TESTED** until exact GitHub Actions finish. Do not claim pass prematurely.
- PASS requires all freshly re-signed tampered ciphertext to reject *after* valid signature verification; any successful authenticated decryption is **FAIL / P0 escalation** and cannot be concealed by skips.
- Full TypeScript/Vitest/build, PHP8.4/8.5/composer audit, real PG18: **NOT YET TESTED**.
- Real Garage + Chromium end-to-end, physical iOS Safari and Android PWA, production key handling and independent cryptographic audit: **NOT TESTED** in this isolated test-only branch. It remains necessary for full production acceptance.
- No changes to `folder-sync-crypto.ts`, `crypto.ts`, Identity PIN #220, Camera #206, Public Card #211, main, foreign PRs, database, E2EE secrets or deployments. Never merge without owner approval.
