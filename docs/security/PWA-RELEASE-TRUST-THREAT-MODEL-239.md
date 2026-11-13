# PWA release trust / last-known-good threat model — #239

**Status:** proposed pre-implementation security model; not independently approved, not a runtime implementation. Owner requirement: `ts.md` §24–24.1; `AGENTS.md`; #196 (Draft #250), #230 (Draft #299), #239. Base `main@6565a0fe852882ea5fc26e493df81affed687eee`.

## 1. Protected assets and trust boundaries

Protected assets: integrity of executable JS, HTML, CSS, WASM and Service Worker; signing private key; pinned public-key provenance; the monotonic accepted release sequence; last-known-good (LKG) executable assets; encryption / recovery keys and the ability to refuse execution of unverified updates. Threat actors may control **all bytes on the web origin/CDN**, its HTTP cache, a failed/mixed deploy, a stale proxy or a partially downloaded release. Browser storage may be erased/evicted or shared across tabs. A compromised browser/OS and a malicious signed release are **out of scope for a cryptographic authenticity claim**; neither signature verification nor SW can make untrusted client code safe.

**Critical separation:** (A) origin-controlled candidate manifest/assets/SW are UNTRUSTED, (B) off-origin trusted verifier + pinned Ed25519 public key / revocation policy + trusted monotonic sequence are the trust authority, (C) local CacheStorage/IndexedDB are convenient availability stores, **not tamper-proof independent trust anchors**. Do not accept policy values delivered in the same origin response as the release. TLS/HSTS protects network transport but is not sufficient against a malicious origin operator.

## 2. First install and independent bootstrap

A clean browser has no trusted Service Worker and executes same-origin entry HTML/JS before ordinary client-side verification unless an independently authenticated bootstrap is present. Therefore **no claim of full malicious-origin protection on first load** is permitted from normal JS. The app's setting may at most say "not independently verified" until an actual external trust path is approved and tested. Possible independent anchors: a separately distributed native verifier, signed/verifiably installed shell or off-origin trusted execution environment with pinned root key. A public key hosted on the same web server, included in bundled JS or obtained from a same-origin API is **not independent**. Even a remote key endpoint helps only if its own bootstrap/provenance is authenticated outside the compromised origin.

**Blocking owner/security decisions before implementation:** select concrete independent root distribution mechanism, how root versions/key revocations are securely delivered, how an installation obtains trusted minimum sequence, how a first run proves verifier authenticity, and how the system handles absence/eviction of trusted state. Do not invent a public-key URL and present it as authenticated. Browser vendor updates and OS keychain do not automatically confer an origin-independent verifier.

## 3. State machine and trust proof obligations

```text
UNTRUSTED_CANDIDATE
  -> SIGNATURE_VERIFIED_WITH_EXTERNAL_ANCHOR
  -> ASSET_BYTES_VERIFIED (all manifest paths incl HTML and SW; bounded atomic snapshot)
  -> STAGED_UNEXECUTED
  -> PROMOTION_AUTHORIZED_BY_TRUSTED_BOOTSTRAP
  -> VERIFIED_ACTIVE (trusted durable sequence and LKG receipt committed)
FAIL at any step -> QUARANTINED; VERIFIED_ACTIVE unchanged
```

