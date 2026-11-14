# P4 Multi-S3 #346 — isolated BYO endpoint admission after #336

**Date:** 2026-11-14. **Coordinator:** CHAT-T. **Status:** Stage 1 integration proposed, exact-HEAD CI required; NOT a production S3 integration, release authorization or approval to merge.

## Verified ancestry / source
- Accepted patched main before this branch: `8ed66c438d090efd218efa80b027f0b2f854db4b`, Git tree `7f2026e3818cae77712d23433475369606f901b0` (owner-authorized #336).
- Original BYO source: [Draft PR #303](https://github.com/1troitsky/photobunker-v3/pull/303), exact HEAD `dd46ce45fad4101e5b979a97c16e76ff7822c47d`, feature Issue #232; original branch/CLAIM of CHAT-C preserved untouched.
- All nine original source paths verified absent on accepted main and copied here as *exact original Git blob SHAs*. No wholesale cherry-pick/rebase of inherited pre-security commits; all new paths only. Common S3 StorageManager, adapters, Laravel routes, existing CI, shared configuration, other agents' PRs and main unchanged.
- Active coordination: [journal #302](https://github.com/1troitsky/photobunker-v3/issues/302#issuecomment-6874874339), [exclusive integration CLAIM #346](https://github.com/1troitsky/photobunker-v3/issues/346#issuecomment-6874884949).

## Bounded fail-closed behavior (source contract)
- Pure PHP HTTPS origin/port policy, DNS full RR-set check including bounded CNAME chain, exclusion of private/reserved/metadata and mixed unsafe address sets, immutable approved IP pin, connected-peer assertion. The static guard performs **no network requests or credential access**. Tests are offline and may not assert real TLS/SNI or DNS rebinding safety of any eventual transport.
- Dedicated workflow `p4-byo-s3-endpoint-232.yml` runs security-floor PHP 8.4/8.5, syntax, offline SSRF smoke and PHPUnit 12 classes; full application Foundation security and PG18/Garage/Chromium workflows additionally required at the integrated HEAD.
- Do **not** expose public BYO S3 configuration, connect user-provided endpoints, invoke replication, switch placement, failover, purge or enable automatic credentials from this PR. Even after admission, a future transport must pin every connection's actual peer, retain original TLS SNI/certificate hostname, disable redirects, revalidate on reconnection and defend DNS rebinding. Acceptance of this preflight alone is NOT proof.

## Unintegrated prerequisites / gates
- [#319 placement](https://github.com/1troitsky/photobunker-v3/pull/319), [#321 replication](https://github.com/1troitsky/photobunker-v3/pull/321), [#323 read preflight](https://github.com/1troitsky/photobunker-v3/pull/323), [#328 purge fence](https://github.com/1troitsky/photobunker-v3/pull/328): all original, separately owned, partial; remain independent and unmodified. No cross-component compatibility claim.
- True independent two-Garage endpoints, trustful TLS/DNS peer connection, PG18 two-process reconciliation, E2EE SHA/bytes, stale/poisoned replica and tombstone consistency, multi-account ACL, live outage/restart/lost-ACK, quota, device checks and real mobile hardware remain **NOT TESTED** for this combined product. Never promote this one part to completed Multi-S3 acceptance.

## Evidence
- Exact source blob/provenance checked against original PR #303 and main.
- Exact integration HEAD, workflows and concrete PASS/FAIL/BLOCKED evidence to be appended as a GitHub comment on #346 and this Draft PR after actual CI observation. Do not infer from source's historical green runs.

**No main merge, no deploy, no destructive writes, no user S3 secrets or production requests.**
