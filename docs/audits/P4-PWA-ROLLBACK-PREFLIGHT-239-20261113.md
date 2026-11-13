# #239 prerequisite preflight — 2026-11-13

- Source: `main@6565a0fe852882ea5fc26e493df81affed687eee`; `AGENTS.md`, `ts.md` §24–24.1 and Issue #239 re-read.
- CLAIM: [Issue #239](https://github.com/1troitsky/photobunker-v3/issues/239#issuecomment-6862846992), owner ChatGPT, branch `docs/p4-239-pwa-trust-threat-model`.
- Exclusive changes: NEW `docs/security/PWA-RELEASE-TRUST-THREAT-MODEL-239.md` and NEW `docs/audits/P4-PWA-ROLLBACK-PREFLIGHT-239-20261113.md`.
- Checked ownership: #196 Draft PR #250 in `scripts/release-integrity/**`; #230 Draft PR #299 in `scripts/release-auth/**` and new dedicated workflow; #198 Draft #296 frontend/backend Notifications; #297 Draft #298 Composer/Laravel. No overlap.
- Threat-model product: origin-compromise and independent bootstrap trust; candidate signing and asset staging; SW can run before app checks; external monotonic rollback floor; last-known-good eligibility/eviction; revocation, cache races, offline and reinstall; attack matrix and operational release gates.
- **Evidence:** documentation review candidate only; no code execution and no behavior tested on browsers or devices. GitHub workflow result on exact doc HEAD to be tracked in PR; existing CI success doesn't prove threat mitigations.
- **BLOCKED:** production signer, root distribution/rotation, independent security approval, #196/#230 integration, no trusted SW bootstrap, cross-browser E2E, physical native devices, any destructive production rollout.
- **Security verdict:** NO CLAIM of a PWA security protection, NOT an approved threat-model review, NOT ready to implement or enable SW. This Draft PR is the prerequisite for formal independent review.

## Exact HEAD CI observation

Doc source HEAD `f745ab19bcfbdd552a04169abd029a0ac867b8a3`: [security workflow 43493083052](https://github.com/1troitsky/photobunker-v3/actions/runs/43493083052) **PASS**; [foundation 43493083070](https://github.com/1troitsky/photobunker-v3/actions/runs/43493083070) **FAIL** due to inherited Composer audit Laravel CVE-2026-128083, owned by parallel Issue #297; [storage 43493083119](https://github.com/1troitsky/photobunker-v3/actions/runs/43493083119) **IN PROGRESS** at observation. None of these CI outcomes constitute acceptance of this security model, independent signature trust, protected SW activation or mobile E2E. Documentation-only follow-up commit to record evidence changes no runtime code.