- **Do not execute candidate HTML/JS/Service Worker or allow a candidate service worker to control clients before full verification.** Default browser registration/update paths require explicit analysis: browser may fetch/execute a new SW in its own lifecycle before an app-level verifier can approve it. A cached same-origin verifier is not itself an independent gate.
- Candidate manifest must be **canonical**, signed over exact bytes with Ed25519 and verified under an independently pinned key and active trust policy. #230 currently validates only detached signature, not full release asset set or key provenance.
- #196 must validate complete JS/CSS/HTML/WASM/SW and significant assets, no unlisted/extra executable bytes, no path escapes/symlinks, stable release ID and sequence. Check all assets **after retrieval** and bind each verified byte string to staging, not just the URL/hash metadata.
- **Promotion must be atomic from the user's perspective:** all assets of one release become visible only after a complete validated snapshot. Mixed versions, partially downloaded entries, CDN race, interrupted install, failed hash, or missing SW remain quarantined. Never clear the previously verified cache or execute staged code on failure.
- **Anti-rollback** compares candidate `release_sequence` with the highest sequence accepted by a *trusted external authority or protected monotonic store*. Never derive the floor from candidate JSON, URL, or untrusted browser storage alone. If the floor is unavailable, block promotion and indicate unverifiable state. A locally stored sequence can assist with accidental rollback but cannot independently resist malicious-origin tampering or storage clearing.
- LKG must have an independently verified signature receipt binding the release sequence, manifest digest, key fingerprint and exact asset snapshot. Restoration must **revalidate** all cached bytes and trust policy (including revocation) before treating LKG as executable. If LKG was evicted/corrupted, report unavailable rather than fetch a purported 'previous' release from an untrusted origin and run it.
- **Revocation policy prevails over offline availability.** A signature once valid can become revoked; handling offline/unknown revocation freshness must be an explicit owner-approved policy, not silently treated as secure.
- **Concurrent tabs/installations** must be serialized or use compare-and-swap/lease semantics around staging/activation and highest sequence, with fencing against crashed old workers. A restarted tab cannot downgrade the accepted floor or erase a usable LKG. A server ACK or UI label does not prove the candidate was actually promoted.
- **Never hand candidate code live encryption/recovery credentials.** Crypto keys or sensitive operations from any unverified bootstrap must remain inaccessible; browser origin isolation alone does not separate a malicious same-origin script from already provisioned origin storage. This is a fundamental browser limitation that may require a native/isolated anchor.

## 4. Threat-to-test matrix (evidence needed before #239 acceptance)

| Attack / failure | Mandatory outcome | Evidence gate |
|---|---|---|
| JS/CSS/HTML/WASM/SW modified, missing or extra file | reject candidate, LKG unaffected | byte-level negative fixture + browser lifecycle tests |
| Manifest altered / detached signature removed / attacker key | reject independently; no 'Verified' UI | #230 verifier + independent-root tests |
| Signed old version replayed / attacker resets local storage | refuse below trusted floor; first-boot state not falsely trusted | protected external floor, reset/reinstall tests |
| Revoked/rotated signer | reject revoked key; accept new only with authorized trust-chain transition | externally authenticated root rotation/revocation proof |
| CDN delivers mixed release assets | reject all-or-nothing candidate | multi-version cache E2E with content hashes |
| Offline while downloading / process killed | do not promote; LKG works offline if verified and available | interruption/relaunch E2E |
| Browser evicts LKG or cached byte becomes corrupt | safe unavailable state; no untrusted fallback | storage eviction/corruption injection |
| New browser / clean reinstall / cleared SW | no self-attested secure first boot | real fresh Chrome/iOS Safari/Android test |
| Malicious origin supplies new HTML/JS + pinned-key text | independent verifier must not be replaced; otherwise no authenticity claim | external-bootstrap penetration exercise |
| Concurrent tabs and interrupted SW upgrade | no mixed activation, stale leader cannot promote | two-tab race and crash/restart evidence |
| Signature valid but malicious signed release | signatures do not establish benign behavior | release approval, reproducible builds, software review |
| UI 'Verified' but verifier unavailable or revocation stale | deny elevated trust level, preserve accurate status | negative UX evidence |

## 5. Mandatory release operations and visibility

Use separate statuses with explicit evidence and timestamp: `UNVERIFIED`, `SIGNATURE_VALID_WITH_EXTERNAL_ANCHOR`, `ASSETS_VERIFIED`, `VERIFIED_ACTIVE`, `REJECTED`, `LKG_UNAVAILABLE`, `REVOCATION_UNKNOWN`. A signature success alone is not `VERIFIED_ACTIVE`. Never show absolute guarantees against compromised browser/origin.

The release process must have an off-origin signer (private key never in repo/web env/frontend/Laravel/S3), documented dual-control/rotation and revoke plan, reproducible lockfiles, signed manifest audit log, rollback floor management, safe error telemetry with no user secrets, and reversible staging. Any test that invokes destructive deployment, production SW takeover, production key rotation or deletes real cache/data needs separate owner approval.

## 6. Independent review exit criteria

**Do not write or enable SW staging/activation/rollback** before the following are independently approved: threat boundaries and first-boot model; real off-origin trust anchor; protected signer and root rotation; external sequence floor and reset/reinstall policy; a verified LKG durability policy; concrete Browser/SW interception architecture; and reproducible adversarial acceptance harness on exact code HEAD. #196/#230 isolated build artifacts are necessary but not sufficient.

**Result:** this document is a review input, not a completed security audit. #239 remains in-progress and PWA runtime remains unchanged.
