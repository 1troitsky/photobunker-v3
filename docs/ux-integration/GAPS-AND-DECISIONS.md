# UX integration gap register — open decisions and detected deviations

**Snapshot:** PB3 Draft #135 atop #134 @ `25fd55d9`. Flags are derived from imported [PB2 UX README](../ux/README.md), [PB3 ts.md](../../ts.md), the [current router](../../apps/web/src/router.ts) and related Vue views. **Do not** assume open independent Draft PRs are merged into this tree. Severity is prioritization for future implementation, not a claim that production is broken.

| ID | Issue / observed evidence | Decision or implementation boundary | Related edges / journeys | Gate |
|---|---|---|---|---|
| GAP-01 | No canonical cross-screen source registry existed in PB3 prior to this PR | Docs mapped here; implementation must cite edge/journey IDs; not a runtime PASS | all | DOCUMENTED in this PR |
| GAP-02 | Public Card external token format, safe asset handling for video/audio, download scopes and revoke remain OPEN in PB2 README | **Owner/security contract required** before external publication; keep in-app preview separate from grant | N-21–N-25 · J-08/09 | OPEN / BLOCK PUBLICATION |
| GAP-03 | Browser Share multiple files or whole assignment is explicitly undecided; PB2 has `SHARING-OPEN-QUESTIONS.md` | Do not recycle Public Card or legacy collection silently; owner must decide recipient, snapshot/live scope, keys, TTL | N-26 · J-10 | OPEN / DO NOT IMPLEMENT |
| GAP-04 | Message dialog closes to same inbox per Beta design, but the proper close destination after **Profile/Contacts-initiated** chat is not separately specified | Documented but **not approved**: preserve origin route/context; owner should approve desired return before finalizing deep-entry UX | N-29/30/43 · J-12/13 | OPEN UX |
| GAP-05 | Profile 1.6 explicitly WIP; "Написать" disabled, own-card actions not final; PB3 `/settings` currently is Identity/Access not agreed profile | Do not promote WIP to accepted. Present specific contested choices in owner review; integrate with Contacts and Matrix after approval | N-28/29/34/36 · J-11/12/15 | OWNER REVIEW |
| GAP-06 | Assignments 5.0 explicitly notes **no approved standalone assignment detail HTML** | Existing inline detail may be a temporary implementation, but do not label it accepted design | N-09 · J-03/04 | OPEN UX |
| GAP-07 | File Viewer route exists in #134, while Photo Editor and AV Editor are partly implemented **inside** it, rather than as 3-tab accepted standalone designs | Preserve working media pipeline; map editor entry/save/cancel to approved UX in a later integration PR, no wholesale code rewrite | N-18–N-20 · J-06/07 | IMPLEMENTATION DELTA |
| GAP-08 | PB3 `App.vue` has five hardcoded Dock links; UX 1.3 requires user-configurable 3–6 and mandatory movable Profile/Settings | Shared config/store & Shell-only rendering, no 22 cloned docks; verify Back semantics and safe area | N-05/35 · J-14 | IMPLEMENTATION DELTA |
| GAP-09 | Settings control deep search with RU/EN synonyms/scroll/focus is not present in current AccountView | Implement control-level search, not just route to top of section, after Settings architecture is integrated | N-34 · J-15 | IMPLEMENTATION DELTA |
| GAP-10 | Historical Payments & Tariffs 1.1 HTML has outdated values; PB3 requires config-based plans/quotas; payment runtime not mapped | Reuse only approved visual composition; render current server catalog, never use demo prices or fake confirmations | N-40/41 · J-18 | SECURITY/PRODUCT GATE |
| GAP-11 | PB2 Markdown documents contain legacy relative links to PB2-only files (e.g. billing, photo storage) not guaranteed in PB3 | Keep exact 117 sources unchanged. Add **PB3 overlay mappings** in future, do not mutate original READMEs silently or assume every legacy link resolves | Source registry / all | DOCS PORTABILITY |
| GAP-12 | Separate Matrix Draft #64 and successors are not on the #134/#135 ancestry; PB3 #134 router has no Messages route | Track separately; never claim Matrix is shipped. UX map valid independently of Matrix implementation schedule | N-42–N-45 · J-12/13 | DRAFT-ONLY / NOT VERIFIED |
| GAP-13 | External Public Card → public author profile is a demo notification, not resolved privacy/identity route; no public profile route in #134 router | Recheck public profile visibility independently, no automatic disclosure of team/name/GPS | N-24 · J-09 | OPEN UX/SECURITY |
| GAP-14 | Video/Audio standalone Editor uses its own sample IndexedDB for generated files, not the real Browser v3 collection | Use production encrypted pipeline and outbox with new media IDs; old demo collection must not be treated as synced media | N-20 · J-07 | IMPLEMENTATION DELTA |
| GAP-15 | Source Browser v3 includes catalog controls and accepted icon placement; current #134 Browser is advancing by functional Draft PRs | Need screen-level visual comparison before claim of faithful PB3 implementation, without reverting real functionality | N-15/17/26/48 · J-04/21 | VISUAL AUDIT NEEDED |
| GAP-16 | No independent real-device cross-screen visual/e2e run was performed for *this documentation PR* | Automated evidence and owner/device acceptance follow in separate PRs; all journeys default NOT VERIFIED | all | NOT TESTED |
| GAP-17 | Multi-source product UX/source docs sometimes differ by time: older Assignments 4.2, Appearance 1.2, Browser 3.1, old labels | Registry fixes **current** versions; when contradictions remain, newer explicit accepted revision wins over historical example | S05/S07/S14 · all | RESOLVED VERSION CHOICE |
| GAP-18 | PB3 `ts.md` and original PB2 #56 describe Messenger as future/Beta in historical snapshots, but PB3 scope makes Matrix mandatory | Interpret status axes separately: Beta UX ≠ optional module; PB3 current scope ≠ merged working runtime | S22 · J-12/13 | DOCUMENTED SCOPE |

