# PB3 UX-05 — real Chromium acceptance evidence and QA blockers (2026-11-12)

**Draft PR:** [#155](https://github.com/1troitsky/photobunker-v3/pull/155).
**Functional code HEAD tested:** `7cca9e456d00c4fda7f2329dc19d8f47ce9ac518`, based on [#153](https://github.com/1troitsky/photobunker-v3/pull/153) `b888b3b94ba74a5d7baedb08b80a75608457cfbe`.
**Change set:** only one shared `App.vue` Dock link handler; pure `ui/fieldwork/dock-retap.ts` and unit tests, new `tests/e2e/p2-settings-dock-retap.spec.ts`, and [scope document](../planning/P2-UX-05-DOCK-REPEAT-ACTIVE-SAFE-PARENT.md). No Viewer/Browser/Identity/Assignments/Import code or tests changed.

## Functional acceptance already demonstrated

The **two new real Chromium scenarios** in `p2-settings-dock-retap.spec.ts` pass on both attempts:
1. Full Key-Only registration; active Settings root repeated tap is a no-op; Settings → Appearance → Settings; Settings → Search → exact Dock control → retap → Search with original `q` → retap → Settings; no extra root history.
2. Browser Editor direct deep link → same file Viewer → Browser; repeated Browser root tap does not create extra history.

Pure Vitest also covers verified in-section history only, editor parent matching, direct deep-link fallback and no accidental cross-section `window.history.back()`. Existing `FileViewerView.vue` onBeforeRouteLeave unsaved guards and identity-bound, volatile Browser return context are **not modified**.

## Exact code HEAD CI — historical attempts retained

| Check | Evidence | Result |
|---|---|---|
| PHP 8.4/8.5 + strict Vue TypeScript/Vitest/build | [Actions 43166441096](https://github.com/1troitsky/photobunker-v3/actions/runs/43166441096) | **PASS** |
| P0 Security | [Actions 43166441119](https://github.com/1troitsky/photobunker-v3/actions/runs/43166441119) | **PASS** |
| PG18/Garage/Chromium attempt 1 | [Actions 43166441200](https://github.com/1troitsky/photobunker-v3/actions/runs/43166441200), job `131009306631` | **FAIL, 54/56 PASS** |
| PG18/Garage/Chromium failed-job retry, same SHA | [Same Actions 43166441200](https://github.com/1troitsky/photobunker-v3/actions/runs/43166441200), job `131012690154` | **FAIL, 55/56 PASS** |

### Attempt 1 failures (two pre-existing tests, no UX-05 test)

1. `tests/e2e/p1-contact-assignment-picker.spec.ts:3` P1-26 contact → signed assignment invitation. **190s test timeout**; teardown reported "Test ended", browser console also emitted `Uncaught (in promise) Error: identity.changed` at `assignment-outbox.ts:518`. May be delayed identity/handshake/test isolation, but cannot be assumed safe.
2. `tests/e2e/p2-browser-https-link-import.spec.ts:120` rejected local/private HTTP source. **Missing expected `media.link_private_host` alert within 15s**. This is a security-sensitive import rejection path. Do **not** disable or weaken assertions without actual root-cause analysis.

### Attempt 2 failure (different pre-existing test)

1. `tests/e2e/p2-browser-file-viewer-index-target.spec.ts:109` Viewer authenticated page-2 replay rejection test:
   `getByRole('status')` resolved to **two** status elements — `<div role="status" class="file-viewer-wait">Открываем защищённый файл…</div>` and the intended warning `<p role="status" class="muted">Неверная или недоступная страница облачного индекса. Ранее проверенные файлы и курсоры сохранены.</p>`. Playwright strict-mode violation (not a missing warning). Similar broad status selector ambiguity was observed during #146 testing, so QA should scope the expected status selector to the exact component and verify both loading and warning visibility semantics.

## QA/PRODUCT coordination

- Evidence sent to product [#154](https://github.com/1troitsky/photobunker-v3/pull/154) in [coordination comment](https://github.com/1troitsky/photobunker-v3/pull/154#issuecomment-6816363549). Its branch owns the existing asynchronous P1/Browser E2E fixtures. Do not edit those existing test files in UX-05.
- Product [#156](https://github.com/1troitsky/photobunker-v3/pull/156) owns Editor / global styles, and no PR #155 files overlap with it.
- Both attempts were on **identical functional code**, no test weakening, same worker count. Divergent failure locations suggest unstable asynchronous test/identity behavior but **do not prove** a product regression is absent. Treat them as merge blockers until a clean exact-head and reconciled product+UX CI.
- **Historical #139-current/#140 divergent ancestry** remains unresolved; one future integration branch must merge missing product corrections with a reviewed diff before any main merge. No main changes were made.

### Status

**UX feature code and two new browser journeys: PASS**; **entire E2E suite: FAIL in both attempts**. The PR must remain **Draft / NOT MERGEABLE** until verified clean full-suite CI and owner approval. No physical iOS/Safari/manual production acceptance claimed. A future docs-only commit may re-trigger CI, but must not retroactively rewrite these failed runs as passing.
