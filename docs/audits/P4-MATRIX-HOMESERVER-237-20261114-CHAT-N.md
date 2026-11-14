# P4 #237 — BYO Matrix homeserver admission (CHAT-N)

**Status: PARTIAL / INTERNAL ONLY.** No active homeserver binding, network handshake, production entitlement check, token storage, E2EE, federation or customer-facing route.

**Clean base**: owner-authorized security-patched main 5aaba8b0509c354f8abb00806180f4ce6cb6ad18.
**Coordination**: exclusive #237 CLAIM, common journal #302. Old operator-config-only signed Matrix binding PR #68, Messages Beta #292 and S3 BYO SSRF guard #303 are read-only; their branches and main were not edited.

## Implemented in six new exclusive paths

1. HomeserverEndpointGuard: HTTPS port 443 FQDN origin only, no credentials/path/query/fragment/localhost/IP literals; fail closed if ANY proposed A/AAAA DNS answer is private, reserved, metadata, CGNAT or invalid. All input records must be a complete trusted DNS RRset. This class makes no network call.
2. HomeserverPin: canonical approved IP snapshot and exact connected-peer assertion. A future transport MUST actually connect to a pinned IP, verify the peer, and perform hostname/SNI certificate verification, with redirects disabled and re-resolution before subsequent connections. Unpinned client fetches bypass this guard.
3. HomeserverCapabilities: typed validation of authenticated Matrix Client-Server /versions, /capabilities (stable room version) and /whoami (exact account/device, non-guest). Requires a fresh server-trusted unlimited_plus entitlement identifier, never a browser-supplied plan value. Does not itself query the entitlement ledger or prove reply authenticity.
4. PHPUnit positive/negative security cases for URLs, DNS, peers, plan eligibility, user/device/guest binding, versions and capabilities. Scoped GitHub Actions on PHP 8.4/8.5 with required runtime floor, composer audit and focused tests.

Reference protocol: https://spec.matrix.org/latest/client-server-api/.

## Remaining release gates (BLOCKED / NOT TESTED)

- Real DNS CNAME chain completeness and bounded resolver, pinned HTTPS transport/TLS/redirect/peer checks, remote malicious homeserver tests. **No live SSRF guarantee** until these are integrated.
- Signed PB3 account/device bind and TOCTOU recheck, server-authenticated mutable entitlement snapshot and downgrade, token isolation/revoke, local encrypted crypto store, idempotency, API, UI, rollback tests.
- Real Matrix whoami and capabilities requests, two-homeserver federation, cross-device E2EE, room membership, key backup, Panic and Recovery 4S, iOS/Android network/device acceptance.
- Per-owner decision on BYO homeserver vs managed hosting remains as required in ts.md. Old PR #68 supports fixed operator configuration only and is not itself BYO.

The dedicated PR and full Issue #237 are NOT release-ready from this isolated slice. Exact SHA and CI links are recorded in #237 / the PR after verification.
