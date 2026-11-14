# P4 integration #369 — Matrix BYO HTTPS admission source #329 on post-#336 main

Date: 2026-11-14 · Agent: CHAT-Y · **INTEGRATION-ONLY / INERT**, not a live Matrix service.

## Immutable provenance and scope

- Accepted base/current main at preflight: `8ed66c438d090efd218efa80b027f0b2f854db4b` (post owner-approved merge #336), verified identical to live main.
- Original source [Draft PR #329](https://github.com/1troitsky/photobunker-v3/pull/329), exact `912e892eb8ffd609d123eee6096591fa59d1eb85`, original CHAT-N #237. Source parent is older patched main; **do not inherit it**.
- Separately checked all 13 original source paths are ABSENT on current accepted main; verified original git-tree file SHA, mode 100644 for all 13; planned integration imports **exact unedited existing Git blobs**, no cherry-pick of old baseline/lock.
- One **new** scoped report: `docs/audits/P4-MATRIX-BYO-INTEGRATION-329-20261114-CHAT-Y.md`. No modifications to existing main paths. Original #329 and its CLAIM remain untouched.
- [Coordination #302](https://github.com/1troitsky/photobunker-v3/issues/302); exclusive [#369 CLAIM](https://github.com/1troitsky/photobunker-v3/issues/369#issuecomment-6875651084). Post-claim journal/issue checked; no other integration conflict.

## Included exact original paths

```text
.github/workflows/p4-matrix-homeserver-237.yml
apps/api/app/Matrix/Byo/HomeserverCapabilities.php
apps/api/app/Matrix/Byo/HomeserverDnsResolver.php
apps/api/app/Matrix/Byo/HomeserverEndpointGuard.php
apps/api/app/Matrix/Byo/HomeserverHttpsTransport.php
apps/api/app/Matrix/Byo/HomeserverPin.php
apps/api/tests/Feature/MatrixByo/HomeserverAdmissionTest.php
apps/api/tests/Feature/MatrixByo/HomeserverDnsResolverTest.php
apps/api/tests/Feature/MatrixByo/HomeserverHttpsTransportTest.php
docs/audits/P4-MATRIX-HOMESERVER-237-20261114-CHAT-N.md
scripts/p4-matrix-byo-237/run-disposable-tls.sh
scripts/p4-matrix-byo-237/tls-client.php
scripts/p4-matrix-byo-237/tls-server.py
```

## Security boundaries (NO automatic activation)

This is a **private internal contract**, not a user-accessible or authenticated API. PHP classes validate HTTPS port 443, public A/AAAA DNS address sets, reject unsafe Matrix origins and peers, use pinned libcurl TLS with original SNI/cert and no redirects/proxies, cap response bytes/time, and validate *typed* Matrix protocol replies and trusted Unlimited+ caller-provided entitlement. Disposable TLS fixture tests run only on ephemeral CI host with loopback-only routing for a test public-form address; never production. No user access token is accepted into the public versions transport.

Critically absent: trusted server entitlement retrieval, authenticated Matrix `whoami` over a separately protected authenticated transport, account-bound credential storage, app routes or UI, Matrix SDK crypto state, actual multi-device E2EE, federation and BYO homeserver lifecycle. Must **not** turn on remote connection, credential submission or access without separate threat review and end-to-end acceptance. No claim about actual network security of arbitrary third-party endpoints from unit/fixture tests.

## Validation protocol on NEW exact integration head

1. Confirm `main..HEAD` ahead/behind, paths and immutable original SHA of all source files via Git API; only 14 ADD paths overall, zero modifications to existing paths.
2. New Draft PR against `main`, exact commit HEAD; inspect dedicated Matrix BYO GitHub workflow (PHP8.4/8.5 full and negative tests, ephemeral real pinned TLS), Foundation PHP+frontend, Security/UX, real PG18/Garage/Chromium on this same HEAD.
3. Preserve all FAIL/pending, do not weaken tests or bypass `composer audit --locked`; release code-review status ONLY when exact head passes required workflows. Do NOT automatically merge.
4. No physical iPhone/Android or real third-party Matrix server was contacted in this integration task; original product #237 and Matrix #212/#238 remain NOT TESTED/BLOCKED for full release.

## Evidence snapshot

Source #329 HEAD `912e892eb8ffd609d123eee6096591fa59d1eb85`: original workflows **5/5 SUCCESS** (source evidence only, **not** new main integration). New branch/PR exact-head runs must be recorded as they complete. Planned current turn: import exact blobs + new report, create Draft PR, then report actual results from GitHub Actions.
