# PB3 — единственная таблица прогресса

**Срез 13.11.2026.** Проценты не используются: реализация, тестирование и приёмка — разные состояния. `main` проверен по удалённому SHA: **`da7327b8c9c440dae3dc864b3245b9f9f4ad14eb`**. Ошибочный merge #290 (`9160cbf1…`) в нём **не достижим**, несмотря на GitHub `merged`.

Одна изолированная ветка `integration/global-acceptance-20261113` сохраняет #290 **`f4bce2e1…`** и его историю, переносит только clock-margin #63 с новыми Safe/ACL ceilings и обновляет 5 уязвимых Symfony patch-версий. #292 / Matrix / альтернативный GPS #262 не добавлены. Отдельного разрешения на merge main нет.

| Направление | Проверенный результат текущей интеграционной ветки | Осталось / статус полной функции |
|---|---|---|
| Git / интеграция | 198 PR проверены; 189 открытых: 40 уже main, 92 в истории #290, 14 content-equivalent | 43 divergent/evolved разобраны; только #63 требует узкого переноса; не сливать старые heads повторно |
| Identity / Recovery / E2EE | Реальные registration, Recovery Key A→B, negative identity, ciphertext/readback, тёплый offline | Browser Recovery Key rotation / full remote revoke не приняты; cold offline shell BLOCKED |
| Camera / GPS | Выбран #263; отрицательные #258 сохранены; JPEG / AV и GPS consent regression покрыты | Реальные сенсоры / iOS / Android NOT TESTED; AV cap 175s против 300/3000s спецификации |
| Browser / Viewer / редакторы | Реальные E2EE media, поиск 10k, пагинация, WAV trim, JPEG canvas/маски, Safe ACL, навигация | MP4 export и все codec/mobile/long-recording сценарии не приняты |
| Assignments / Contacts / Teams | Подписанные политики, multi-account ACL, grants/revoke; 5/5 настоящих PG quota races | Окончательная owner UX acceptance / native permissions NOT TESTED |
| StorageManager / Garage | Реальный S3 outage/restart, новые worker / Lost ACK, SHA readback, tombstones; непустой main→HEAD upgrade сохраняет данные | BYO / replicas / failover отсутствуют; production cleanup не включён |
| Billing / limits / TTL | 5 immutable plans; signed admission и synthetic paid/downgrade tests; clock-margin #63 восстановлен | Реальная оплата NOT TESTED; Unlimited renew / grace / backup-aware GC #203 BLOCKED |
| Messages / Matrix | В #290 Messages route отсутствует; #292 отдельно: CI 83/85, 2 FAIL Dock | Не интегрировать автоматически; Matrix A↔B / SAS / QR / escrow / Panic отдельно BLOCKED |
| Settings / Dock / Profile | Реальные Settings / Appearance / поиск / Dock, desktop и 2 mobile viewport | Финальный Profile, полный доступный Dock 6, физический телефон NOT TESTED |
| Notifications / Help | В **Draft PR #296**, не в `main`: серверные события Media/Identity/Assignment/Team v1/v2 и TTL, Local-First AES-GCM inbox, per-device ACK, click-time ACL; **экран `/notifications`** (Все/Непрочитанные, раскрытие, локальное прочтение, опциональный Dock, безопасный переход после server ACL), UI-mount тесты и Vite proxy | CI UI HEAD: Foundation/Security/UX PASS, PostgreSQL/Garage выполняется; настройки уведомлений, push, verified backup, физические мобильные A/B E2E и полная S17 приёмка **НЕ ГОТОВЫ** |
| Backup / Panic / DMS | Только backup admission/cooldown primitives | Snapshot restore, Emergency, Panic / DMS / remote wipe BLOCKED |
| Admin / Analytics / Events | Проверенные чистые RBAC/MFA / metadata / telemetry contracts | Production MFA, маршруты, аудит операций и доставка не реализованы полностью |
| PWA / release security | 32/32 unsigned integrity tests; Composer 8 matches → 0 после 5 patch updates; pnpm production audit 0 | Independent trust anchor / signed activation / cold offline bootstrap BLOCKED; Safari automation disabled |

**Локальные проверки:** PHP8.4.27 и PHP8.5.12 — 245/245 каждая; Vitest449/449, TS/build, PostgreSQL18.6/Garage2.5 и 5 quota races PASS. Финальный Chromium/CI и точный commit фиксируются в [едином QA-отчёте](docs/audits/PB3-GLOBAL-INTEGRATION-20261113.md) и в [Final validation PR #293](https://github.com/1troitsky/photobunker-v3/pull/293).

**Решение:** кодовая сборка для review, не заявление готовности PB3/P4 к релизу. `main` не обновлять без отдельной команды владельца. Подробные evidence, полный PR inventory и blocker matrix находятся в отчёте.


## Дополнение — Notifications P2 #198 (13.11.2026)

Draft [PR #296](https://github.com/1troitsky/photobunker-v3/pull/296), HEAD при записи `a1aa597b3739d2f84cf9da8e859683b9ebec7248`, base `main@6565a0fe852882ea5fc26e493df81affed687eee`. Это **отдельная ветка без merge**; исторический QA-срез выше не считать доказательством готовности новых изменений. Успешные GitHub Actions на точном HEAD: Laravel/Vue Foundation, Security, UX; PostgreSQL/Garage — **IN PROGRESS** на момент обновления. В реальной реализации есть серверные события и ACK, но **нет** полной S17 UI-integrated / physical A/B / notification push / verified backup приёмки. TTL-уведомление означает «срок хранения истёк, очистка инициирована», а не «S3 уже удалён»; ссылка на удалённый файл не выдаётся. Никогда не переносить PR в main без отдельного разрешения владельца.

### Notifications UI integration — Draft #296 (2026-11-13)

После TTL/outbox добавлена рабочая Vue-страница `/notifications`, локальные вкладки Все/Непрочитанные, открытие элемента, зашифрованное прочтение/«Прочитать все», переходы исключительно через `resolveNotificationTarget(eventId)` с серверной проверкой текущего ACL, явный офлайн-режим. `/notifications/v1` проксируется Vite на Laravel. Настройки уведомлений показаны **недоступными** — push и preference-политика пока не реализованы. Dock Notifications теперь доступен для выбора, но состав Dock по умолчанию сохранён; Messages по-прежнему скрыт. Mounted Vitest покрывает local offline/read/click/session-swap; это **не** browser/hardware acceptance. Кодовый HEAD до документации: `d69a05db7a42b26a6a1d19f72e43bb5b7a378a2b`. GitHub CI Foundation/Security/UX PASS, PostgreSQL/Garage IN PROGRESS на момент записи. `main` не менялся, merge запрещён без явного разрешения.
