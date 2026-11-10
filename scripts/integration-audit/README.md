# Independent PR46 integration audit

Product: detached `2c1406586dd819357bd3fcc933985f616ce72d39`.
Migration baseline: detached `f13ad76929916ecfbb2ef0d5fd7a5a284f680e02`.
Security source: `3a5f5cf1d5f96c5e903e0099261081919b3236e1`.

Fetch fresh PR heads and compare with the task before starting. Install the
unchanged locked dependencies in the product and QA checkout (`pnpm install
--frozen-lockfile`). Node22+, pnpm10.20.0, Python3.9+, Docker/Compose and existing
Chromium are needed. Ports 8000/5173/4173 must be free; other services are never
stopped to make room. This audit intentionally does not rerun complete CI.

```sh
python3 -B scripts/integration-audit/analyze.py
python3 -B scripts/integration-audit/run.py \
  --source-root /ABSOLUTE/DETACHED/PR46 \
  --baseline-root /ABSOLUTE/DETACHED/PR44
```

`analyze.py` reconstructs the complete PR45 patch on PR44 in a disposable plain
file tree, verifies byte equality to the integration, preserves the newer
status page, checks migration names/content and the fetched Draft dependency
graph. It never applies patches to the product or its Git index.

The runner reuses the exact maintained PR17 QA isolation harness (`run.py`,
`compose.yml`, `Dockerfile`, `test_isolation.py`) copied into this QA branch.
No QA commits enter product history. Baseline setup creates **real signed v1
photo/video/audio grants** against the old PR44 API. The only API changes then
applied to the **private runtime copy** are the reviewed integration delta;
`migrate --force` upgrades its disposable PostgreSQL. Before/after row hashes,
nullable legacy scopes and unchanged ciphertext locations are compared, and
recipient/contributor decrypts are repeated with the same private browser profiles.

New tests then cover actual scoped A→B→A ECDH/AES-GCM, Contacts selection and
private instructions, offline/reload, committed-but-lost grant and submission
ACKs, same-owner sibling attacks, pending membership, fingerprint/domain/signature
and AAD tampering, identity change/recovery, real-clock grant/admission/retention
expiry, direct object/chunk authorization, personal v1 independence and no-delete
rights. MediaRecorder uses Chromium fake hardware; no native-device claim.

A diagnosed harness problem may be corrected and only the affected journey
rechecked in a **new isolated fixture**:

```sh
python3 -B scripts/integration-audit/run.py \
  --source-root /ABSOLUTE/DETACHED/PR46 \
  --baseline-root /ABSOLUTE/DETACHED/PR44 --focused-journey
```

Do not run this in an unlimited loop: stop after two diagnosed failures of the
same cause. The recorded audit uses at most three focused attempts for three
different harness problems; all original failures remain in evidence. It does
not repeat successful migration, adversarial or expiry suites. Each invocation
has a unique project/credentials/tmpfs storage and cleans up only its own
containers/processes. No prune, real-data deletion, SW activation or key rotation.

Private artifacts are printed as `$TMPDIR/pb3-acceptance-*`. They include profile
keys, synthetic images and raw logs and must **never be published**. Export only
allowlisted metadata, using the actual QA source commit for that invocation:

```sh
python3 -B scripts/integration-audit/export.py /PRIVATE/RUN FULL_QA_SOURCE_SHA
```

The reviewed report and evidence live in `docs/audits/`; scenarios not executed
or blocked by native hardware/trusted bootstrap must remain explicitly marked.
