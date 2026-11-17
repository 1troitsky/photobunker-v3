# PB3 — рабочие core-экраны и состояния по утверждённым HTML

Дата: 2026-11-17. База: `main` / PR #422, `6da32eca027066f47f6c5c001eb104df804f9a21`.
Продуктовый коммит: `cb22686149031523b981523905abe00073e874f1`.
Дерево `apps`: `1fb151d47bf38beb1033e0cfd42f382c0f486cb1`.
API неизменён: `5542aea51a33ef67c6589e80d5ace6e28cd5a4f6`.

## Причина и исправление

Предыдущий перенос основных экранов не охватывал все используемые панели. В приложении оставались старая форма входа, отдельные упрощённые диалоги, дополнительные технические блоки в основном потоке, другие SVG и конфликтующие старые CSS overrides. Это давало видимые отличия от принятых HTML даже при работающих доменных операциях. Здесь перенесены структура, каскад, SVG и состояния из существующих эталонов; новые дизайн-концепции не создавались.

- Welcome: все шесть слайдов, создание Recovery Key, подтверждение сохранения, восстановление и Loader. Расположение auth feedback, кнопки копирования/сохранения, отступы и поля взяты из исходного HTML. Регистрация и восстановление остаются настоящими.
- Camera: штатные Settings/Assignment sheets, исходная структура секций, кнопки, Audio stage и blind overlay. Реальные дополнительные поля подписанной политики и обязательный GPS сохранены. Обновление политик перенесено в Settings. MediaStream и зашифрованная outbox не заменялись демонстрационной моделью.
- Browser: исходные Upload/New Folder/Search/Settings, переключатели и иконки. Переименование и удаление пустой папки используют штатный bottom sheet вместо inline/system-dialog. Подтверждение удаления привязано к текущему аккаунту/устройству; смена identity отменяет запрос. Непустые папки не удаляются; ciphertext фотографий эта операция не затрагивает.
- Browser import: реальные расширенные поля, обмен, версии и синхронизация находятся в Settings. Используется один живой экземпляр каждого контрола через Teleport. Ошибки HTTPS показывают понятный текст с сохранением точного error code для отрицательных проверок. Ошибка каталога показана рядом с операцией обновления.
- Viewer: исходные Info sheet и Download popover. Cancel не экспортирует файл. Подтверждение выгрузки повторно проверяет identity и текущий blob URL; уход/смена аккаунта снимает согласие и отзывает blob. Публикация использует общий Viewer sheet с реальным просмотром safe JPEG и явным согласием.
- Устранён реальный дефект фильтра Personal: собственные локальные audio/video ошибочно исключались условием `type==='photo'`. Теперь отображаются все собственные локальные типы без signed assignment context. Облачные записи неизвестного происхождения по-прежнему не объявляются личными; права доступа не расширены.

Изменения тестов отражают реальные маршруты к перемещённым контролам и надписи эталона. Криптографические, серверные, TTL/ACL и отрицательные утверждения сохранены. Новая проверка ожидает собственный audio в Personal и по-прежнему исключает его из Assignments без доказательства задания. Проверяется Cancel удаления папки.

## Проверка относительно эталона

Источники: `docs/ux/`, [UI Shell Contract](../ux/UI-SHELL-CONTRACT.md), [исходный manifest](../ux-integration/SOURCE-MANIFEST.json). `ts.md` и 117 исходных UX-файлов не изменены. При различиях отдельных старых прототипов действует принятый единый Header/Dock.

[geometry.json](evidence/PB3-UX-STATES-20261117/geometry.json): 81 пара screenshots на 375×812, 390×844 и 1280×800; 555 anchors × 4 координаты = **2220/2220 совпадают**, exit 0. Дополнительно проверены 180 свойств стилей полей/секций Camera Assignment и Browser Settings. Их итоговая высота зависит от реальных security controls, отсутствующих в демонстрационном HTML, поэтому целая панель не объявлена пиксельно идентичной короткой имитации.

[pixel-comparison.json](evidence/PB3-UX-STATES-20261117/pixel-comparison.json): 30 статических сравнений — Welcome ×6, Loader, PIN, blind overlay и Audio stage на трёх размерах. **Все RGBA-пиксели совпадают**, exit 0. Audio сравнивается по области stage, остальные статические экраны целиком.

Для динамических кадров нормализованы только данные эталона: имена/описания/количество записей, соотношение сторон фото. Папки в reference создаются штатными кнопками оригинального HTML; лишние demo records убраны из reference. Из preview удалены toolbar/внешняя рамка. Стили эталонов не редактировались. Recovery Key и capability URL в screenshots замаскированы. Полные Camera/Browser/Viewer с живым медиа не объявляются попиксельно равными демонстрационным SVG. Непроверенные элементы не получают статус PASS из-за соседних anchors.

Визуальный сценарий действительно регистрирует аккаунт, получает Chromium MediaStream, шифрует и сохраняет снимок в IndexedDB, синхронизирует с реальными PostgreSQL/Garage, публикует safe copy и устанавливает PIN. Loader фиксируется настоящей ограниченной IDB transaction, которая не меняет данные. Команды воспроизводимы без LLM в `scripts/ux/`.