## Owner questions — only choices that remain genuinely open

1. **Profile → conversation Back:** When "Написать" is entered from a contact/profile, closing the fullscreen dialog currently guarantees return to the *Messages inbox* in the accepted Beta. Should a cross-screen entry instead restore original contact/profile directly? Do not reinterpret an existing approved rule without explicit decision.
2. **Final profile 1.6:** Approve concrete own-card actions, profile links and visible state before calling its UX accepted.
3. **Assignment detail:** Is the existing inline summary sufficient, or should a dedicated detail design be prepared and approved?
4. **Sharing:** Separate public single-media card, encrypted recipient media transfer, multiple-media share and whole-assignment grant. Decide each scope and recipient/access semantics; follow [PB2's source questions](../ux/browser/SHARING-OPEN-QUESTIONS.md).

For Public Card key delivery/token formats, final media download rights and external identity disclosure, run explicit security analysis before owner UX approval. Do not casually propose new functionality with weaker security just to make buttons clickable.

## Suggested safe implementation order (after map review)

1. Trace screen sources/IDs and add automated source-integrity and route assertions; keep all original sources immutable.
2. Shared Shell/Dock/back-layer contracts; identify temporary WIP states without redesigning accepted screens.
3. Browser → File Viewer → editor → back to Browser, with real encrypted data; test scope, offline and media switches.
4. Camera/Assignments/Contacts crossover, including unsaved drafts, roles, signed policy and recipient key.
5. Public preview vs publication, explicit safe assets/revocation **only after security decision**; skip multi/whole-assignment share until owner decides.
6. Profile WIP/Contacts/Messages Beta integration after relevant UX decisions; Matrix engineering can be resumed separately.
7. Notifications, Settings search, Data & Storage, Billing/Checkout and cross-device regression.
8. Independent visual and real-device acceptance. **Never mark PASS from matching Markdown alone.**

## Reporting rule

Maintain separate columns in future reviews: **UX-approved version**, **PB3 code exists**, **navigation integrated**, **security proven**, **visual approved on device**, **owner accepted**. A PR marked Draft or CI green is not a substitute for any other column.

---

## 2026-11-12: актуализация по объединённой ветке UX + PRODUCT

> Таблица GAP-01–GAP-18 выше — исторический снимок от #135/#134, **не** текущее состояние. Этот блок является новым, проверяемым дополнением и не переписывает прежние решения.

- **Продуктовая база:** Draft [#156](https://github.com/1troitsky/photobunker-v3/pull/156) @ `db22454cca1816a473871109f5dab3d8c9337507`; включает #147–#154, фото-редактор, криптографические операции и E2E.
- **UX-реализация:** Draft [#155](https://github.com/1troitsky/photobunker-v3/pull/155) @ `d439f1b05879ad148ce03c1d5462993fc6e1fbd0` (связанный стек #146→#150→#152→#153→#155). **Реально в коде:** группы настроек, Contacts из настроек, настройка Dock, локальные предпочтения, стартовая страница, поиск по конкретным настройкам, безопасный повторный тап Dock. Нет окончательной карточки профиля, Matrix, языка, светлой темы или платежей.
- **Неприкосновенный источник:** [#138](https://github.com/1troitsky/photobunker-v3/pull/138) @ `64f415f0ce92474ecc8a8c64ddb3e7482cab2168` — **117 исходных UX-файлов** из PB2 #56, проверяемые ссылки и визуальная карта **23 HTML из `docs/_uiux/`**.
- **Исторический #139 vs #140:** исправления из актуального [#139](https://github.com/1troitsky/photobunker-v3/pull/139) @ `82c8b1e2568f89d8bfe5e68decba91956f49afa1` уже содержатся в актуальном продуктовом `FileViewerView.vue` (Ctrl/Cmd+Z внутри editor sheet) и в `p2-browser-safe-recipient.spec.ts` (явное открытие редактора). Последний #139 теперь включён в родителей интеграционного коммита; #140 и последующие PR присутствуют через #156. Редактор не заменён более старой копией.
- **Интеграция:** ветка `integration/ux-product-v51-reconciled`. Сверены **31 изменение UX + 133 изменения UX-документации**: **0 конфликтующих или пересекающихся по содержимому путей** с продуктовым HEAD. `FileViewerView.vue` и `styles.css` побайтно сохранены из #156.
- **Ручная проверка и CI:** после объединения нужны отдельные свежие TypeScript/PHP/Security, PG18/Garage/Chromium и UX source integrity/lane guard. Прохождение CI двух исходных веток **не равно** прохождению интеграционной ветки.
- **Следующие реальные GAP:** GAP-05 (Profile 1.6 WIP), GAP-10 (billing), GAP-12 (Matrix), GAP-16 (physical/mobile visual audit) остаются открыты. Для GAP-08/09 уже существует рабочая частичная интеграция, но **визуальная приёмка на устройствах не проведена**.

[Развёрнутый отчёт о проверках, происхождении файлов и запрете преждевременного merge](../audits/P2-PRODUCT-UX-V51-INTEGRATION-20261112.md).

### V52 correction to integration snapshot

The V51 snapshot above was extended with current PRODUCT **[#157](https://github.com/1troitsky/photobunker-v3/pull/157)** @ `b887a0ffc993ad21a23eee7cac0d24eb66488215`. Four V52 product paths were imported by exact blob SHA and had **zero** overlap with previous UX changes. The integration Draft **#158** now targets the V52 product branch; final combined E2E (including 54 original product cases plus five UX settings cases) is a separate gate. The original 117 PB2 UX files and 23-file map remain unchanged. See [the V51→V52 audit](../audits/P2-PRODUCT-UX-V51-INTEGRATION-20261112.md).
