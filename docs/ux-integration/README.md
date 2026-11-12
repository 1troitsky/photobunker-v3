# UX integration map — PB3

**Для владельца продукта: [Открыть простую визуальную карту экранов](VISUAL-MAP.md).** На ней нет технических номеров — только привычные разделы приложения и переходы.

> **Status: DOCUMENTATION BASELINE / NOT UI ACCEPTANCE.** Snapshot: PB3 Draft #135 on top of Draft #134 @ `25fd55d9`, 2026-11-12. Only sources reachable in this stacked branch are treated as present. No app behavior is claimed PASS without E2E evidence.

This directory maps the **original, unmodified PB2 PR #56 UX specifications now checked into PB3** to cross-screen journeys and current PB3 runtime. The source package remains in [../ux/](../ux/). The older [../_uiux/](../_uiux/) is preserved but is not the reference for new mappings.

## Cross-lane development rule

**Before opening a new PB3 UX implementation PR**, read [PARALLEL-WORK-PROTOCOL.md](PARALLEL-WORK-PROTOCOL.md). Product #139/#140 already touch real File Viewer, AppShell and global styles. UX sandbox branches must not reimplement them or edit existing product files; CI guard enforces isolated file paths. This coordination document is an **operating contract**, not proof of approved new UX.\n\n## Read in this order

1. [SCREEN-REGISTRY.md](SCREEN-REGISTRY.md) — 22 canonical UX areas, version, acceptance status, local PB3 source and runtime evidence. Do **not** infer an accepted screen from a similarly named legacy HTML.
2. [NAVIGATION-MAP.md](NAVIGATION-MAP.md) — screen graph, numbered cross-screen edges, Back/overlay rules, explicit unimplemented and open edges.
3. [INTEGRATION-CONTRACTS.md](INTEGRATION-CONTRACTS.md) — entity identity, privilege boundary, storage, shell, navigation payloads, local-first, messages and public sharing invariants.
4. [USER-JOURNEYS.md](USER-JOURNEYS.md) — reviewable acceptance scenarios and required test evidence.
5. [GAPS-AND-DECISIONS.md](GAPS-AND-DECISIONS.md) — gaps, contradictions, unresolved decisions and implementation order.

## Source precedence

- Latest *explicit* owner decision; source reference must be recorded before overriding a document.
- [PB3 requirements](../../ts.md), for product scope, security and phase gates.
- [PB2 #56 accepted UX catalog](../ux/README.md), each screen's `README.md`, and [unified Shell](../ux/UI-SHELL-CONTRACT.md) for approved visual behavior.
- Corresponding **accepted standalone** and source `index.html`/`style.css`/`app.js` for observable prototype details. A demo action never certifies runtime behavior.
- PB3 runtime at the pinned parent revision for **implementation facts only**, not for deciding what the design should have been.

Where two sources genuinely conflict, record an issue in [GAPS-AND-DECISIONS.md](GAPS-AND-DECISIONS.md), apply the narrower security policy, and do not silently choose a UI design.

## Verification / provenance

PB2 source `1troitsky/photobunker-new@daca24a4a38c62473859b2b54b4999d50400c491:docs/ux/` was imported unchanged in PB3 PR #135: 117/117 matching Git blob SHAs, 0 missing, 0 extra. This PR **only adds integration documentation**; source files under `docs/ux/` and `docs/_uiux/` are read-only baselines.

Status vocabulary (two independent axes):
- **UX status:** ACCEPTED / SELECTED / BETA-ACCEPTED / WIP / TEXT-DRAFT / OPEN.
- **Runtime evidence:** ROUTE-PRESENT / PARTIAL-UI / DRAFT-ONLY / NO-ROUTE / NOT-TESTED. Route existence never means end-to-end acceptance.

A future implementation PR must cite at least one edge ID (e.g. N-07) and journey ID (e.g. J-05), include target component paths, and provide automated/manual evidence with device, commit and test result. No item becomes ACCEPTED merely because docs or demo UI render.

## How to review

- Open the accepted HTML in [../ux/](../ux/), compare against the source-specific README, then the graph edge. For example: [File Viewer](../ux/browser/viewer/README.md) → [Public Card](../ux/public-card/README.md) and [Profile WIP](../ux/settings-profile/README.md) → [Messages Beta](../ux/messages/README.md).
- Follow the explicit source references in [SCREEN-REGISTRY.md](SCREEN-REGISTRY.md); all links are relative to PB3, not the old PB2 repository.
- For security-related flows verify *real* ACL, tokens, Local-First persistence and failed/expired/revoked states; do not accept screenshots or demo fixtures as proof.

**Scope of this PR:** investigation, traceability and future test contracts only. No backend/frontend changes, source reformatting, merge to main, or claims of a completed visual/browser/device audit.
