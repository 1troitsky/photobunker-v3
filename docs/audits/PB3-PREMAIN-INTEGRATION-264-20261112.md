# PB3 pre-main integration #264 — source and safety audit

Date: **2026-11-12**. This is a **working integration candidate**, not a release acceptance or permission to merge `main`.

## Baseline and ancestry

- Repository: `1troitsky/photobunker-v3`.
- Production `main` was `da7327b8c9c440dae3dc864b3245b9f9f4ad14eb` when this work started; do not change it.
- Primary P2 verified root: [PR #187](https://github.com/1troitsky/photobunker-v3/pull/187) `7a309508cc140897ae6dd75f8d473a89c7296be2` (V54 Product+UX+QA; includes #185, #162, #160, #158 ancestry).
- New integrated baseline: V55 [#207](https://github.com/1troitsky/photobunker-v3/pull/207) `6899df3e8f3f206a51ee5d8460ab883a2b5a94ad` → latest leaf [#248](https://github.com/1troitsky/photobunker-v3/pull/248) `f4c8ebdfae54d9c526133a723d2f2fbb0edc7d45`. GitHub compare #187→#248: **ahead 22, behind 0**. No duplicated cherry-picks of historical ancestor PRs.
- This integration branch is **linear on #248**, not on `main`. It copies source Git **blob SHA** exactly; no editorial change to source tests or product code in the first assembly.

## Selected exact-source inputs

The following **16 PRs** were reviewed for changed-path collisions against #248 and each other. Each was copied through Git tree blob references, preserving source file contents exactly (55 added/replaced file paths across the source PRs, before this report).

| PR | Exact source SHA | Scope included |
|---|---|---|
| [#263](https://github.com/1troitsky/photobunker-v3/pull/263) | `e79b438d5f08ed85ba15c7289d94a0423795c54d` | GPS atomic consent, unchanged negative QA #258 |
| [#252](https://github.com/1troitsky/photobunker-v3/pull/252) | `a3bd912e783c09af6720c40f91b3a55a1df06812` | Dock mobile QA |
| [#253](https://github.com/1troitsky/photobunker-v3/pull/253) | `21ac289c56a809378fa954a1218ae43bf2a7520d` | Browser large-account QA 10k+ |
| [#255](https://github.com/1troitsky/photobunker-v3/pull/255) | `760bf02a5c0d48dcc486782ee3346168047cac5a` | Real media Lost ACK and corrupt ciphertext QA |
| [#256](https://github.com/1troitsky/photobunker-v3/pull/256) | `bbd683339fa1699bc1178487a38077d0402e554c` | Recovered device E2EE QA |
| [#257](https://github.com/1troitsky/photobunker-v3/pull/257) | `2c089dd1cf04f189d0a169523ec2a8a4f00b6452` | Cross-account E2EE grant/revoke QA |
| [#259](https://github.com/1troitsky/photobunker-v3/pull/259) | `b33ecc734f6c3fc5d8df96b4a58177bffd3bad1f` | Real disposable Garage outage + CI gate |
| [#251](https://github.com/1troitsky/photobunker-v3/pull/251) | `c11a77e48d2ac3bef1f403cf11d4c455d415b157` | S3/storage contract QA |
| [#250](https://github.com/1troitsky/photobunker-v3/pull/250) | `778a1faf2cb9fb0f259c6517ce01b1456f3641b0` | Unsigned release integrity verifier, NOT signed PWA |
| [#249](https://github.com/1troitsky/photobunker-v3/pull/249) | `54e940d51ecd26e579073d73e4583d1f34f9cc26` | Privacy telemetry contract classes/tests only |
| [#247](https://github.com/1troitsky/photobunker-v3/pull/247) | `972585c5b60d727a3b297a6b81a8e91936a633b5` | Metadata-only domain event classes/tests only |
| [#246](https://github.com/1troitsky/photobunker-v3/pull/246) | `a3b835d3e079ddccf204fb6fab0e762d249b07cd` | Backup atomic admission class/migration, NOT full backup |
| [#245](https://github.com/1troitsky/photobunker-v3/pull/245) | `84cddbc8d16ef56a752bc22f0efa18ffcad029b7` | Help center UI components, NOT routed product |
| [#188](https://github.com/1troitsky/photobunker-v3/pull/188) | `e2baa0893909cd69a3a5e592efd6c49379abf3a5` | Admin RBAC/MFA/audit foundation only |
| [#186](https://github.com/1troitsky/photobunker-v3/pull/186) | `1ea8e18f2cf37b834c7b76391e2a8be4d549bb74` | Local encrypted notifications model only |
| [#184](https://github.com/1troitsky/photobunker-v3/pull/184) | `3e56dc8759fa1c07eccd3661a6971c7b45116a45` | Coordination Kanban docs |

The manifest is **source provenance**, not a claim that a domain flow is live. In particular, isolated classes/modules `#186`, `#188`, `#245`, `#246`, `#247`, `#249`, `#250` are **not equivalent to completed end-to-end UI/API operations**.

## Non-conflict proof

- Enumerated **all 171 open PRs** across six GitHub API pages before integration, inspected branch ancestry, and obtained changed-file paths for the selected 16 PRs.
- #248 changes the V55 browser/editor files; **none** of the selected PRs writes those same paths.
- Selected PR path sets are pairwise disjoint (no overlapping file paths). The only shared existing file replaced relative to #187 is the storage CI workflow from #259; #248 did not modify it.
- The original negative GPS E2E from QA [#258](https://github.com/1troitsky/photobunker-v3/pull/258) is **byte-for-byte identical** (blob SHA `da38a7f35ead05fab71f27fa7b4000bc836fc722`) in selected GPS fix #263, with additional consent race E2E.
- **Decision for this candidate:** use #263 instead of competing [#262](https://github.com/1troitsky/photobunker-v3/pull/262). Both alter `CaptureView.vue` and `CaptureView.test.ts`; applying both file blobs would silently discard one implementation. #263 additionally checks consent at atomic AES-GCM/IndexedDB persistence. Keep #262's separate evidence and unit tests for independent security diff review; **do not automatically mark it merged/superseded**.
- #261 is Matrix on a different ancestry chain and excluded.

## Not imported (deliberate)

| Source | Status / reason |
|---|---|
| #262 GPS competing fix | OVERLAPPING product `CaptureView.vue/test.ts` with selected #263; independent security reconciliation needed |
| #258 GPS QA | Exactly the same negative E2E is already included via selected #263; importing separately would duplicate, not strengthen acceptance |
| #207 V55 preview | Already an ancestor of base #248 |
| #187/#185 and older V54+UX | Already ancestors of #248 |
| #261 Matrix and #64–#81 Matrix ancestry | Separate cryptographic root; independent signed-device/room/SAS/4S/Panic acceptance required; no blind overlay |
| Remaining backlog/blocked features (#192/#193/#200/#202/#203/#209/#210/#215/#218/#220/#224/#240/#254 etc.) | No accepted product implementation to integrate; existing Issues remain open |
| #183 final release to main | Explicit owner approval/independent acceptance required; **blocked** |

## Integration CI gate

**PENDING** at the moment this document was written; do not call PASS until GitHub Actions runs against the exact integration HEAD:

1. PHP 8.4 and PHP 8.5, Laravel routes, migrations/tests, TypeScript build, Vitest.
2. Security floor, UX scope/integrity lane, no test disable/allowlist.
3. Disposable PostgreSQL 18 + Garage 2.5 smoke and **real Garage stop/start** gate from #259.
4. Full unmodified Chromium E2E including **#258 GPS revoked negative**, #263 racing consent, #253 10k+ Browser test, #255 lost ACK/corrupt ciphertext, #256 recovery device and #257 grant revocation.
5. Any source PR CI PASS is **not** evidence of a PASS on the integrated head. Preserve failures, report exact failing test and SHA, fix only a verified integration defect.

## Deferred independent local agent acceptance (safe handoff)

When a local agent is available, it should:
- Fetch **this integration PR's exact current HEAD**, not a guessed local `main`, and read `AGENTS.md`, `ts.md`, this report and original #258/263 evidence.
- Re-run development / persistent PostgreSQL+Garage startup, account A→B E2EE decrypt, recovery on a distinct device, camera GPS permission revoke during capture and during JPEG/MediaOutbox AES-GCM storage, and native physical iOS Safari/Android PWA if devices are available.
- Independently assess the competing #262/#263 security strategies and race contracts, including how `navigator.permissions` behaves where unsupported; do **not** weaken the negative QA #258 or invent physical test results.
- Run the Matrix-specific scenarios **only on the separate Matrix branch and known local Synapse**; don't assert Matrix acceptance from this PR.
- Report PASS/FAIL/BLOCKED with exact device/browser versions, source/head SHAs and artifacts in `docs/audits/**`, preferably as a **QA-only Draft PR**, no merge.
- If local resources/credentials/devices are absent, mark the subcase **NOT TESTED**. No destructive wipe or production operations.

## Release boundary

- This is a **Draft pre-main integration candidate**, not a product release.
- No source PR is auto-closed, no branch force-updated outside this integration head, no production DB/S3 touched.
- Do not claim the four PB3 phases are complete: PIN/Panic, Recovery Vault, entitlement/billing, Matrix and BYO S3 remain independent release dependencies.
