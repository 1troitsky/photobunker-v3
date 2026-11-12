# PB3 — epic map (coverage index, not implementation inventory)

**Kanban protocol:** [PB3-KANBAN.md](PB3-KANBAN.md) · GitHub Issues: [all EPICs](https://github.com/1troitsky/photobunker-v3/issues?q=is%3Aissue+is%3Aopen+in%3Atitle+EPIC).

The 16 Epic Issues are a durable *index* of all 28 major sections of `ts.md`; they are intentionally **not** estimates or acceptance claims. Section §25's 25 system journeys, `docs/ux-integration/USER-JOURNEYS.md` J-01–J-22 and gates P1–P4 are cross-cutting; coverage is many-to-many, not a lossless 1:1 transcription.

| Epic | Issue | Normative source | Phase | UX source / Screen IDs | Cross-screen acceptance |
|---|---|---|---|---|---|
| EP-01 · Identity, E2EE, Recovery | [#163](https://github.com/1troitsky/photobunker-v3/issues/163) | §5; §4.6 | P1/P3 | S01–S04 · Welcome/PIN | J-01/J-02 |
| EP-02 · PIN, Panic, Devices, DMS | [#164](https://github.com/1troitsky/photobunker-v3/issues/164) | §6; §5.3 | P1/P3 | S03–S04/S15 · Security & Privacy | J-19 |
| EP-03 · Storage, Backup, TTL, S3 | [#165](https://github.com/1troitsky/photobunker-v3/issues/165) | §4.4–4.5, §7, §10 | P1/P3/P4 | S16 · Data & Storage | J-17 |
| EP-04 · Assignments | [#166](https://github.com/1troitsky/photobunker-v3/issues/166) | §11 | P1/P2 | S05–S06 · Assignments | J-03/J-04 |
| EP-05 · Browser/Catalog | [#167](https://github.com/1troitsky/photobunker-v3/issues/167) | §12 | P2 | S07 · Browser v3 | J-04/J-21 |
| EP-06 · Viewer & Editors | [#168](https://github.com/1troitsky/photobunker-v3/issues/168) | §13 | P2 | S08–S10 · File/Photo/AV | J-06/J-07/J-21 |
| EP-07 · Camera | [#169](https://github.com/1troitsky/photobunker-v3/issues/169) | §14 | P1/P2 | S11 · Camera 1.2 | J-05 |
| EP-08 · Contacts, Teams, Profile | [#170](https://github.com/1troitsky/photobunker-v3/issues/170) | §15 | P1/P2 | S12–S13 · Contacts/Profile WIP | J-11/J-22 |
| EP-09 · Messages / Matrix | [#171](https://github.com/1troitsky/photobunker-v3/issues/171) | §16 | P2/P4 | S22 · Messages 1.1 Beta | J-12/J-13 |
| EP-10 · Notifications | [#172](https://github.com/1troitsky/photobunker-v3/issues/172) | §17 | P2 | S17 · Notifications 1.5 | J-16 |
| EP-11 · Public Card & Share | [#173](https://github.com/1troitsky/photobunker-v3/issues/173) | §18; §12 share | P2 | S20 · Public Card | J-08/J-09/J-10 |
| EP-12 · Shell, Settings, Welcome, Appearance | [#174](https://github.com/1troitsky/photobunker-v3/issues/174) | §0.4, §2, §19–20 | P2 | S01–S04/S13–S14/S21 | J-01/J-14/J-15/J-20 |
| EP-13 · Tariffs, Payments, Technical Limits | [#175](https://github.com/1troitsky/photobunker-v3/issues/175) | §8–9, §22 | P1/P3 | S18–S19 · Billing/Checkout | J-18 |
| EP-14 · Administration & Analytics | [#176](https://github.com/1troitsky/photobunker-v3/issues/176) | §23 | P3 | No accepted screen in source; backend first | TS §25 item 21 |
| EP-15 · Infrastructure, API, Branding, Signed PWA | [#177](https://github.com/1troitsky/photobunker-v3/issues/177) | §0–4, §21, §24 | P0/P1/P3/P4 | Shell/shared; non-UX engineering | TS §25 items 18,23,24 |
| EP-16 · Integration / QA / Acceptance | [#178](https://github.com/1troitsky/photobunker-v3/issues/178) | §25–28 | Cross-phase | All mapped journeys | J-01–J-22 · TS §25 1–25 |

## Source precedence / mapping

1. `ts.md` — normative product scope, system boundaries, security, P1–P4 gates. It is **not** a current progress tracker.
2. `docs/ux/` — canonical accepted source versions from PB2 PR #56, imported as 117 exact files in PB3 Draft #135 and combined #158, not yet in the present `main` tree. Historical versions and Profile WIP/Messages Beta retain original status.
3. `docs/_uiux/` — existing visual HTML archive in `main`; consult `docs/ux-integration/VISUAL-MAP.md` on #158 for 23-file mapping, not as an unconditional override of #56.
4. `docs/ux-integration/` — #138/#158 Screen Registry S01–S22, Navigation Map N-01–N-48, contracts C-01–C-12, User Journeys J-01–J-22 and GAP register. The original historical snapshot is superseded by its dated integration addenda where applicable.
5. `AGENTS.md` — required delivery/security discipline. Existing Draft PRs and exact commits are runtime evidence, not UX-approval sources.
6. `TS_PROGRESS_TABLE.md` — old approximation (2026-11-11). Do not convert rough percentages to GitHub Project Status. Recompute only after local combined-main reconciliation.

## Epic rules

- All Epic Issues start **Backlog / RECONCILE**. No epic is marked Done merely because earlier Issues or Draft PRs are green.
- A new Task must link one *primary* Epic; it may cite others as dependencies. Define acceptance as behavior through actual persisted/encrypted data when relevant.
- For published/phone data and complex PIN/Matrix/S3 flows, `Blocked` is valid until contract and gate are understood; avoid speculative protocol inventions.
- After integration, associate all historical PRs with Epics; do not automatically close historical issues or perform bulk merges.

## Example: first safely-scoped candidates

- [Notifications](https://github.com/1troitsky/photobunker-v3/issues/172): isolate feature state/rendering, leave Shell/router untouched until reviewed.
- [Administration](https://github.com/1troitsky/photobunker-v3/issues/176): isolate backend namespace and tests, no access to decrypted data.
- [Help/Legal](https://github.com/1troitsky/photobunker-v3/issues/174): integrate only accepted UI elements, do not claim final legal copy.

Do **not** mark these `Ready` until the task-specific review of latest PR HEADs, changed files and dependency rules is complete.
