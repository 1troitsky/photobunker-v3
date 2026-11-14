# P2 #340 — Post-#336 Public Card PRIVATE-only integration preflight (not a launch approval)

Date: 2026-11-14. Integration owner CHAT-P. Source immutable [Draft PR #301](https://github.com/1troitsky/photobunker-v3/pull/301) at `6507d15767bdc79c4ea68dd166c8cc8d4ab1b01b`, stacked on old security/297 branch `60407676...`. Exact accepted new main `8ed66c438d090efd218efa80b027f0b2f854db4b`.

## Provenance and file collision inspection

- Read AGENTS.md, ts.md §§18 and 25.10, [Issue #211](https://github.com/1troitsky/photobunker-v3/issues/211), [new integration Issue #340](https://github.com/1troitsky/photobunker-v3/issues/340), original #211 CHAT-B CLAIMs and #302 journal. New START/CLAIM on #302/#340; original source branch untouched.
- EXACT source PR 30 changed paths inspected against current main Git tree. **29 are absent from new main**; the sole existing `apps/web/src/features/media/ui/MediaSharePanel.vue` has unchanged original parent blob `3cc91b5f2566d1002291c325420a99970faf4fac`, verified from source PR diff and main. Source all 30 blob references copied byte-identically; no inherited Composer lock, routes, workflows, generic identity/ACL, media-outbox, camera, or file viewer changes.
- The dedicated workflow `.github/workflows/p2-public-card-signed-intent-211.yml` stays included as an isolated complete PHP/PG18 private policy verification lane. No new public route/controller/anonymous media endpoint is added.

## Security contract (actual current capabilities only)

- Signed P-256 scoped **private intent** and durable PostgreSQL ledger with `STAGED` / `REVOKED` states only; `published=false` and no generated public bearer URL or read entitlement. Owner-only check `CurrentReadDenialGate` never authorizes a token.
- Safe-JPEG review and Local-First contributor prepared-consent are strictly local; original, GPS, DEK, unrestricted media permissions or metadata must never flow into an anonymous result. Pre-grant preview UI does not imply publication; source E2E tests decode actual Safe JPEG and ensure no hidden data.
- UI entry is an explicit **user gesture** in existing `MediaSharePanel`; asynchronous session/candidate changes must fail closed; root signature and media/assignment provenance are checked before saving encrypted private consent. No server authenticated publication API, no external Public Card route, no real anonymous read, no token-issuer/revoke-read round-trip, no publicly served Jpeg/Garage artifact.
- Real public release requires independently resolved owner+contributor grants, signed media/assignment provenance, strict intersection of policy ceilings, TTL/revoke read-time gate and no-store authenticated-to-anonymous transfer. These are **BLOCKED / NOT IMPLEMENTED / NOT TESTED**. Two actual devices, native iOS Safari/Android and real anonymous browser service acceptance remain NOT TESTED.

## Integration acceptance

- Required **exact own HEAD**: PHP 8.4/8.5 Composer Audit + PHPUnit, dedicated Private Public Card workflow with real PG18, frontend Vitest/TS/Vite, Security and UX gates, separate actual PostgreSQL/Garage/Chromium test lane. Preserve any original failure and its correction.
- No test disable/skip/xfail, no mock replacement for genuine browser acceptance; no production secrets or S3 object deletion. Every test/report must distinguish **PRIVATE preflight PASS** from **PUBLIC feature #211 still PARTIAL**.
- This branch/PR does not edit main. Main merge requires separate explicit owner approval for this specifically named package after verified CI and independent security review.
