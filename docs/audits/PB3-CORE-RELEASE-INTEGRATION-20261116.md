# PB3 — интеграция основных пользовательских сценариев, 16.11.2026

Статус: **MERGED через #421, локальный main обновлён, Docker запущен**. Обычный merge-коммит: `1c8cd1967e625bf84ba86e7f8d46cfbd1d042bcc`. Последующий commit содержит только результаты передачи/evidence; дерево продукта остаётся тем же. Владелец прямо разрешил интеграцию в удалённый и локальный main. Проверяемый продукт: `fbb95b1c5da8ddefeae9ea7f0c2039bed1729657`, дерево `apps/`: `60d899438a4d2f98c9519749e454b2873973092d`. Исходный main: `8ed66c438d090efd218efa80b027f0b2f854db4b`. Один итоговый [PR #421](https://github.com/1troitsky/photobunker-v3/pull/421).

## Что объединено

Сохранены история и HEAD всех пяти новых PR. #419 уже содержит #416 Camera, #417 Browser/Viewer/Welcome и #418 PIN; поверх него включён #420 anonymous routing. Повторно вручную эти изменения не копировались. Добавлен проверенный donor `783b6a7757b804d06d15426de2457f94e37ca741`: logout barriers #402/#403, независимые safety regressions, поддерживаемый PHP и собранный Docker runner. Более новые экраны #412, route guards и локальные Messages сохранены. Конфликты session lifecycle разрешены с сохранением PIN и logout fences.

| PR | Включённый HEAD | Назначение |
|---|---|---|
| #416 | `bdda63cd36adac42895c65c860c7e303e2cc5e3f` | Camera 1.2 |
| #417 | `4335463ca63d406fa4e253a54da0973136b9fbd7` | Browser, Viewer, Welcome/Loader |
| #418 | `d1a8e9153ee254a88d8a38b009b5978adf6163b6` | защищённый PIN gate |
| #419 | `d3f90376fc8481220e809f883a67d425b7ac3b98` | объединённый frontend |
| #420 | `f7679c2bae116aed408d3f862523f7761a3dc103` | anonymous Public Card / install вне PIN |

[Предыдущий полный аудит](PB3-ALL-PRS-ISSUES-FRONTEND-MERGE-AUDIT-20261116.md) сохраняет 285 исторических PR, 130 Issues и 289 веток. Это исторический снимок до данного поручения, а не описание нового main. Новый снимок: [integration-pr-proof.json](evidence/PB3-CORE-20261116/integration-pr-proof.json). Архивные ветки и пользовательские данные не удаляются; force-push не применяется. Итоговое включение пяти PR выполняется одним merge-коммитом #421, без пяти повторных слияний их перекрывающихся изменений.

## Реализованные сквозные сценарии

| Сценарий | Реализация и критерий |
|---|---|
| Съёмка фото | Native getUserMedia → локальный JPEG → AES-GCM IndexedDB/outbox → реальные reserve/upload/verify/finalize → Garage. Локальная съёмка не ждёт HTTP. Проверки GPS и подписанных заданий сохранены. |
| Browser фото | Локальные и авторизованные облачные записи, папки, поиск/фильтры, миниатюры, offline queue и retry; устойчивость к замене Session той же идентичности. |
| Viewer фото | Browser → Viewer, расшифрованное изображение, reload/recovery, навигация и возврат в каталог; отказ чужому аккаунту. |
| Public Card | Реальная личная JPEG-карточка: явный review, отдельный flattened JPEG без EXIF, отдельный ключ, подписанная публикация, token/fragment, ciphertext в Garage, внешний просмотр без Identity/PIN, reload, revoke и восстановление владельца через настоящий Recovery Key. |
| Welcome | Принятые SVG/навигация, настоящая key-only регистрация и восстановление. Recovery Key сохраняется только после явного действия; закрытие OS chooser не считается подтверждением сохранения. |
| Welcome Loading | Завершение после локальной hydration; зависший online proof не блокирует сохранённые локальные данные. |
| Обычный PIN | 4–8 цифр, настоящий KDF/sealed package, durable lockout, защита между вкладками, установка/change/disable, подтверждённая задержка 0–5 минут; старый PIN после изменения не открывает данные. |
| Аварийный PIN | **BLOCKED / отключён.** Полной цепочки local wipe → server revoke → physical cloud deletion → сохранённый verified Recovery Vault нет. Intent/экран не выдаётся за уничтожение данных. |

Граница Public Card и точный протокол описаны в [ADR](../adr/2026-11-16-personal-photo-public-card.md). Включена только личная фото/JPEG-карточка. Assignment/contributor/editorial scopes, запрещающие публикацию preview-policy, bundle, video/audio и неутверждённые публичные metadata projections не обходятся и не включаются. TTL ≤ 24 часов и TTL источника; скачивание safe JPEG по умолчанию выключено. После revoke/expiry сервер отказывает в новой выдаче; ранее полученные пиксели отозвать невозможно. Физический GC публичных копий не заявлен: сохраняющийся ciphertext учитывается в квоте.

