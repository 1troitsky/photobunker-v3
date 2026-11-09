# Safe offline bootstrap — Round 2 proposal

Status: **BLOCKED BY DESIGN** for implementation under the current ordinary-web
delivery model. This is a technical proposal, not an implemented or verified
trust system. No Service Worker was registered or enabled by QA.

## Three different cases

| Case | Current mechanism | Observed / required result |
| --- | --- | --- |
| Vite development | Network HTML, `/@vite/client`, `/src/main.ts`, development module graph | Fresh Chromium: no controller, no registrations, no CacheStorage entries; offline document reload fails |
| Production build served by preview | Network HTML plus fingerprinted bundle, CSS and manifest | Same absence of worker/cache; offline document reload also fails. A generated `sw.js` on disk is not a registered/controlling worker |
| Installed PWA with a future signed SW | Not implemented or installed in this audit | **BLOCKED BY DESIGN / NOT TESTED on hardware**. Installation/display-mode alone does not establish an independent verifier or cache guarantees |

Both observed cases ran in secure localhost contexts. Consequently the failure
is not caused by the absence of HTTPS support in the probe. The application has
`injectRegister:false`, no explicit registration in `main.ts`, no active fetch
handler and no verified shell cache. IndexedDB ciphertext is independent of
loading the HTML/JS needed to read it. Ordinary HTTP cache behavior is not a
reliable offline bootstrap contract.

A worker controls document/resource loading through its lifecycle and fetch
handling; a cached executable file is insufficient by itself. See the
[W3C Service Workers specification](https://www.w3.org/TR/service-workers/).

## Required security boundary

`ts.md §24/24.1` and ADR-0001 require an independent trust anchor. A signing key
embedded only in mutable same-origin JS can be replaced together with the
verifier. HTML-provided hashes/signatures cannot prove that this first HTML is
trusted. SRI checks bytes against supplied integrity metadata; it does not
independently authenticate the page supplying that metadata. See
[W3C Subresource Integrity](https://www.w3.org/TR/sri/).

There is another boundary to solve: the browser's normal SW update algorithm
fetches and runs a candidate worker. A trusted *old* application worker is not
an independent browser-level signature gate for every replacement worker. A
malicious candidate can omit the proposed verifier. **Inference from the SW
update/execution model:** checking a downloaded worker in mutable page JS and
then calling ordinary `register()` is not sufficient protection against a fully
malicious origin, including future browser-driven updates.

The owner must select and approve an enforceable delivery anchor, for example
an independently signed native shell or a managed, independently distributed
browser extension whose trusted package controls all executable content and its
updates. A separately downloaded verifier is useful only if its result actually
controls the executed bytes and persists across later updates. An informational
"verified" screen or first-install-only check does not meet that requirement.

This QA change cannot choose, install, distribute or secure that anchor on the
owner's behalf. Until the anchor and its update/recovery policy are accepted,
keep ordinary-origin SW activation off and retain **BLOCKED BY DESIGN**.

## Proposed protocol after that decision

These are proposed requirements to implement and attack-test, not existing
product behavior:

1. **Trusted initial loader.** Distribute the verifier, pinned root public key,
   signature algorithm/version and minimum accepted verifier version through
   the independent anchor. No remote HTML/JS executes before its trust decision.
   The anchor also governs SW/native/extension loader replacement; it must not
   leave a parallel ordinary-origin update path able to bypass verification.
2. **Signed release manifest.** Canonical, versioned metadata binds app/product
   identity, release sequence, verifier floor, key ID, schema compatibility and
   every executable/transitive dependency: HTML, modules/dynamic imports,
   workers/SW, WASM, CSS and security-relevant assets. Bind normalized URLs,
   permitted origin(s), bytes, digest and MIME. Reject duplicate/ambiguous paths,
   unexpected redirects, opaque/unverifiable responses, mixed content, unknown
   assets and cross-release module mixtures.
3. **Isolated signing.** Keep the private release key outside hosting/CDN/S3 and
   the application runtime. Separate build and signing authorization; audit
   signed manifests and dependency provenance. A compromised signing authority
   remains a different threat; define root recovery and key rotation before
   release rather than silently trusting a new key from the compromised origin.
4. **Quarantine before execution.** The trusted loader fetches a candidate into
   a per-release staging cache. Verify the signature and every byte digest/size
   before any candidate script runs. Network success or the presence of a file
   is not verification. A normal web-only `register()` path must not be used to
   claim this gate where the browser can independently execute an unchecked SW.
5. **Atomic publication.** Commit a verified-release descriptor only after the
   complete dependency closure is present. Coordinate tabs/loader instances;
   keep them on a coherent release until a controlled activation boundary.
   Never promote partial downloads or perform speculative application data
   migrations from quarantined code.
6. **Offline shell.** Serve navigations and assets solely from the selected
   verified release. Recheck content against its authenticated descriptor at
   the trusted boundary, including reads after restart/corruption. Cache shell
   and ciphertext separately; never put Recovery Keys, raw DEKs or decrypted
   media into application-shell caches. Offline session UI must say local mode;
   it cannot assert fresh server ACL, revocation or membership status.
7. **Version/replay policy.** Maintain a highest authenticated release sequence
   in storage controlled by the anchor, bound to the application identity.
   Reject signed-but-stale release offers and same-sequence equivocation. Define
   reinstall/reset and clock rollback semantics. Local browser storage alone
   cannot prove a global high-water mark after the user clears all site data.
   Offline signature revocation/freshness cannot be learned from an absent
   server; acceptable offline lease/freshness policy is an owner decision.
8. **Rollback.** Retain at least one independently verified compatible
   last-known-good release. A local recovery rollback to it must be an explicit
   authenticated policy exception, distinct from accepting a replayed remote
   downgrade. Require compatible data schemas; never roll back by deleting or
   rewriting unsynchronized ciphertext, account envelopes or operation IDs.
9. **Corruption and eviction.** Quarantine only damaged shell/cache entries;
   select a fully verified compatible fallback, or fail closed into a trusted
   recovery UI. Re-download and verify only when network returns. If all trusted
   shells are absent, a completely offline reinstall is impossible without an
   independently trusted local package. Never use `Clear-Site-Data` or a blanket
   cache/IndexedDB reset as repair for this application.
10. **Defense in depth.** Anchor-enforced origin restrictions, restrictive CSP,
    no unreviewed third-party execution and SRI where appropriate limit attack
    surfaces. They complement the anchor; they do not replace it. A currently
    trusted but vulnerable release/XSS can still misuse unlocked in-memory keys;
    release signing alone is not a full endpoint-security solution.

Browser data can be evicted and persistent storage requests have browser-specific
behavior. Treat storage availability as a runtime fact, preserve/export durable
ciphertext safely where the product permits it, and test recovery rather than
promising permanent browser retention. See
[Mozilla storage quotas and eviction documentation](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## Acceptance gates for the future implementation

Run deterministic tests for complete cache/no network/restart; missing HTML,
module, CSS, worker or WASM; flipped digest; unknown key; invalid/expired
signature; replay/downgrade and same-sequence divergence; altered origin/redirect;
untrusted SW update; interrupted staging/activation; two concurrent tabs;
cache eviction; schema-incompatible rollback; signer rotation/recovery; empty
first-install cache; clock rollback; and preservation of encrypted queues through
every refusal. Test malicious-origin delivery from outside the allegedly trusted
web page, including SW update checks, rather than merely changing one asset in
an otherwise honest server.

Then verify native Safari and real iPhone/Android installed-PWA lifecycle,
permissions, suspend/resume and storage behavior. Current Chromium probes and
responsive profiles cannot establish those hardware properties.
