# PB3 — engineering rules

## Обязательное решение владельца — 18 ноября 2026
- Текущий минимум MVP: Welcome, обычный PIN, камера с фото, Browser с фото, публичная карточка, задания с фото, настройки контактов и команд, внутренние уведомления. **Перед каждой работой с новым разделом сначала прочитать его `docs/ux` (README и исходный HTML/CSS/JS), только затем менять код.**
- **Сначала запускаемый MVP.** Приоритет — законченные пользовательские действия в одном запускаемом приложении. Не подменять реализацию новыми аудитами, отчётами, тестовой инфраструктурой и бесконечным переписыванием. Это решение меняет порядок работы, а не отменяет обязательный scope PB3.
- **Копировать готовый frontend из `docs/ux`.** Переносить утверждённые HTML/CSS и применимый код взаимодействий в Vue, сохраняя структуру, стили и поведение; заменять демонстрационные данные и обработчики реальными данными, локальным состоянием и API. Не генерировать «похожий» интерфейс и не делать редизайн. Использовать единый существующий Shell; исходные эталоны не менять. Не переносить фиктивный success или демонстрационный media/security pipeline как рабочую функцию.
- **Пиксельные проверки не нужны для выполнения этой задачи.** Не запускать и не создавать pixel-diff, геометрические прогоны, массовые скриншотные проверки или длительные полные аудиты без отдельного поручения владельца. Они не должны задерживать перенос исходного кода и выпуск запускаемого MVP.
- Проверять только необходимое для изменённого участка: сборку затронутого приложения, короткий запуск изменённого сценария и применимые проверки защиты данных при изменениях crypto/privacy/destructive логики. Не запускать полный набор проверок после каждой мелкой правки, не добавлять несвязанные тесты и не повторять успешные прогоны без новой причины. Незапущенное честно обозначать `NOT VERIFIED`; не выдавать MVP за production-ready PB3.
- Сохранять пригодный код и исправлять конкретные воспроизводимые поломки. После двух диагностированных неудач одной причины прекращать тот же цикл и менять подход. Результат работы — доступное приложение с реальными действиями и конкретный список остатка.

## Source of truth
1. Read `ts.md` for product scope, phase gates and security invariants before implementation.
2. Use PB2 `1troitsky/photobunker-new` at `319e3bdd82e4640c385b42e7f32608bdc3add880` as **read-only technical evidence**.
3. Use PR #56 at `daca24a4a38c62473859b2b54b4999d50400c491` as **read-only accepted UX evidence**, not as functioning production software.
4. New development happens only in this repository; do not merge or cherry-pick all of PB2/compat wholesale.

## Change discipline
- Develop in narrow branches and Draft PRs; **never change or merge main after the initial repository bootstrap without explicit owner instruction**.
- Prefer whole vertical user journeys (UI → domain → API → encrypted storage → retries/tests) to unrelated isolated pages.
- Display accurate status: specification / UX accepted / code written / integrated / verified / owner accepted. Never claim working security or payment flows because the screen exists.
- If the owner already decided a requirement, implement it rather than reopening it. Record truly unresolved dangerous/commercial choices as `OPEN`, feature-gate until resolved.
- Preserve stable public identifiers, ciphertext object references, key hierarchy, ACL/TTL and data during migration. Copy only reviewed code and document provenance.
- `local-first`: user interface and encrypted durable outbox must never await the network to render or discard unsynchronized data. Network success must never be simulated.
- The service cannot access plaintext media, message content, recovery keys or decrypted GPS. Admin analytics use only minimal technical/aggregate events.
- Do not run destructive database resets, cloud deletion, production key rotation, merges or deploys without explicit owner approval.

## Required production standards
- PHP **8.4.27+ and <8.5**, OR **8.5.12+ and <8.6**; Laravel **13.4+ and <14**. Stop if runtime does not meet the security floor.
- PostgreSQL 18; S3-compatible storage through a single Storage Manager abstraction.
- The current five tariff plans are **config-driven**. Operational technical rate limits are independent of entitlements and enforced by the backend.
- Every user-visible product name/mark/URL comes from BrandConfig / i18n. Repository names and legacy paths are technical only.
- P1–P4 are four mandatory phases after P0 preparation. Matrix Messenger, BYO/replica S3, administration, backup/security and signed PWA are included in PB3; IPFS is excluded.
- Service Worker integrity claims require an independent trust anchor. Never call self-verification against same-origin mutable JS a full security guarantee.
- Tests for destructive/crypto/privacy operations are safety gates, but avoid unrelated test churn and unrequested infrastructure rewrites.

## Layout (target, evolving)
- `apps/api/` — Laravel API, domain services, jobs, configuration.
- `apps/web/` — Vue 3 / TypeScript PWA with a single Fieldwork shell.
- `docs/` — architecture, ADRs, source provenance, stage gates.
- `scripts/` — tooling and reproducible validation.

## Delivery
Summarize changed files, what was verifiably checked, what remains unverified, the precise Draft PR and commit. A Draft PR is not an accepted or production-ready feature.
