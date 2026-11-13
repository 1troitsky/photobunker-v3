# PB3 — актуальная карта разработки

**Обновлено:** 2026-11-11 · **основная ветка:** `main @ 2c8ad9f6f18da9e87797d8df2cc0d6c3cf4eb7a6` · **развёртывание:** не выполнялось.

Документ служит оперативной картой, а не сертификатом безопасности. Источники требований: `ts.md`, `AGENTS.md`, исходные UX-решения и конкретные PR/CI. Архив предыдущего рубежа — [P1 Teams integration](history/2026-11-11-P1-TEAMS-INTEGRATED.md).

## Закрытый рубеж: Teams P1-27–P1-29C

**[PR #62](https://github.com/1troitsky/photobunker-v3/pull/62) слит** обычным merge с историей. Продуктовый код совпадает с независимо проверенным [#60](https://github.com/1troitsky/photobunker-v3/pull/60); стек #50→#51→#52→#53→#56→#57→#59→#60 вошёл один раз. Исторический несовместимый #54 и QA-only #55/#58/#61 **не сливались**. Evidence и независимые отчёты сохранены в `docs/audits/`.

**Exact-main CI:** [PHP8.4/8.5 + frontend](https://github.com/1troitsky/photobunker-v3/actions/runs/42898003940) **109 PHPUnit / 1807 assertions на каждой версии; Vitest 151/151; TypeScript/build PASS**. [PostgreSQL18/Garage2.5/Chromium](https://github.com/1troitsky/photobunker-v3/actions/runs/42898003754) **19/19 PASS**; [Security](https://github.com/1troitsky/photobunker-v3/actions/runs/42898003566) **PASS**. Независимый аудит [#61](https://github.com/1troitsky/photobunker-v3/pull/61) — **74/74 PASS** только в явно проверенном security/integration объёме.

**Действующие проверенные контракты:** encrypted Local-First owner Teams; подписанные v1/v2 приглашения и отдельное consent; роли и реальные ACL; исключение с quarantine, новый Team DEK и подписанные цепочки эпох; точный подписанный отзыв pending v1+v2; защита от отката epoch/revision на устройстве с сохранённым AES-GCM-кешем. Team membership **никогда не выдаёт автоматически** Media/File/Assignment DEK grants. Ранее выданный plaintext исключённому участнику не может быть отозван.

## Текущий точечный фикс: Media-grant clock boundary

- [Draft #63](https://github.com/1troitsky/photobunker-v3/pull/63): код на базе нового `main`, отдельная ветка, **ещё не слит**. Клиент при создании подписанного media grant резервирует **5 минут** от серверного лимита 24h, чтобы разница часов в миллисекунды и короткая задержка подписи не вызывали ошибку HTTP422. Серверный предел, E2EE, scope, signed bytes и неизменный Lost ACK replay **не меняются**.
- Проверенный продуктовый SHA #63: `c0e48e8eabf816d0b371cb7b77fe7a5e551cd732`; PHP 8.4/8.5 **110/110, 1817 assertions**; Vitest **154/154**; TypeScript/build, security, PostgreSQL/Garage, Chromium **19/19**, CI **3/3 PASS**. Документационный checkpoint является отдельным коммитом, его CI требуется проверять по новому HEAD.
- Это **ограниченная mitigation**, а не доказательство точной причины исторического HTTP422: часы устройства, опережающие сервер больше чем на пять минут, всё ещё могут вызвать 422. Исторический server-millisecond timestamp неизвестен. Правило server-authoritative time из `ts.md` остаётся архитектурным ориентиром для последующего улучшения.

## Дальнейшая разработка (P1–P4)

| Блок | Подтверждённое состояние / следующий шаг |
|---|---|
| Identity/Recovery, E2EE, Local-First | Основные P0/P1 сценарии в main; trusted device/cache rollback и native ещё не закрыты |
| Фото/видео/аудио, Camera/GPS | Web/Chromium production-style интеграции есть; реальный iPhone/Safari/Android NOT TESTED |
| Assignments, Media access, TTL/GC | Основные подписи/ACL и криптография в main; срок grant в #63; дальнейшие политики/архив |
| Contacts & Teams | **Интегрированы в main**, scope P1-27–P1-29C закрыт после независимого QA |
| Browser, File viewer, Edit | Полная утверждённая production версия UI/редакторов ещё не подтверждена |
| Matrix Messenger | Обязательный следующий крупный модуль, не объявлять готовым |
| Storage Manager, BYO/Replica S3 | Базовый Garage ciphertext path есть; пользовательские S3/replica/restore — впереди |
| Security/Privacy, Backup/Panic/DMS | Нужны полные runtime и восстановительные сценарии |
| Tariffs, Billing, Admin/Analytics | Дальнейшие обязательные фазы, 5 конфигурируемых тарифов по `ts.md` |
| Release security, native/device | Signed PWA, independent trust anchor, native Safari/Android, production locks NOT TESTED |

## Открытые границы и процесс

- Полный device/IndexedDB rollback и компрометированный same-origin JS: **BLOCKED BY DESIGN** без независимого trust anchor.
- Native device permissions, реальный S3 failover и production migration locks/load: **NOT TESTED**. Green Chromium ≠ Safari approval.
- Отдельный независимый Teams-wide аудит **не повторять** без конкретного нового security blocker. Обычный CI и точечные регрессии выполнять на каждом PR.
- Local agent использовать только для критического действия, которое нельзя безопасно закончить самостоятельно (например, разрешённая интеграция/выпуск). Новые функциональные ветки/PR создавать самостоятельно и **не менять main** без явного разрешения.