## Исправленные интеграционные дефекты

- В PIN-gated Browser Teleport списка папок искал ещё не вставленный DOM target: папка оставалась зашифрованной в IndexedDB, но не отображалась. Использован Vue deferred Teleport.
- Обновление той же Session удаляло локальные строки и закрывало открытое меню. Локальный каталог теперь сохраняется во время refresh; облачные индексы/права проверяются заново. Реальная смена аккаунта/устройства/ключей очищает прежнее состояние.
- Mutation token контактов зависел от read-generation; block/unblock вызывал reload и навсегда оставлял busy. Mutation lifecycle отделён от чтения, смена идентичности отменяет результат.
- Команда, созданная до завершения online hydration, могла остаться queued. Завершение настоящего proof той же идентичности повторно отправляет durable signed Team outbox.
- Возврат фокуса из photo share учитывает асинхронное восстановление строки и не перехватывает последующий пользовательский ввод.
- Для нового Public Card добавлены отрицательные тесты отзыва устройства/допуска аккаунта непосредственно во время storage I/O. Оба сначала получили **200 вместо 401/404**; после исправления повторная авторизация блокирует активацию/выдачу. Это deterministic backend race injection, отдельно от live Garage E2E.
- Исправлены настоящие миниатюры P1 Camera: AEAD выдавал Blob без MIME, и декодер отвергал его. JPEG codec hint задаётся только для аутентифицированного P1 master; настоящий decode/re-encode сохраняется. После Recovery Key восстановления bounded cloud previews читаются через действующую авторизацию, последовательно, в RAM, без plaintext cache. Это чтение существующего encrypted master, а не новый серверный thumbnail API; размер сетевого трафика не выдаётся за оптимизированный. Служебные пояснения не занимают обычный пустой поиск/список.
- В PIN settings закрыты повторные unlock во время атомарной замены sealed package; актуальная серверная идентичность проверяется перед change/disable. PIN/Recovery inputs очищаются при смене идентичности и unmount.

## Проверки и evidence

Фактические команды, exit codes и длительности: [local-checks.json](evidence/PB3-CORE-20261116/local-checks.json). Точные деревья и Docker image IDs: [tested-source-images.json](evidence/PB3-CORE-20261116/tested-source-images.json).

| Проверка | Результат |
|---|---|
| Vitest | **PASS — 1013/1013**, 140 файлов, exit 0 |
| TypeScript | **PASS**, exit 0 |
| Web build | **PASS**, exit 0 |
| PHPUnit PHP 8.4.27 | **PASS — 323/323, 5136 assertions**, exit 0 |
| PHPUnit PHP 8.5.12 | **PASS — 323/323, 5136 assertions**, exit 0 |
| Integrity / UX lane Node tests | **PASS — 37/37**, exit 0; реальный `/private/tmp` вместо macOS symlink-root |
| Принятые UX-источники | **PASS — 117/117** Git blob/byte matches, exit 0 |
| Сборка Docker API + Nginx web | **PASS**, exit 0 |
| Полный Chromium / PG18 / Garage | **PASS — 151/151**, 0 skipped/flaky, retries=0, exit 0; [все сценарии](evidence/PB3-CORE-20261116/chromium-acceptance.json) |
| Собранное приложение без Vite /src | **PASS — 10/10**, exit 0; [compiled acceptance](evidence/PB3-CORE-20261116/compiled-acceptance.json) |
| GitHub Actions | **BLOCKED / QUEUED**, не выдаётся за CI PASS |

Диагностические полные прогоны не скрыты: `b85516fc` 131/151; `4535fe4c` 149/151; `4cd29fdd` 148/151; `cb6f63a4` 150/151 (route handler teardown). Их результаты сохранены отдельно от окончательной приёмки. Найденные причины исправлялись до повторов; assertions не отключались, retries не добавлялись, security floor не понижался.

Дополнительно исправлен teardown fault-injection: удаление асинхронного route handler до завершения route.fetch/fulfill давало «Route is already handled». Перед сменой перехватчика ожидается завершение обработчиков; проверки 503, corrupt ciphertext, durable retry и последующего decrypt сохранены.

Ошибки QA/окружения отделены от продукта: Linux Rollup не использует macOS node_modules; Vite HMR query modules и bare /src imports могут создать две Identity singleton; старые тесты должны открывать принятые upload/member sheets; неготовая камера фокусирует безопасный Return; logout UI закрывается раньше сетевого ACK; local-first hydration заканчивается раньше фонового challenge. Native geolocation revoke выполняется отдельно от camera permission: `clearPermissions()` отзывал также камеру. Ни серверный успех, ни decrypted media не подменялись заглушкой. OS chooser bridge имеет явно обозначенный тестовый stub; это не проверка реального системного диалога.

