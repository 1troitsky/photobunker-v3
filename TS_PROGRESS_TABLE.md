# PB3 — единственная таблица прогресса

**Срез 13.11.2026; дополнение Security #297 в отдельной Draft-ветке.** Проценты не используются: реализация, тестирование и приёмка — разные состояния. `main` проверен по удалённому SHA: **`da7327b8c9c440dae3dc864b3245b9f9f4ad14eb`**. Ошибочный merge #290 (`9160cbf1…`) в нём **не достижим**, несмотря на GitHub `merged`.

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
| Notifications / Help | Есть isolated local-inbox / Help contracts и unit tests | Нет подключённых Notifications/delivery/push; Help component не означает готовый маршрут |
| Backup / Panic / DMS | Только backup admission/cooldown primitives | Snapshot restore, Emergency, Panic / DMS / remote wipe BLOCKED |
| Admin / Analytics / Events | Проверенные чистые RBAC/MFA / metadata / telemetry contracts | Production MFA, маршруты, аудит операций и доставка не реализованы полностью |
| Laravel dependency security #297 | `main` Laravel v13.39.0 и Composer Audit FAIL; изолированная ветка `security/297-laravel-13-audit-20261113` с Composer-generated Laravel **v13.42.0**: strict validate PASS, audit **0 advisories**, PHP8.4/8.5 **245/245** each, Vitest **449/449**, Security PHP8.4/8.5 PASS | Draft [#298](https://github.com/1troitsky/photobunker-v3/pull/298) — не merged; PostgreSQL/Garage/Chromium final run на документированном HEAD проверяется отдельно; downstream #296 остаётся со старым lock до разрешённой интеграции |
| PWA / release security | 32/32 unsigned integrity tests; Composer 8 matches → 0 после 5 patch updates; pnpm production audit 0 | Independent trust anchor / signed activation / cold offline bootstrap BLOCKED; Safari automation disabled |

**Локальные проверки:** PHP8.4.27 и PHP8.5.12 — 245/245 каждая; Vitest449/449, TS/build, PostgreSQL18.6/Garage2.5 и 5 quota races PASS. Финальный Chromium/CI и точный commit фиксируются в [едином QA-отчёте](docs/audits/PB3-GLOBAL-INTEGRATION-20261113.md) и в [Final validation PR #293](https://github.com/1troitsky/photobunker-v3/pull/293).

**Решение:** кодовая сборка для review, не заявление готовности PB3/P4 к релизу. `main` не обновлять без отдельной команды владельца. Подробные evidence, полный PR inventory и blocker matrix находятся в отчёте.