## Функциональная приёмка

Точные команды/exit codes и статусы каждого теста: [gates.json](evidence/PB3-UX-STATES-20261117/gates.json), [E2E](evidence/PB3-UX-STATES-20261117/e2e-results.json), [production E2E](evidence/PB3-UX-STATES-20261117/production-e2e.json).

- Vitest: 1020/1020, 140 файлов, exit 0.
- TypeScript и production build: exit 0.
- Node integrity/UX: 37/37, exit 0, `TMPDIR=/private/tmp`.
- Chromium development: 151/151 PASS, exit 0, 7.4 минуты, workers=1/retries=0, без skipped/flaky.
- Compiled Nginx Chromium: 10/10, exit 0; реальные camera → offline ciphertext/reload → Garage → Viewer/publication/revoke, Save/Cancel, PIN, fullscreen/landscape.
- Canonical sources: 117/117, exit 0.
- PostgreSQL 18 / Garage 2.5: реальные контейнеры, реальные ACK/object reads; mock network success не использовался.
- PHPUnit: API неизменён; локальный runtime PHP 8.4.27. 323/323 на PHP 8.4.27 и 8.5.12 — исторический результат предыдущей принятой интеграции; повтор в этом UI diff локально NOT TESTED. Текущие серверные проверки дополнительно выполняются обычным CI.

Диагностические неуспехи не выданы за успешные: предыдущие полные прогоны на `5c08164d` и `ab94673a` завершились 150/151 из-за старых DOM-ожиданий/скоупа Locator после переноса контролов. Исправлены переходы к реальным Settings/Upload, затем на `e9d3d9d` получен 151/151. Позднее дополнены Camera/Browser панели и исправлен Personal; итоговый кандидат проверяется отдельно. Первый визуальный прогон Search выявил лишний поясняющий блок (+78 px) и системный стиль checkbox; оба исправлены. Повтор уточнил оставшийся размер шрифта toggle; цикл остановлен, затем окончательная сверка выполнена на frozen compiled image. Node без `TMPDIR` отказался от symlink ancestor `/var`; проверка не отключалась, запуск повторён в настоящем `/private/tmp`, 37/37 PASS.

## Производительность

[welcome-performance.json](evidence/PB3-UX-STATES-20261117/welcome-performance.json): 5 чередующихся fresh Chromium contexts, baseline = образ PR #422, current = текущий compiled image, viewport 390×844. Медиана Welcome 67.01 → 69.42 мс; decoded resources 1,618,130 → 1,651,016 bytes. Локальное лабораторное измерение при параллельной нагрузке; не RUM, не Lighthouse, не порог производительности. Исходные дополнительные стили увеличили bundle.

## Границы результата

| Сценарий | Статус / фактическая граница |
|---|---|
| Core UI → crypto → durable outbox → API → Garage → Viewer/publication | Проверяется реальными Chromium journeys; конкретные результаты в gates |
| Native Safari 26.6.2 | NOT TESTED: запуск safaridriver отклонён automatic approval review, отдельное разрешение владельца не получено; Allow Remote Automation не менялся |
| Физические iOS/Android, hardware GPS/camera, OS save/share/install | NOT TESTED; Chromium fake MediaStream не заменяет устройства |
| Cold-offline PWA shell / signed Service Worker | BLOCKED BY DESIGN до independent trust anchor; unsigned SW не включён, compiled endpoints `/sw.js` и `/src` закрыты |
| Emergency/Panic PIN / destructive Recovery Vault | BLOCKED: полной проверенной destructive/backup цепочки нет, опасные действия feature-gated |
| Viewer Favorites / external copy / Delete | Недоступные действия не имитируют успех. Коллекция Favorites требует решения модели; delete зависит от принятых lifecycle/ACL. Рабочий Browser archive pipeline сохранён |
| Folder/assignment sharing | OPEN / DO NOT IMPLEMENT по принятому контракту; не заменено fake share |
| Matrix, billing, backup, весь PB3 | Эта поставка не объявляет их принятыми или полностью готовыми; Matrix автоматически не подключается |

## Доставка и проверка evidence

Образ web: `sha256:970a9a952080ac5e3657e91003de2bdcfb868ee072605efce96b708677f26388`. API образ прежний: `sha256:9860d784572171c443c2ebffea60ed14e911480a4c6938849b9162695edd16b1`.
После принятой интеграции основной адрес: http://127.0.0.1:5173. Web обновляется в прежнем Compose project без смены PostgreSQL/Garage volumes, credentials или очистки IndexedDB. Точный merge SHA/CI и проверка сохранности данных фиксируются delivery JSON после установки, а не предсказываются в отчёте.

`node scripts/ux/verify-core-evidence.mjs` проверяет SHA-256 всех evidence artifacts, геометрию, style contracts, 30 pixel pairs, E2E counters и неизменность 117 исходников. [manifest.json](evidence/PB3-UX-STATES-20261117/manifest.json) содержит размер и SHA-256 каждого публикуемого файла. Сырые traces, compose credentials, SQL и ключи не публикуются.
