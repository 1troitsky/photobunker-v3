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
| Notifications / Help | **Draft PR #296**, НЕ `main`: реальные события Media/Identity/Assignment/Team v1/v2/TTL, AES-GCM Local-First inbox, per-device ACK, актуальный ACL при клике, экран `/notifications` (Все/Непрочитанные/прочтение/опциональный Dock), frontend proxy, unit/mounted тесты; дополнительно подготовлен настоящий Chromium A→B сценарий Lost ACK, recovery, revoke, offline | **На code SHA `a17cdb30`: Foundation / Security / UX и PostgreSQL 18/Garage 2.5 / Chromium 85/85 PASS** (automated scope); Settings preferences, push, verified backup, native iOS/Android и полный S17 release всё ещё NOT ACCEPTED |
| Backup / Panic / DMS | Только backup admission/cooldown primitives | Snapshot restore, Emergency, Panic / DMS / remote wipe BLOCKED |
| Admin / Analytics / Events | Проверенные чистые RBAC/MFA / metadata / telemetry contracts | Production MFA, маршруты, аудит операций и доставка не реализованы полностью |
| PWA / release security | 32/32 unsigned integrity tests; Composer 8 matches → 0 после 5 patch updates; pnpm production audit 0 | Independent trust anchor / signed activation / cold offline bootstrap BLOCKED; Safari automation disabled |

