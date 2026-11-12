# P2 V54 — HTTPS import rejection vs async catalog refresh (2026-11-12)

**Status: corrective Draft; exact-head CI pending.** Source: integrated Product+UX PR #185 @ `031268fcef916bf05e69c23226a702325775aefb`.

## Confirmed CI symptoms

- Product QA #162, first run [43175443452](https://github.com/1troitsky/photobunker-v3/actions/runs/43175443452), Chromium **53/54**: `p2-browser-https-link-import.spec.ts:120` timed out waiting for a local `media.link_private_host` alert for `https://127.0.0.1/private.wav`.
- #162 exact same commit, rerun attempt 2: **54/54 PASS**, so the first error was not a proven permanent break of HTTPS validation.
- Combined UX/Product PR #185 @ `031268fc`, real PG18/Garage run [43187575083](https://github.com/1troitsky/photobunker-v3/actions/runs/43187575083), **59/60** with the **same** missing local alert; all other scenarios passed. Four other integration workflows (foundation, security, UX lane guard, UX sources) PASS. This is a reproducible intermittent UI feedback race, not a license to relax the test.

## Code-level cause and bounded repair

In `MediaImportPanel.vue`, `importHttpsLink()` correctly receives `media.link_private_host` from `validateHttpsImportUrl()`. However the independent asynchronous `refresh()` catalog path unconditionally assigns `error.value=''` after a successful cloud list. Because import validation and catalog loading share one ref, a pending cloud response can erase the import rejection after it was displayed. `more()` also shared the same ref.

The repair separates `catalogError` from the existing user-action `error` without altering validation, the forbidden URL list, fetch credentials/referrer/redirect policy, E2EE, cloud auth, TTL or backend. One visible `role=alert` prioritizes the user-action error; genuine catalog refresh clears only its own error. Switching to a different account/device clears both to avoid leaking old UI messages. The old `media.link_private_host` failure remains a hard assertion.

## Regression and acceptance

The real Chromium test now rejects the private HTTPS host, verifies no forbidden outgoing requests, **then performs an actual authenticated GET /media/v1 via Refresh** and requires the local security rejection to remain visible after the catalog request finishes. No mocked 200, no sleep/retry, no test skip/timeout inflation or network fetch to private host. The existing no-local-plaintext-files assertions remain.

Required exact-head: PHP 8.4/8.5, Vue TS/build, 354 Vitest (or new count), security, immutable UX source/lane guard, PG18/Garage full 60 Chromium. Physical devices and manual owner acceptance remain NOT TESTED. Corrective PR is Draft; do not merge to main.
