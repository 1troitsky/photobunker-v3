# PB3 — основные сценарии, интеграция 16.11.2026

**Исходный main:** `8ed66c438d090efd218efa80b027f0b2f854db4b`. **Продуктовый кандидат:** `fbb95b1c5da8ddefeae9ea7f0c2039bed1729657`. **Единственная интеграция:** [PR #421](https://github.com/1troitsky/photobunker-v3/pull/421), включая #416–420 и защитные изменения donor `783b6a77`. Владелец разрешил обычный merge и обновление локального main. Локальная приёмка завершена: **151/151 Chromium + 10/10 compiled-image journeys, exit 0**, без skips/flaky/retries. **#421 слит обычным merge `1c8cd1967e625bf84ba86e7f8d46cfbd1d042bcc`; локальный main обновлён, Docker запущен на http://127.0.0.1:5173.** Все #416–420 включены, открытых PR 0. 1100 прежних строк в 60 таблицах сохранены.

| Направление | Реальное состояние | Граница |
|---|---|---|
| Camera / GPS / encrypted photo | Реальная камера API, JPEG, обязательная signed assignment policy, IndexedDB ciphertext, offline outbox, Garage replay/verify | Native physical iOS/Android NOT TESTED |
| Photo Browser / Viewer | Локальные и облачные фото, настоящие RAM-миниатюры, папки/поиск, reload/recovery, просмотр и возврат, отсутствие ложного ACK | Cloud thumbnails читают bounded authenticated master; dedicated thumbnail transport не добавлен |
| Public Card | Личная safe JPEG публикация, отдельный ключ/объект, anonymous read/reload, TTL/revoke, Recovery Key owner management | Assignment/bundle/video/audio и запрещающие preview policies не включаются; physical GC не заявлен |
| Welcome / Loading | Настоящая key-only регистрация/recovery, явное сохранение Recovery Key, локальная hydration независимо от online proof | OS chooser bridge tests не равны проверке physical OS picker |
| Обычный PIN | 4–8 цифр, durable lockout/sealed package, enrollment/change/disable/relock 0–5 минут, cross-tab защита | Не подменяется простым UI PIN overlay |
| Emergency PIN / Panic / Vault / DMS | Опасные кнопки отключены | BLOCKED: нет полной verified destructive/backup цепочки |
| Contacts / Teams | Signed/E2EE pipelines сохранены; исправлены busy после block и online retry Team outbox | Локальная блокировка не является серверным отзывом |
| Messages / Matrix / Notifications | Локальные encrypted drafts/inbox и текущие интерфейсы сохранены | Полная Matrix/push доставка не принята, автоматически не подключается |
| Billing / BYO / replicas / Admin | Текущие безопасные foundations/config и ограничения сохранены | Нет заявления real payments или завершения всего ts.md |
| PWA | Manifest/start URL и install guide; compiled Nginx; unsigned SW/source endpoints закрыты | Cold offline shell / independent trust anchor BLOCKED BY DESIGN |
| Документация | 117/117 canonical UX bytes сохранены; старый аудит 285 PR/130 Issues/289 веток сохранён как исторический снимок | Закрытие PR/Issue не означает owner acceptance функции |

Проверено: Vitest **1013/1013**, TypeScript/build, PHPUnit **323/323 (5136 assertions)** на PHP 8.4.27 и 8.5.12, Node integrity/UX **37/37**. Chromium **151/151** и compiled-image **10/10**, без skips/flaky/retries; результаты зафиксированы в [отчёте](docs/audits/PB3-CORE-RELEASE-INTEGRATION-20261116.md) и [evidence](docs/audits/evidence/PB3-CORE-20261116/). GitHub Actions QUEUED не выдаются за PASS. Это завершение конкретных core journeys, а не декларация полного PB3 production readiness.


### Core UX parity — 2026-11-17

Утверждённые HTML/CSS семи core экранов перенесены в продукт; 33 пары на трёх размерах, 912/912 координат, 9 статических пар без отличающихся пикселей. 1020 Vitest, TypeScript/build, 151 Chromium E2E и 10 compiled Chromium PASS. Native Safari/hardware NOT TESTED. Полный статус интеграции и границы: [отчёт](docs/audits/PB3-CORE-UX-PARITY-20261116.md).