Визуально просмотрены реальные compiled Camera/Browser/Viewer/Welcome captures; [скриншоты](evidence/PB3-CORE-20261116/visual/) используют synthetic Chromium camera. Проверены мобильные размеры 375×812, landscape 812×375 и tablet 768×1024, reduced motion и отсутствие горизонтального overflow. Полная попиксельная сверка всех состояний, light-theme/accessibility audit и owner visual acceptance **NOT VERIFIED**.

Проверка evidence без LLM: `python3 scripts/audits/verify-core-release-20261116.py --git`. Backend tests после `cb6f63a4` применимы к итоговому продукту: API tree не изменён, [доказательство](evidence/PB3-CORE-20261116/backend-tree-equivalence.json).

## Ограничения и ручная приёмка

- **NOT TESTED:** физические iPhone/iOS Safari/PWA, Android и реальные camera/GPS sensors; native Safari automation не включалась. Chromium с native browser APIs и synthetic camera device не равен physical hardware.
- **BLOCKED BY DESIGN:** cold offline reload shell, signed SW/update/rollback и independent trust anchor. SW не регистрируется; Nginx не отдаёт `/sw.js`, workbox и `/src`. Уже загруженное приложение снимает/шифрует offline; reload shell полностью без сети не объявляется работающим.
- **NOT VERIFIED:** сопоставимый performance baseline/RUM; сборка и длительность тестов не считаются доказательством ускорения.
- Matrix автоматически не подключался. Полная Matrix доставка, платежи/settlement, Backup/Panic/DMS, BYO/replicas/Admin не объявляются готовыми этим поручением. Paid retention fixtures — synthetic isolated entitlements, а не настоящая оплата.
- Тарифные и технические лимиты сохранены. Готовность данного набора сценариев не означает завершение всего `ts.md` или owner acceptance.

## Docker и локальная рабочая копия

Подготовлены Linux/arm64 образы API PHP 8.4.27 / Laravel 13.42, compiled Nginx web, PostgreSQL 18 и Garage 2.5. Полный source ZIP и image archive сопровождаются SHA256/commit manifest; пользовательские базы, объекты Garage, credentials, Recovery Keys и браузерные профили в пакет не входят.

Запуск: `docker load -i <images.tar.gz>`, распаковать полный исходный ZIP, затем `PB3_BUILD_IMAGES=0 bash local-runner/Start-PhotoBunker.command`. Адрес: `http://127.0.0.1:5173`. Для телефона требуется отдельный доверенный HTTPS origin; loopback runner не является deployment на телефон.

Существующая локальная установка использует проект `pb3-working-20261115`. При переносе в основную рабочую копию сохраняются этот project name, прежние secrets/garage config и все named volumes. До обновления сохранены приватный pg_dump и 820 ID в 25 таблицах. Новая миграция только добавляет `public_cards_v1`; старые миграции не переписываются. Результат проверки сохранности данных и нового main будет указан в итоговой передаче и package delivery manifest.

Готовый пакет этой машины: `.local-delivery/packages/PB3-Core-20261116/`. Образы `PB3-Core-linux-arm64-images.tar.gz`, SHA256 `ce667cd4a9e378b94e43d37be959beb9f228dc3bdf9d7d8ad73de9cc24709316`, успешно проверены через настоящий `docker load` (exit 0). SHA исходного ZIP, итоговый merge SHA и post-start сохранность локальных данных фиксируются в `delivery-manifest.json` рядом с пакетом: эти данные появляются после создания данного commit и не могут содержать его собственный SHA внутри себя.

## Результат интеграции и запуска

#421 слит обычным merge с родителями `8ed66c438d090efd218efa80b027f0b2f854db4b` и `a5aec39e9d4f617da2f49620469919e9c7f65e9e`. Локальная основная папка fast-forward обновлена; прежние пользовательские изменения/неотслеживаемые документы сохранены. #416–420 закрыты как уже включённые через #421, их HEAD доказанно являются предками main. Открытых PR 0; ветки не удалены. [Closure proof](evidence/PB3-CORE-20261116/integration-closure.json).

В основной папке запущены именно принятые API/Nginx image IDs, адрес **http://127.0.0.1:5173**. HTML/manifest/readyz возвращают 200; /src и /sw.js — 404. Старые PostgreSQL/Garage/API storage volumes и credentials сохранены. Сравнение всех COPY rows/columns до и после: **1100/1100 прежних строк в 60 таблицах сохранены полностью**, включая ciphertext/object references. Приватные dumps остаются вне Git и пакета. [Post-start preservation](evidence/PB3-CORE-20261116/post-start-preservation.json).

Автоматически созданные GitHub checks нового merge проверены отдельно: [фактические состояния](evidence/PB3-CORE-20261116/main-merge-github-checks.json). QUEUED не является PASS. Локальные 151+10 E2E, 1013 Vitest, оба PHPUnit и build/type gates выше являются выполненными проверками, не заменой статусов GitHub. Owner visual/hardware acceptance остаётся отдельной.
