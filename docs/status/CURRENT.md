# PB3 — текущая карта прогресса

**Дата сверки:** 2026-11-10 · **состояние:** интеграционный срез P0 + P1-01…P1-26 в `main`. **Этап P1 целиком и PB3 в целом не объявлены завершёнными.**

**Источник истины:** `AGENTS.md`, `ts.md`, проверенный код `main`, GitHub CI и evidence. Для подробных спецификаций — `docs/planning/`, для QA — `docs/audits/`. Не использовать старую Draft-ветку как актуальную базу после merge.

## Текущий проверенный базис

- **`main`:** `ee0cbe6836b5359e971319dfc8ae91ef695c7d42`. [PR #46](https://github.com/1troitsky/photobunker-v3/pull/46) **merged**; безопасная последовательность agent-driven интеграции — #48 → #46 → `main`. Параллельные изменения [#45](https://github.com/1troitsky/photobunker-v3/pull/45) перенесены внутрь #46 **один раз**, отдельный повторный merge #45 не требуется.
- **Независимая локальная проверка:** [QA PR #47](https://github.com/1troitsky/photobunker-v3/pull/47) (отдельный архив свидетельств; QA-ветка сама по себе не является частью `main`). [Отчёт на точном интеграционном SHA](https://github.com/1troitsky/photobunker-v3/blob/98f2545dd70b8c03a0f13015d8d3cd9aa22f459b/docs/audits/P1-26-INDEPENDENT-INTEGRATION-AUDIT-20261110.md) — PASS в проверенном scope без подтверждённых блокеров; исходные QA harness failures сохранены.
- **Post-merge correction:** устранена гонка загрузки инструкций камеры; агент сообщает о шести дополнительных регрессионных тестах. Вновь проверен непосредственно итоговый `main`, не только Draft HEAD.
- **Exact `main` CI — 3/3 PASS:** [PHP 8.4/8.5 + frontend](https://github.com/1troitsky/photobunker-v3/actions/runs/42809384095) — **82/1383** на каждой PHP-версии, Vitest **116/116**, TypeScript и build PASS; [security/config](https://github.com/1troitsky/photobunker-v3/actions/runs/42809384089) — PASS; [PostgreSQL 18 + Garage 2.5 / Chromium](https://github.com/1troitsky/photobunker-v3/actions/runs/42809384139) — real S3/SQL smoke PASS, **17/17 E2E**.
- **Deploy:** NOT DONE. Нет подтверждения нативных Safari/iPhone/Android, производственной миграции под нагрузкой или внешнего полного криптографического аудита.

## Что действительно работает в проверенном срезе

Анонимная Identity/Recovery, клиентская E2EE-криптография, подписи/версионирование, локальный durable outbox и retry, браузерный capture фото/видео/аудио, зашифрованные личные медиа и grants, задания Fieldwork с политиками/расписанием/приватными инструкциями, confirmed Contacts → явное приглашение → accepted roster, submission A→B→A и v2 assignment-scoped grants, server-authoritative cutoffs. Отозванные / просроченные E2EE-grants не дают нового чтения, но уже скачанный plaintext невозможно «забрать обратно».

**Важная граница:** владелец задания не может удалять оригиналы исполнителя; retention tombstone не означает физический S3 GC. Отдельные v1 personal grants сохраняют собственную политику доступа. Полноценные Teams, Blacklist/revoke propagation, публичные профили/ID, редакторы и полный Browser UX **не подтверждены**.

## Постоянная карта модулей

| № | Модуль | Фактическое состояние | Проверено | Интеграция | Приоритет |
|---|---|---|---|---|---|
| 1 | Ядро: Identity / E2EE / Local-First / Recovery | Реализован проверенный P0/P1 core; trusted cold offline bootstrap ограничен архитектурой | CI + Chromium + выборочный независимый QA; native нет | В main, частично | Высокий |
| 2 | Shell / Dock / Навигация / Адаптивность | Vue shell работает; полный утверждённый Dock 1.3 и UX parity ещё не подтверждены | Частично Chromium | В main, доработка | Средний |
| 3 | Камера: фото / видео / аудио / GPS | Browser capture, capture intents и E2EE-инструкции; гонка получения инструкций исправлена при интеграции | Chromium; физические устройства NOT TESTED | В main, частично | Высокий |
| 4 | Browser / Каталог / Импорт / Синхронизация / Обмен файлами | Защищённые upload/read/grants; каталог/папки/UX целиком не готовы | CI + Chromium частично | В main, доработка | Высокий |
| 5 | Просмотр / Редактирование / Версии файлов | Media revision и подтверждённые ciphertext версии; полноценные редакторы не проверены | Частично | В main, доработка | Высокий |
| 6 | Задания / Fieldwork / Участники задания | Signed policies, schedules, retention, roster, приглашения, фото/видео/аудио v2-гранты | CI, A→B→A Chromium, независимый QA | В main, частично | Высокий |
| 7 | Контакты / Команды / Роли | Зашифрованная локальная книга контактов и explicit invites; Teams/Blacklist/server ACL ещё не реализованы | Контакты: CI/E2E; Teams: нет | Контакты в main; Teams — план | Высокий |
| 8 | Messenger / Matrix | Обязательный модуль PB3; утверждённый Beta UX не означает backend | Нет | План | P2 |
| 9 | PIN / Emergency / Dead Man's Switch / Безопасность | Полнота целевого security lifecycle не подтверждена | Частично, только foundation | План/частично | Высокий |
| 10 | Профиль / Настройки / Уведомления | Identity settings существуют; профили, privacy, notifications не завершены | Частично | План/частично | Средний |
| 11 | Storage Manager / S3 / Репликация / Backup / Восстановление | App S3/Garage и lifecycle работают; BYO S3, независимая репликация, Backup/Recovery Vault и multi-location GC не завершены | Реальный Garage CI / синтетические lifecycle тесты | В main, частично | Высокий |
| 12 | Тарифы / Квоты / Оплата | Реализованы отдельные серверные assignment quota правила; полный entitlement/payment pipeline не готов | Частично PHPUnit | План/частично | Средний |
| 13 | Administration / Analytics | Требования зафиксированы, рабочий модуль не подтверждён | Нет | План | P3/P4 |
| 14 | PWA / Кроссбраузерность / Производительность / Релиз | Chromium E2E PASS; native Safari/iPhone/Android, hardware GPS/gallery, подписанный trust bootstrap — не приняты | CI/Chromium; mobile NOT TESTED | Не готово к релизу | Высокий |

**Проценты не публикуются:** нет подтверждённого набора критериев для всех 14 модулей. «В main» — не синоним production-ready или принятого пользователем функционала.

## Открытые границы безопасности и качества

- **Trusted cold offline:** BLOCKED BY DESIGN до независимого trust anchor; нельзя выдавать обычный warm cache за cold secure boot.
- **iOS/Safari/Android:** аппаратные разрешения камеры/микрофона/GPS, OS gallery, PWA offline и capture не проверены на устройствах.
- **Schema downgrade:** в #48 добавлена fail-closed защита от удаления `assignment_id` при существующих scoped grants. Это **не доказанный полноценный rollback** production после выдачи v2.
- **Deployment / большие миграции:** locks/load, аварийное восстановление и prod окружение не тестировались.
- **Access & deletion:** запрет нового чтения не стирает ранее выданный DEK/скачанное содержимое; физическое удаление contributor-owned originals остаётся отдельной, требующей consent задачей.

## Следующий крупный шаг

От обновлённого `main` реализовывать очередные завершённые пользовательские сценарии в **новых узких Draft PR**. Приоритет: **People & Teams — server-authoritative Teams / роли / приглашения / ACL**, с независимыми подтверждениями ключей, local-first UI, негативными ACL тестами и без автоматической выдачи медиа-грантов. Далее — Profiles/Blacklist, остальные P2 user journeys и принятый Fieldwork UX. Не слить в `main` без поручения владельца/локального агента.

[Архивная запись крупного merge](history/2026-11-10-P1-MAIN-INTEGRATION-summary.md) · [План в `ts.md`](../../ts.md)