**Локальные проверки:** PHP8.4.27 и PHP8.5.12 — 245/245 каждая; Vitest449/449, TS/build, PostgreSQL18.6/Garage2.5 и 5 quota races PASS. Финальный Chromium/CI и точный commit фиксируются в [едином QA-отчёте](docs/audits/PB3-GLOBAL-INTEGRATION-20261113.md) и в [Final validation PR #293](https://github.com/1troitsky/photobunker-v3/pull/293).

**Решение:** кодовая сборка для review, не заявление готовности PB3/P4 к релизу. `main` не обновлять без отдельной команды владельца. Подробные evidence, полный PR inventory и blocker matrix находятся в отчёте.


## Дополнение — Notifications P2 #198 (13.11.2026)

Draft [PR #296](https://github.com/1troitsky/photobunker-v3/pull/296), HEAD при записи `a1aa597b3739d2f84cf9da8e859683b9ebec7248`, base `main@6565a0fe852882ea5fc26e493df81affed687eee`. Это **отдельная ветка без merge**; исторический QA-срез выше не считать доказательством готовности новых изменений. Успешные GitHub Actions на точном HEAD: Laravel/Vue Foundation, Security, UX; PostgreSQL/Garage — **IN PROGRESS** на момент обновления. В реальной реализации есть серверные события и ACK, но **нет** полной S17 UI-integrated / physical A/B / notification push / verified backup приёмки. TTL-уведомление означает «срок хранения истёк, очистка инициирована», а не «S3 уже удалён»; ссылка на удалённый файл не выдаётся. Никогда не переносить PR в main без отдельного разрешения владельца.

### Notifications UI integration — Draft #296 (2026-11-13)

После TTL/outbox добавлена рабочая Vue-страница `/notifications`, локальные вкладки Все/Непрочитанные, открытие элемента, зашифрованное прочтение/«Прочитать все», переходы исключительно через `resolveNotificationTarget(eventId)` с серверной проверкой текущего ACL, явный офлайн-режим. `/notifications/v1` проксируется Vite на Laravel. Настройки уведомлений показаны **недоступными** — push и preference-политика пока не реализованы. Dock Notifications теперь доступен для выбора, но состав Dock по умолчанию сохранён; Messages по-прежнему скрыт. Mounted Vitest покрывает local offline/read/click/session-swap; это **не** browser/hardware acceptance. Кодовый HEAD до документации: `d69a05db7a42b26a6a1d19f72e43bb5b7a378a2b`. GitHub CI Foundation/Security/UX PASS, PostgreSQL/Garage IN PROGRESS на момент записи. `main` не менялся, merge запрещён без явного разрешения.

### Notifications real-browser QA — отдельный срез 13.11.2026

В рамках Draft PR #296 устранены две гонки при переключении аккаунта: в transport single-flight и в UI refresh. Добавлены unit/mounted тесты и Playwright `tests/e2e/p2-settings-notifications.spec.ts`, запускаемый существующим `p2-settings-*.spec.ts` шаблоном. Покрывает настоящую регистрацию A, восстановление B, чужой аккаунт C, локальное AES-GCM хранилище, Lost ACK, офлайн-прочтение, отзыв B и запрет серверного polling после revoke. **Наличие теста не считается прохождением**: подробная матрица `docs/audits/P2-NOTIFICATIONS-REAL-BROWSER-ACCEPTANCE-20261113.md`; точный code SHA `791827ecca405b075df8ecc0eb43a60672eb4e2d` имеет Foundation/Security/UX PASS, PostgreSQL/Garage still running на момент записи. Работа только в Draft, ни merge, ни изменения main не разрешены.

### Notifications real-browser acceptance — VERIFIED SHA `a17cdb30` (13.11.2026)

Старые промежуточные строки IN PROGRESS выше сохранены как исторические срезы, **текущий подтверждённый результат**: code HEAD `a17cdb3003e6f49cd78c9293818a77852229f330` — GitHub Actions Foundation `43479184949`, Security `43479184686`, UX `43479184704`, PostgreSQL/Garage/Chromium `43479184659` все **PASS**. Реальный Playwright Chromium **85/85 PASS (4.8m)**, включая A→B Notifications, Key-Only recovery, ciphertext-at-rest, Lost ACK, warm offline, revoke B и isolated account C. Подробности: `docs/audits/P2-NOTIFICATIONS-REAL-BROWSER-ACCEPTANCE-20261113.md`. **Только автоматическая приёмка проверенных сценариев**; физические устройства, push, remote inbox и verified Backup всё ещё отсутствуют. Никаких изменений `main` и разрешения на merge.

### Notifications local display preferences — Draft #296 (13.11.2026)

К ранее принятой автоматизированной доставке добавлены настоящие локальные настройки `/notifications/settings`: приглашения, сроки заданий, TTL-удаление, системные события и визуальные индикаторы; **события безопасности всегда видны**, push сознательно выключен до реализации проверенной доставки. Настройки не отменяют серверное событие или ACK и не удаляют encrypted inbox. Dexie v1→v2; preferences шифруются AES-GCM с account-scoped key/AAD и AKEK. Тесты проверяют настоящую перезагрузку Chromium, локальное сохранение, изоляцию аккаунтов, tamper rejection, состояние после смены сети. **Code HEAD `01f2d5a3462f65b93abf23daa648dc0cb361fb29`: Foundation (Laravel 8.4/8.5 и Vue/Vitest/build), Security, UX PASS; PostgreSQL 18/Garage 2.5/Chromium IN PROGRESS на момент записи.** Новую функциональность не считать полностью принятой до этого прогона; прежние 85/85 относятся к базовому коду `a17cdb30` без настроек. Работа только в Draft PR #296, `main` не менялся и merge не разрешён.

### Notifications local settings — verified Chromium 86/86 (13.11.2026)

На кодовом SHA `01f2d5a3462f65b93abf23daa648dc0cb361fb29` все 4 GitHub Actions workflows PASS: Foundation `43482531707`, Security `43482531702`, UX `43482531730`, PostgreSQL/Garage `43482531723`; Chromium **86/86 PASS (6.2m)**, включая настоящую проверку зашифрованных настроек `/notifications/settings` после перезагрузки. Это автоматизированная приёмка **именно этого SHA**.

После неё отдельными коммитами исправлены: повреждение AES-GCM preferences больше не скрывает список сохранённых уведомлений, а «Прочитать все» меняет только показанные записи, не скрытые фильтром; регрессионные тесты добавлены. Новый код HEAD до документации `fd224c1aea1e737a6014b831beb96aa902a663e4`, **полная CI-проверка дополнительных правок ещё IN PROGRESS**. Push, BackupVerified, физические iOS Safari/Android и remote E2EE inbox по-прежнему NOT ACCEPTED. Работа только в Draft PR #296, `main` не изменён.

### Notifications push trust preflight — Draft #296 (13.11.2026)

Push **не реализован и UI-переключатель выключен**: `apps/web/src/main.ts` не регистрирует Service Worker, в `apps/web/vite.config.ts` установлен `injectRegister:false`, до утверждения подписанной сборки обход этого барьера запрещён. Добавлен только узкий серверный контракт `App\\Events\\PushWakePayload`: одинаковый для всех событий `{"v":1,"action":"check-inbox"}`, без ID/имени/типа события, данных аккаунта, фото, задания, ключей или ссылок. PHPUnit проверяет точные байты и отклоняет иные формы. Кодовый HEAD контракта `4f53143cece4a330a83039347585505718a8d1f3`: Foundation/PostgreSQL CI на момент записи ещё выполняется; **нет утверждения PASS**. Отдельно нужны подписанный Service Worker, разрешение пользователя, реальные VAPID подписки, отзыв устройства/ключей/Panic и физические Safari/Android. Это preflight, не принятие всего #198. `main` не изменён, merge не разрешён.

### Notifications hardening — точный CI `fae52e19` (13.11.2026)

Подтверждён новый полный прогон для кода `fae52e196ee40f8898c4e29afad5d75b15fb1439`: Foundation run `43483933213`, Security `43483933620`, UX `43483933556`, PostgreSQL 18/Garage 2.5 run `43483933703` — все **PASS**. Chromium **86/86 PASS (4.7m)**, job `132087280352`; тесты включают исправления повреждения настроек и скрытых категорий. В более поздней Draft-ветке подготовлен только серверный `PushWakePayload` (payload constant, без транспорта); его собственный CI проверяется отдельно. Никаких push подписок, Service Worker, VAPID и мобильной приёмки на основании этого PASS не утверждать.


### Notifications: внутренний push subscription registry — Draft #296 (13.11.2026)

Продолжен узкий push preflight без Service Worker и сетевой доставки: создана миграция `notification_push_subscriptions_v1` и внутренний `PushDeviceSubscriptionRegistry`, который сохраняет endpoint/auth/p256dh только как Laravel authenticated-encrypted ciphertext, индексирует лишь SHA-256 endpoint, привязывает запись к подтверждённому аккаунту и устройству и учитывает revocation. Запрещены cross-account endpoint claims, внутренние/произвольные URL и повторная регистрация отозванного устройства; damaged ciphertext недействителен. Есть PHPUnit на регистрацию, ротацию, disable, tenant isolation, tamper, SSRF и отсутствие публичного маршрута. **Реального push пока нет**: SW по-прежнему НЕ регистрируется, VAPID sender/permission/subscription API/physical iOS+Android отсутствуют. Кодовый SHA до документации `b65226ee54a48b6e0cb637363505dc987f0df602`; его CI ещё должен завершиться до каких-либо PASS-утверждений. `main` не менялся, PR #296 остаётся Draft, #198 in-progress.


### Notifications #198: CI FAIL, security advisory #297 and push registry hardening — 13.11.2026

**Не объявлять PASS / готово к merge** для текущего кода #296: push registry SHA `b65226ee` — isolated PostgreSQL/Garage Chromium **84/86 PASS, 2 FAIL** (run `43485865252`: assignment media timeout; contributor photo submission missing element). Документальный SHA `21779343` — **84/86 PASS, 2 FAIL** (run `43485985994`: GPS assignment code absent; multi-import folder absent). Это другие файлы/модули; точная причина не установлена, чужие тесты не изменялись. На последующем code SHA `bb63ca52405ebceb676b483a89f8e20497cae43a` Laravel 8.4/8.5 CI FAIL до PHPUnit из-за нового `composer audit` advisory **CVE-2026-128083 / GHSA-63hm-g96r-2m2q**, затронут Laravel 13 до 13.40.0. Отдельная открытая **Issue #297** для приоритетной изолированной dependency security fix, без маскировки Composer audit и без merge.

В #198 Draft PR #296 отдельно улучшена внутренняя push subscription registry: идемпотентный Lost-ACK retry той же подписки без роста generation; ротация изменённых ключей; `purgeRevoked()` допускает удаление encrypted endpoint/keys только после реального revoke device и не для чужого аккаунта. **Нет подключения purge к IdentityController и нет работающего push**, публичные маршруты / SW / VAPID выключены. Появились собственные regression PHPUnit. Самый новый code SHA до документации `bb63ca52405ebceb676b483a89f8e20497cae43a`, CI не принят. Полное #198 всё ещё `in-progress`; `main` не изменён.
