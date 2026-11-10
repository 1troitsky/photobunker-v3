# {{APP_NAME}} — PB3 · нормативная техническая и продуктовая спецификация

**Версия документа:** `PB3-SPEC-1.0` · 9 ноября 2026 · консолидированная основа для начала разработки (два вложенных TS + проверенный PR #56 + решения владельца).  
**Продукт:** `{{APP_NAME}}` — сменяемое имя до релиза; пользовательские тексты строго через branding/i18n.  
**Репозиторий PB3:** `1troitsky/photobunker-v3` — технический GitHub slug, **не пользовательское название продукта**; наличие/доступность репозитория проверить перед первым push. В коде его путь допустим как technical configuration, не как UI copy.  
**Репозиторий-источник PB2:** `1troitsky/photobunker-new`, только read-only/reference; новая работа — отдельно, не в PR #56.  
**Backend-база:** `main@319e3bdd82e4640c385b42e7f32608bdc3add880`, каталог `apps/api/` (PB2)  
**UX-база:** [Draft PR #56](https://github.com/1troitsky/photobunker-new/pull/56), ветка `ux/fieldwork-assignments-prototype`, commit **`daca24a4a38c62473859b2b54b4999d50400c491`**, последнее утверждённое дополнение **App Appearance — Fieldwork 1.3 / Configurable Dock** (предыдущий модуль: Messages 1.1 Beta)  
**Входные файлы этой сверки:** `ts(5).md` — исходные требования владельца (особенно цены/планы), `ts-new-v1.md` — первая структурированная техническая редакция; дополнительно учтены уже согласованные поправки после них.  
**Зафиксированный scope:** полноценный Matrix E2EE-мессенджер; собственный S3 пользователя, дополнительный/резервный S3; приватная аналитика и минимальное администрирование; тарифы/технические лимиты через конфиги; Self-Auditing PWA; PHP/Laravel security floor; App Appearance 1.3. IPFS исключён.

> **Назначение:** единый нормативный baseline для реализации **PB3 в отдельном репозитории**. Это зафиксированный продуктовый scope, целевая архитектура, ограничения безопасности, этапы и критерии приёмки. Утверждённые UX-макеты в PR #56 **не равны** работающему frontend, а описанное поведение PB3 **не считается реализованным** до end-to-end проверки.
>
> **Этапов ровно четыре — P1, P2, P3, P4.** P0 — отдельная подготовка, **не пятый функциональный этап**. P4 — обязательная часть PB3, не отложенная версия. Каждый релизный критерий из §26.1 и §27.1 должен быть выполнен до заявления «PB3 готова».

## 0. Источники, приоритеты и статусы

### 0.1. Правило приоритета

1. **Актуальная исходная тарифная карта владельца в `ts(5).md`** имеет приоритет в тарифах, ценах, квотах, сроках и наличии плана **Unlimited+**. Более старые тарифные значения в PR #56 и `docs/product/BILLING-TARIFF-CONTRACT.md` считаются историческими и должны быть обновлены при реализации.
2. **PR #56** — источник принятых визуальных решений и поведения интерактивных экранов. Утверждение макета не означает существование серверной функции.
3. **PB2 `apps/api/` на указанном commit `main`** — исходная техническая база, а не старый `compat/assignment-release`. При изменении кода требуется повторное сравнение с новым `origin/main`.
4. Принятые здесь решения о **едином Recovery Key, сохранении последнего подтверждённого backup при Panic, Cloud-First + Local-First и расширяемом Storage Manager** — целевые правила PB3. Несовместимые исторические формулировки не копировать автоматически.
5. **Последние решения владельца (2026-11-09)** имеют приоритет над историческими `FUTURE`/`OPEN`: Matrix-сообщения, BYO S3, независимый резервный S3, аналитика и минимальное администрирование, configurable plans, technical limits и signed PWA включены в scope **этой PB3**. **App Appearance 1.3 / настраиваемый Dock** также принят владельцем и является нормативным UX. IPFS **исключён** из PB3 и не должен появляться даже как обязательный адаптер. 
6. **Unlimited+ включает собственный S3 и собственный Matrix-сервер** как продуктовые права из исходного TS; общие Matrix-сообщения и E2EE доступны без отдельной покупки хостинга. Точная реализация «своего Matrix-сервера» (BYO homeserver или управляемое выделенное размещение) требует отдельного решения до коммерческого запуска — не обещать неподтверждённый managed hosting.
7. Название продукта и все brand-specific пользовательские строки должны быть **переменными** (`{{APP_NAME}}`, `{{APP_SHORT_NAME}}`, `{{APP_MARK}}`, `{{APP_URL}}`), а не литералами в описаниях, шаблонах, серверных ответах, push или настройках. 
8. Пробелы и нерешённые вопросы помечены `OPEN`; предложенные здесь варианты обозначены `РЕКОМЕНДАЦИЯ`, а не выданы за согласованные владельцем решения.

### 0.2. Статусы

- `BASELINE PB2` — существует в исходниках PB2, но production-поведение не гарантировано без тестов.
- `UX ACCEPTED` — внешний вид/локальные взаимодействия утверждены в PR #56; **не** полноценный функционал.
- `UX BETA` — предварительно утверждённый дизайн; реализация соответствующего модуля может быть обязательна для PB3 (в частности Matrix Messages).
- `WIP` — промежуточный макет, требует утверждения.
- `TARGET PB3` — функция, которую необходимо реализовать и проверить.
- `FUTURE` — расширение, для которого заранее закладываются контракты, но реализация отложена.
- `OPEN` — необходимое недостающее решение; нельзя незаметно заменить его догадкой.

### 0.3. Граница PR #56

PR #56 — **пакет HTML/CSS/JS-прототипов**, продуктовых контрактов и документации. `main` и рабочий Vue runtime этим PR **не изменяются**. Макеты содержат демонстрационные данные и локальные имитации действий. Реальные платежи, межаккаунтные права, Matrix-сообщения, публичная выдача, безопасное медиа и backup не появляются автоматически после merge. Перенос каждого экрана в production — отдельная задача с проверкой на устройствах.

### 0.4. Белая маркировка и сменяемое название (обязательно)

- **Ни один пользовательский текст, экран, системное сообщение, `document.title`, PWA manifest, Web Push, email, public card, Terms, установка PWA, платёжный invoice и бэкап не должен содержать вшитое название продукта.** Все данные берутся из `BrandConfig`/i18n.
- Единая конфигурация: `APP_NAME`, `APP_SHORT_NAME`, `APP_SLUG`, `APP_MARK`, `APP_PUBLIC_URL` (`{{APP_URL}}` в документации), `APP_SUPPORT_URL`, `APP_LEGAL_NAME`, `APP_COPYRIGHT_NAME`, `APP_THEME_COLOR`, `APP_PWA_ICONS`. В этом ТЗ соответствующие значения записаны как `{{APP_NAME}}`, `{{APP_SHORT_NAME}}`, `{{APP_SLUG}}`, `{{APP_MARK}}`, `{{APP_URL}}`.
- Иконка исторического Fieldwork-макета — только эталон геометрии: в runtime это `{{APP_MARK}}`. Название в Header, Welcome, Public Card, справке и пушах — `{{APP_NAME}}`. `©` использует `{{APP_COPYRIGHT_NAME}}` и год.
- Имена технических пакетов/миграций и источников PB2 задаются отдельными **legacy-константами** и не превращаются в user-facing branding. Никакого массового переименования неизменяемых идентификаторов, чтобы не ломать подписи, шифрование, URLs публичных ресурсов и миграции.
- Новые URL/названия папок и конфигурационные значения должны ссылаться на runtime-конфиг, а не на старый домен. Подмена branding должна проверяться сборочным тестом: смена `APP_NAME`/`APP_SLUG` меняет весь пользовательский copy без изменения бизнес-логики или миграции данных.
- `{{V3_REPOSITORY}}`, `{{PB2_REPOSITORY}}`, `https://github.com/1troitsky/photobunker-new` — технические переменные **документации/миграции**, не значения для пользовательского интерфейса.

## 1. Продукт и принципы

**{{APP_NAME}}** — защищённое PWA-приложение для создания, организации, редактирования, передачи и проверки **фотографий, видео и аудио** в рамках **заданий, команд и личного рабочего пространства**. Данные шифруются на устройстве, основное хранилище — S3-совместимое облако, интерфейс работает из локального состояния. Нет обязательной привязки к телефону/email. Восстановление — через Recovery Key.

Продукт продаёт **организацию работы с материалами**, а не гигабайты как основной товар. Файлы, задания, роли, права, срок хранения, архив и восстановление — части одной системы.

**Обязательные инварианты:**

1. Один **App Shell** и единая визуальная система Fieldwork; каждый экран не изобретает собственный Header или Dock.
2. **Local-First UX**: вход в локальную оболочку, навигация, формы, черновики и доступные данные не блокируются ожиданием HTTP. При этом права на защищённый ресурс не открываются при неизвестном/отозванном доступе.
3. **Cloud-First storage**: подтверждённый облачный файл — источник долговременного хранения; локально — зашифрованный кэш и надёжная очередь ещё не отправленных файлов.
4. Сначала клиентское шифрование, затем локальная постоянная запись и/или отправка. Сервер не получает plaintext приватного медиа и чувствительных метаданных.
5. Стабильные ID сущностей не зависят от физических путей S3, имени файла, папки или устройства.
6. Любое опасное действие имеет явный intent, идемпотентность, проверку прав, прослеживаемый статус и корректный результат при retry/offline/reload.
7. **Не смешивать**: локально сохранено / отправляется / зашифровано в облаке / проверено / опубликовано / доступно из backup.
8. Версионирование фото и медиа не удаляет исходные подтверждённые данные раньше завершения безопасной замены.
9. Просроченный или отозванный доступ блокируется немедленно логически; физическая очистка выполняется отдельным надёжным lifecycle с очередями/GC.
10. Платёж не меняет безопасность E2EE и не обходит права владельца задания; тариф влияет на разрешённые квоты/функции/длительность хранения.
11. Пользовательский и резервный S3, Matrix и платёжные операторы подключаются по модульным контрактам, не требуют повторной реализации ядра. IPFS в scope PB3 отсутствует.
12. Runtime, инфраструктура и CI проверяют минимальные исправленные версии PHP/Laravel; новые релизы PWA сверяются с подписанным manifest.
13. Эксплуатационная аналитика и администрация не имеют доступа к plaintext, приватным ключам и содержимому E2EE.

## 2. Источники утверждённого интерфейса

**Дизайн-система Fieldwork по умолчанию:** фон `#121212`, Header/Dock `#181818`, поверхности `#202020`, текст светлый, акцент `#1ed760`, умеренные скругления, без самовольного синего редизайна. Светлая/системная тема и другой цвет — **пользовательская настройка**, не замена эталона по умолчанию.

| Область | Эталон PR #56 | Статус и граница |
| --- | --- | --- |
| Shell | `docs/ux/UI-SHELL-CONTRACT.md` | Нормативный UX |
| Welcome | `docs/ux/welcome/` 1.4 | UX ACCEPTED |
| Welcome Loader | `docs/ux/welcome/loader/` 1.6 | UX SELECTED |
| PIN Shell | `docs/ux/pin-shell/` 1.1 | UX ACCEPTED |
| Authorization Error | `docs/ux/authorization-error/` 1.0 | UX ACCEPTED |
| Задания / список | `docs/ux/assignments/v5/` 5.0 | UX ACCEPTED; 4.2 архив |
| Задания / редактор | `docs/ux/assignments/editor/` Media 2.2 | UX ACCEPTED |
| Browser | `docs/ux/browser/` v3 | UX ACCEPTED |
| File Viewer | `docs/ux/browser/viewer/` 1.0 | UX ACCEPTED |
| Photo Editor | `docs/ux/browser/editor/` 3.2 Fixed | UX SELECTED |
| Video & Audio Editor | `docs/ux/browser/media-editor/` 1.1 | UX ACCEPTED |
| Camera | `docs/ux/camera/` 1.2 | UX SELECTED |
| Контакты и Команды | `docs/ux/contacts-teams/` 1.1 | UX ACCEPTED |
| Settings / Profile | `docs/ux/settings-profile/` 1.6 | **WIP, НЕ финальный** |
| Оформление | `docs/ux/app-appearance/` **1.3** (настраиваемый Dock); 1.2 — сохранённый архив | **UX ACCEPTED / TARGET PB3** |
| Безопасность | `docs/ux/security-privacy/` 1.3 | UX ACCEPTED |
| Данные/хранилище | `docs/ux/data-storage/` 1.2 | UX ACCEPTED, возможны уточнения |
| Уведомления | `docs/ux/notifications/` 1.5 | UX ACCEPTED |
| Платежи/тарифы | `docs/ux/payments-tariffs/` 1.1 | UX ACCEPTED, **старые тарифные значения** |
| Web3 Checkout | `docs/ux/payments-tariffs/checkout/` 1.0 | UX ACCEPTED, платёж только демо |
| Public Card | `docs/ux/public-card/` 1.1 | UX ACCEPTED |
| Help / FAQ / Legal | `docs/ux/help-legal/` 1.0 | UI ACCEPTED, текст/политики черновик |
| Messages | `docs/ux/messages/` Fieldwork 1.1 | **UX BETA / TARGET PB3**, Matrix-транспорт обязателен |

**Нормативные файлы прототипов:** самостоятельные `accepted-*.html` сохранять как визуальный эталон, `README.md` — интерпретация поведения, `index.html + style.css + app.js` — исходный интерактивный макет. Ссылки на зафиксированный commit, не на подвижный `main`: `https://github.com/1troitsky/photobunker-new/tree/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux`. Актуальная версия оформления — `docs/ux/app-appearance/accepted-app-appearance-v1.3-standalone.html`; предыдущий HTML 1.2 не изменять.

### 2.1. Итог сверки PR #56 (HEAD)

- На 2026-11-09 PR #56 — **Draft**, `head=daca24a4a38c62473859b2b54b4999d50400c491`; последний коммит — `docs(ux): approve App Appearance 1.3 configurable Dock`, предпоследний — `Messages 1.1 Beta`. **122 изменённых файла** в PR; backend и живое Vue-приложение этим изменением не завершены.
- В актуальном `docs/ux/app-appearance/`: **1.3 — owner-approved**, архив 1.2 сохраняется, редактор Dock в утверждённом автономном HTML. Settings/Profile 1.6 по-прежнему **WIP**.
- Утверждение экрана означает **UX accepted**, но не production-ready. При переносе каждый экран должен иметь настоящий data flow, реальные API, авторизацию, постоянное состояние, обработку offline/reload, безопасные ошибки и подтверждение владельца.
- В PR старый `BILLING-TARIFF-CONTRACT.md` и Payments HTML содержат **устаревшие цены/числа**; их не переносить в тарифную модель PB3. Использовать §8 этой спецификации.
- Список UX-экранов из таблицы выше является обязательным охватом PB3 (кроме явно WIP деталей, которые нужно довести до приёмки); **никакой модуль PR #56 не становится «готов» только из-за HTML**.

## 3. Аудит реальной базы PB2 — что сохраняем и что исправляем

**Проверенный код:** `apps/api` на `main@319e3bdd`; проверен по GitHub, без локального запуска полноценного API, PostgreSQL/Garage E2E, криптографического и браузерного аудита. Не путать с более крупным, историческим `compat/assignment-release/apps/api`. Развёрнутый сервер может работать с иным набором файлов; реальный deployment нужно проверить отдельно.

### 3.1. Что уже сделано удачно

- Laravel 13 / PHP 8.4 / PostgreSQL, S3/Garage через Flysystem, отдельные Identity v2, Photo Sync, Assignments, Collaboration, Jobs.
- **Анонимный Identity v2:** server challenge/proof, подписанные операции, регистрация/восстановление через encrypted recovery envelope, доверенные устройства, отзыв и ротация ключевого материала.
- **Photo Sync:** `Reservation → ciphertext upload → checksum/size verify → Finalization`; подписи контракта, bounded manifests, AES-256-GCM framing, завернутые per-asset DEK, детерминированные приватные object keys, receipt и защита повторного выполнения.
- **Быстрые транзакции:** основная запись/проверка S3 выполняется вне транзакции БД; после подтверждения выполняется атомарный commit состояний.
- **Gallery:** cursor-based выдача до 50 фото на запрос, стабильные ID, связка с metadata/name codes.
- **TTL и физическое удаление:** scheduler `{{PB2_MAINTENANCE_COMMAND}}`, очереди `PhotoCleanupJob` / `PhotoAssetCleanupJob`, tombstones, orphan cleanup, повторные попытки и проверка отсутствия объектов. **Не удалять эти команды!** В PB2 они необходимы.
- **ACL:** разделение owner-only API и recipient-grants; доступ к чужим thumbnail ограничен, без полноценного E2EE-подтверждения production выдача закрыта.
- **Тесты:** 13 файлов Feature-тестов и отдельные Garage/PostgreSQL smoke-скрипты, CI для PHP/Vue/integration. Наличие тестов ≠ все тесты прошли.

### 3.2. Дефекты и долги (входящие задачи PB3)

| Приоритет | Где | Факт / действие |
| --- | --- | --- |
| **P0** | `apps/api/routes/web.php` | На `main@319e3bdd` есть строки с `\\App\\Http...` в исполняемом PHP-коде; двойные `\\` вне строки вызывают PHP parse error. Исправить, проверить `php -l routes/*.php` и `php artisan route:list`. |
| **P0** | CI | В PHP lint workflow перечислены `app tests database`, но не `routes`, `config`, `bootstrap`. Расширить syntax gate; убедиться, что `artisan` запускается на чистом окружении. |
| **P1** | Storage | `Storage::disk(config('photo_sync.disk'))` вызывается из `PhotoSync`, `Lifecycle`, `PhotoSyncController`, редакторов, получателя и jobs. Нужен единый `StorageManager`/контракт адаптера и реестр размещений. |
| **P1** | Quota | Один `PHOTO_ACCOUNT_QUOTA_BYTES` (по умолчанию 1 GiB), проверка использованных байтов через `SUM` на резервировании. Нет тарифного snapshot, file-count quota, backup accounting и состояния reserved bytes. |
| **P1** | Share | Межаккаунтное чтение thumbnail отключено в production защитным флагом. Полноценный grant/envelope/access lifecycle и независимую двухаккаунтную приёмку нужно завершить, не обходить feature gate. |
| **P1** | Backup/Panic | Невозможно объявить готовыми Recovery Vault, rolling backup, account restore after wipe, cloud purge preserving backup, remote wipe и Dead Man's Switch: отдельного полного pipeline в PB2 нет. |
| **P1** | Media | Контракт `photo_records`/`photo_objects` и validate сконцентрированы на фото: `master/original/metadata/thumbnail`, жёсткий лимит plaintext asset 128 MiB и TTL ≤45 дней. Для видео/аудио и 90 дней/Unlimited нужен новый контракт. |
| **P1** | Billing | Отсутствуют server entitlements, подписки, authoritative tariff metering, Web3 invoice/settlement и 5-й тариф. |
| **P1** | Public Card | В `apps/api/routes/web.php` нет полноценного автономного анонимного безопасного Public Card API по эталону 1.1. |
| **P2** | Assignments | `AssignmentController::index()` ограничивает выборку 500 без cursor; история до 10000. Нужна общая пагинация. |
| **P2** | Teams | `CollaborationController::snapshot()` выполняет вложенные запросы к участникам/контактам на команду; для больших команд/аккаунтов нужен bounded batching и индексы. |
| **P2** | Architecture | Контроллеры Identity/Collaboration/Recipient всё ещё сочетают протокол, ACL, persistence и DTO; выделить сервисы **без массовой замены работающих контрактов**. |
| **P2** | E2E/CI | При предыдущем аудите commit `915e096a` имел **failure** в CI; это историческое наблюдение, а не утверждение о CI нового head `daca24a4`. Нужна отдельная проверка актуального CI и зелёные gate-тесты. |

### 3.3. Запрет на бессмысленный rewrite

PB3 **не создаётся с нуля**. Сохраняем принятую криптографическую модель и проверенные PB2 контракты, вводим новые модули и миграции, не меняем всё сразу. `compat/assignment-release` — источник переносимого рабочего поведения и пример старых ошибок, **не новая основа**. PR #56 — источник UI, **не копировать самостоятельные демо HTML как production-взаимодействие, состояние или безопасность**.

### 3.4. Обязательный стартовый security gate

- Утверждённый audit finding о возможном parse error в `apps/api/routes/web.php` — **задача P0 на воспроизведение и исправление**, а не доказательство, что развёрнутое приложение сейчас падает: проверить файл конкретного `main` через `php -l`, затем `php artisan route:list`. Фиксировать точный результат, не перенимать подозрение без исполнения.
- CI-проверка должна включать `app`, `routes`, `config`, `bootstrap`, миграции, тесты; отдельно — чистую установку Composer, конфиг, миграции и PostgreSQL/Garage integration smoke.
- Урезанный CI/repo audit **не эквивалентен** криптоаудиту. Security-critical код PB2 переносить с контрактными регрессионными тестами, без незадокументированных переписок ключевого протокола.

## 4. Целевая архитектура PB3

### 4.1. Технологии и границы

- **Backend:** **Laravel >=13.4 <14**; **PHP >=8.4.27 <8.5 ИЛИ >=8.5.12 <8.6** (не допускать более ранние patch releases в runtime и CI); PostgreSQL 18; REST/API с версиями, ограниченные очереди, scheduler и фоновые jobs; S3/Garage как первая реализация физического хранилища. Нужные исправления PHP подтверждены security releases от 21.10.2026 — [официальный архив](https://www.php.net/archive/2026.php).
- **Composer platform constraint (обязательно):** `"php": ">=8.4.27 <8.5 || >=8.5.12 <8.6"`, `"laravel/framework": "^13.4"`; запрет запускать pipeline/deploy на менее защищённых ветках и патчах. При выходе новых security releases обновлять lockfile и runtime по проверенному security policy, не считать минимальную версию вечной.
- **Frontend:** Vue 3 + TypeScript + PWA, общий Shell, маршрутизатор и локальная модель данных. PB2 UI и compat UI используются выборочно только после сверки поведения с Fieldwork.
- **Client storage:** IndexedDB для индексов, ключевых оболочек, очередей и черновиков; OPFS/подходящее приватное хранилище для шифрованных больших media, с fallback и обработкой storage eviction.
- **Crypto:** WebCrypto/Web APIs и проверенная криптобиблиотека для поддерживаемых алгоритмов; отдельно тестируемые Crypto/Identity/Device сервисы.
- **Сеть:** same-origin HTTPS для авторизации, CSRF, защищённые сессии, серверное ограничение запросов; никаких публичных прямых S3 URL приватного медиа.
- **Платежи:** серверная биллинговая доменная модель + подключаемые Web3 `PaymentProvider` (первый кандидат DePay; NOWPayments возможен при отдельной интеграции).
- **Сообщения:** **Matrix — выбранный обязательный протокол PB3**, через отдельный `MatrixMessagingAdapter`; homeserver подключается как внешний сервис/независимый компонент, не как обязательный процесс для старта камеры и браузера. E2EE-сессии/ключи Matrix отделены от account/media ключей и безопасно привязаны к Identity.
- **Разработка и поставка:** новый независимый монорепозиторий `{{V3_REPOSITORY}}`. Ветка PB2/PR #56 остаются immutable источниками; исходники мигрируют выборочно с проверкой лицензий/диффа/тестов, ни одна старая ветка не переписывается.
- **Release trust:** подписанный release manifest, hash-верификация исполняемых ресурсов до активации PWA-обновления, защита цепочки сборки и независимый anchor для строгой проверки.
- **Эксплуатация:** отдельные internal Admin/Analytics, конфигурация тарифов и rate/resource limits; без доступа к E2EE plaintext.

### 4.1.1. Структура репозитория и границы зависимостей (целевой skeleton)

```text
apps/
  api/                # Laravel: HTTP + application + domain + infrastructure
  web/                # Vue/TS/PWA, Fieldwork Shell, offline storage, crypto client
  admin/              # изолированный админ интерфейс, без E2EE plaintext
packages/
  contracts/          # версии API schemas, shared DTO/types, permission matrix
  ui/                 # Fieldwork tokens/components, без доменной и S3 логики
  crypto/             # проверенные client-side primitives/key envelopes
  tooling/            # manifest/signing verification, import/source checks
infra/
  docker/             # воспроизводимое dev/test окружение
  deploy/             # версии runtime, секреты только из vault/CI
config/
  product/            # общие статические metadata/branding, НЕ секреты
docs/
  adr/                # решения с датой/контекстом/совместимостью
  product/            # данное TS, acceptance и тарифные условия
  ux/                 # источники принятых эталонов PR #56 (не demo runtime)
  security/           # threat model, trust boundaries, release integrity
```

**Разделение модулей:** domain/application не импортируют Vue, конкретный S3 adapter, SDK оплаты или Matrix transport. API controllers и Vue views тонкие; фактические операции — отдельные сервисы. S3 и Matrix SDK не могут блокировать старт другого модуля. В `apps/web` код E2EE/keys отделён от визуальных компонентов; не добавлять неаудированные криптопримитивы ради сокращения работы.

**Bootstrap:** `composer.lock`/package lock, Docker images и CI закрепляют исправленные patch-линии PHP, Composer/npm dependencies проходят security audit. Документация об обновлении и deploy rollback обязательна.

### 4.2. Независимые доменные модули

| Модуль | Отвечает за | Не должен отвечать за |
| --- | --- | --- |
| `Identity & Devices` | account, Recovery Key, device trust, signed challenge, session/rotation/revoke | хранение физических файлов, billing |
| `Crypto & Key Access` | ключевая иерархия, DEK envelopes, клиентские подписи, recipient grants | S3-specific операции |
| `Media & Versions` | фото/видео/аудио, assets, thumbnails, safe derivative, edits | прямой выбор S3 provider |
| `Storage Manager` | app S3 / пользовательский S3 / второй независимый S3, put/get/verify/delete, размещения, реплики, health, migration | бизнес-права на чтение, PIN, платежи |
| `Local Sync` | encrypted outbox/inbox, optimistic UI, retries, local indexes | принятие server-side quota или ACL |
| `Assignments` | задание, политика, участники, capture constraints, прогресс, lifecycle | криптография оригиналов |
| `People & Teams` | профили, контакты, блокировки, команды, приглашения/роли | автоматическое право на все фото |
| `Access & Sharing` | policy evaluation, photo scopes, envelopes, public card tokens | plaintext оригиналов на сервере |
| `Retention & GC` | authoritative deadlines, tombstones, scheduled cleanup всех locations | стихийная очистка по тарифу |
| `Backups / Recovery Vault` | проверенные snapshots, manifest, rolling pointer, restore | подмена live storage cache |
| `Security Lifecycle` | app lock, PIN, Panic, remote revoke/wipe, Dead Man's Switch | безусловное удаление recovery snapshot |
| `Billing & Entitlements` | планы, квоты, подписка, invoices, verified settlement | самовольный доступ к E2EE файлам |
| `Notifications` | события, локальные read states, push bridge, deep-links | раскрытие чувствительного содержимого push |
| `Messaging / Matrix Bridge` (**TARGET PB3**) | Matrix E2EE, личные/командные комнаты, события, вложения, delivery, encrypted outbox, multi-device recovery | ядро регистрации и фото |
| `Administration & Moderation` (**TARGET PB3**) | операционные роли, выдача тарифа, ограничение/блокировка аккаунтов/устройств/IP, audit trail | просмотр расшифрованного содержания |
| `Analytics & Observability` (**TARGET PB3**) | агрегированные метрики пользователей/использования/нагрузки и алерты | слежение за приватным контентом |
| `Operational Limits` (**TARGET PB3**) | технические лимиты скорости/частоты/размера, очереди, защита от злоупотреблений | маркетинговые тарифные квоты |
| `Release Integrity` (**TARGET PB3**) | signed manifest, SHA-256, обновления PWA, контроль релизов и rollback | обещание, что один JS в браузере удостоверяет сам себя |

### 4.3. Ключевые сущности (логические модели, не готовые миграции)

- `Account`, `AccountKeyRevision`, `RecoveryEnvelope`, `Device`, `DeviceSession`, `DeviceRevocationIntent`.
- `MediaFile` (immutable ID/type/owner), `MediaAsset` (оригинал, рабочая версия, preview, safe, thumbnail), `MediaRevision`, `MediaMetadataEnvelope`, `EditOperation`.
- `StorageProvider` (`app_s3`, `byo_s3`, `secondary_s3`), `StorageLocation` (provider, objectKey, sha256, encryptedBytes, state, verifiedAt), `StorageReplicationJob`, `StorageCredentialRef`, `StoragePolicy`, `StorageHealthEvent`.
- `Folder`, `FolderEntry`, `Tag`, `Category`, `Favorite`, `ArchiveEntry`; системные папки отдельно от пользовательских.
- `Assignment`, `AssignmentRevision`, `AssignmentMediaRule`, `AssignmentMember`, `Team`, `TeamMember`, `ContactLink`, `BlockListEntry`, `ReviewDecision`.
- `AccessGrant` (owner/recipient/scope/expiry/revocation), `WrappedAssetKey`, `PublicShare`, `SafeMediaPublication`.
- `PlanDefinition` и его версия, `Subscription`, `Entitlement`, `QuotaUsage`, `QuotaReservation`, `Invoice`, `PaymentEvent`.
- `BackupSnapshot`, `BackupObjectRef`, `BackupPointer`, `BackupUpdateQuota`, `RecoveryOperation`.
- `RetentionPolicy`, `DeletionIntent`, `Tombstone`, `CleanupJob`, `SecurityEvent`.
- `NotificationEvent`, `NotificationPreference`, `PushSubscription`; `Conversation`, `MessageEvent`, `MatrixRoomBinding`, `MatrixDeviceKeyBinding`, `MessageOutboxEvent`, `MessageReceipt` — TARGET PB3.
- `AdminActor`, `AdminRole`, `AdminGrant`, `AdminActionAudit`, `AccountRestriction`, `IpRestriction`, `DeviceRestriction`, `SuspiciousActivitySignal`.
- `UsageEvent`, `MetricAggregate`, `OperationalLimitRule`, `RateLimitCounter`, `Incident`, `ServiceHealth`.
- `ReleaseManifest`, `ReleaseSignature`, `ReleaseAssetDigest`, `ActiveClientRelease`, `ReleaseVerificationReport`.

**Правило:** технический UUID не превращать в UI UserID/NAME-ID; публичные идентификаторы и приватные ID — разные поля.

### 4.4. Storage Manager

Целевой интерфейс: `reserve`, `putStream`, `getStream`, `stat`, `verifyDigest`, `delete`, `copy/replicate`, `health`, `listPendingCleanup`. Вызовы физического диска только из `StorageManager`/адаптеров. Контроллеры работают с `MediaAssetID`, не со строкой `s3://...`.

**PB3 scope:** `AppS3Adapter` поверх Garage/Flysystem, `UserS3Adapter` для собственного S3 пользователя и `SecondaryS3Adapter` для независимого S3/резервирования и failover. Не откладывать эти два S3-адаптера до следующей версии и не включать IPFS. Без необходимости снова переписывать Gallery, Identity, Media и ACL. Один logical asset имеет 1..N физических `StorageLocation`. Проверять хеш/размер каждой копии, писать копии идемпотентно; read fallback лишь на проверенную и разрешённую локацию. Логическая операция удаления должна обработать **все** физические размещения и реплики. E2EE выполняется до передачи адаптеру.

**Миграция:** существующие `photo_objects.object_key` и ID сохраняются, получают одну начальную `StorageLocation` с текущим S3 provider. Нет массового перешифрования и копирования без необходимости.

### 4.5. Собственный, дополнительный и резервный S3 (обязательно в PB3)

1. **Основной S3 приложения:** поддерживаемый платформой провайдер и единственный по умолчанию без пользовательской настройки.
2. **BYO S3:** пользователь может подключить личный S3-совместимый endpoint и назначить его основным хранилищем либо дополнительной копией. Поддержать ввод region, bucket, endpoint, access key/secret, безопасную server-side проверку доступа и тестовый object PUT/HEAD/GET/DELETE без хранения plaintext credentials в browser storage. Секреты хранить в защищённом secrets vault/шифрованием с ротацией; ограничить endpoints против SSRF/internal network abuse.
3. **Дополнительный/резервный S3:** один или более независимых административно управляемых S3 для выбранных важных файлов и (при необходимости) Recovery Vault; отдельные failure domain/credentials, health и фоновые задания replication/repair. На пользовательском уровне можно разрешить выбор собственной второй площадки, если она явно настроена.
4. `StoragePolicy`: primary, replica targets, critical data, target replication factor, verification interval, read-failover. `StorageLocation`: `pending`, `healthy`, `degraded`, `repairing`, `deleting`, `deleted`, per-location checksum/version/verifiedAt.
5. Перед отключением/сменой основного S3 — проверенный migration / re-encryption? **Нет автоматического перешифрования** без изменения E2EE-контракта; копировать ciphertext, сверять SHA-256, атомарно переключать указатель, затем очищать прежнюю локацию по ACL/retention.
6. Отдельно различать **репликацию live ciphertext** (для доступности) и **Recovery Vault backup** (для восстановления предыдущего состояния). Нельзя называть вторую live-реплику резервной копией аккаунта после Panic.
7. TTL, пользовательское удаление и Panic обрабатывают все **live** location/replica; восстановительная точка в Recovery Vault следует собственной подтверждённой политике. Длительный outage ставит операции в retry+alert, а не делает запись якобы завершённой.
8. Учитывать encryption, quota, стоимость хранения/исходящего трафика и доступность пользовательского endpoint раздельно; что меняется в пользовательской cloud quota при BYO S3 — `OPEN`, без неявного обещания безлимита.

### 4.6. Local-First / Optimistic state

`local draft → encrypted durable outbox → queued → uploading → received → verified → finalized/ACK`. Невозможность загрузить не уничтожает исходный шифрованный материал. Операции получают `operationId`, `expectedRevision`, `idempotencyKey`. Отдельно показывать «сохранено на устройстве» и «сохранено в облаке». Возврат из камеры сразу открывает локальную карточку; синхронизация выполняется независимо от UI.

- Не блокировать оболочку на network identity при обычном открытии уже известного устройства; скрытые/закрытые ресурсы проверять корректно.
- Переживать reload, offline, внезапное закрытие вкладки, смену сети, многократный tap и параллельные вкладки.
- При конфликте серверной версии: сохранение локального черновика, понятный конфликт, детерминированная синхронизация; не заменять удалённые права оптимистической UI-моделью.
- Отдельная локальная **очередь несинхронизированных файлов**, защищённая от команды «Очистить кэш».

## 5. Key-Only Identity и криптография

### 5.1. Регистрация / восстановление

- Создание анонимного аккаунта: **без обязательного email, телефона или пользовательского пароля**.
- Генерировать **один видимый пользователю Account Recovery Key** для входа/восстановления аккаунта и ключевой иерархии. Под капотом отдельные root/device/media/backup keys; единая фраза/секрет **не означает один ключ AES для всего**.
- Сервер хранит публичные ключи и **зашифрованные конверты**, не расшифрованный Recovery Key или DEK.
- На доверенном устройстве доступно после авторизации **«Показать / Скачать ключ»**, readonly многострочное поле, **«Сохранить на устройство»** через системный выбор места и **«Скопировать»**; явное предупреждение о хранении. Ключ не помещается в URL или логи.
- Если старый ключ потерян, но устройство доверенное и авторизовано, разрешить **ротацию** с корректным созданием и сохранением нового ключа и инвалидацией старого. Подтвердить текущим PIN при его наличии.
- Потеря ключа **и всех доверенных устройств** означает невозможность восстановления.
- Новое устройство: **только через Account Recovery Key** как пользовательский способ входа, затем device proof, signed session и синхронизация ключевых конвертов/файлов. Технический device pairing, присутствующий в PB2, не должен самостоятельно открывать доступ новому устройству в PB3; альтернативный доверенный pairing-flow допускается только после отдельного решения владельца.
- Отдельные версии ключей, device revoke и аудит не должны ломать доступ к существующему backup при штатной ротации.

### 5.2. E2EE

- Фото, видео, аудио, превью, миниатюры, документы, чувствительные метаданные, личные описания и содержимое сообщений (когда модуль появится) шифровать **на клиенте**.
- Отдельный **DEK на asset/версию**; AEAD, уникальные nonce, проверяемые chunk manifests, checksum всего ciphertext, `wrappedDEK` и подписанная принадлежность owner/photo/revision/TTL.
- Сервер видит необходимые технические значения: идентификаторы, квоты, тип/размер ciphertext, состояние, сроки и разрешения. Не обещать, что сервер ничего не знает о существовании аккаунта или объёме данных.
- Репликация S3, резервирование, экспорт и публикация безопасной версии **не требуют раскрытия master key серверу**.
- Выдача участникам только по явным permission scopes и recipient key envelopes. Роль в команде **не является** автоматическим разрешением расшифровать любой файл.
- Ротация ключа не должна незаметно терять старые файлы; отзыв доступа должен блокировать будущую выдачу и пересматривать ключевые поколения при необходимости.
- Matrix-модуль PB3 не определяет единственный Account Recovery Key или первичную модель Identity: отдельный Matrix adapter и его ключевой lifecycle; никаких вторых обязательных секретных фраз для пользователя.

### 5.3. Secure Vault / Anti-Forensics (максимально практичная защита)

- Фото и записи **не сохраняются автоматически** в Camera Roll/системную медиатеку.
- Локальные постоянные файлы, thumbnails и черновики — только в зашифрованной области приложения; без OS-indexable открытых media.
- Не сохранять plaintext/секреты в `localStorage`, HTTP cache, аналитике, logs или незашифрованных временных файлах.
- Сокращать время жизни расшифрованных buffers и object URLs; очищать UI/кэш расшифрованного при lock/logout/Panic; защищать screen previews по возможностям платформы.
- Экспорт/скачивание **только по явному действию** пользователя с понятным предупреждением о выходе файла из защищённой зоны.
- Никаких внешних SDK/analytics, способных считывать секреты или media; ограничить CSP, происхождение скриптов, заголовки, third-party карты, безопасное обновление frontend.

## 6. PIN, Panic, Remote Wipe, Dead Man's Switch

### 6.1. Два PIN, одна клавиатура

- `app_pin` (необязательный) — **4–8 цифр**; повторный запрос через «Сразу» ... «5 мин».
- `emergency_pin` — другой PIN, **ровно столько же цифр**, можно создать только при включённом `app_pin`.
- Оба принимаются на **одной странице PIN Shell 1.1**, без отдельной кнопки экстренного режима. Биометрия в согласованный UX не входит.
- Отключение обычного PIN автоматически выключает аварийный **с предупреждением**. Изменение длины обычного PIN требует заново настроить аварийный.
- Не допускать равенства PIN, повторного использования небезопасных верификаторов и хранения plaintext; защитить KDF/соли, межвкладочное состояние.
- **После пяти неверных попыток — блокировка на 30 минут** (решение входного `ts.md`); счётчики должны переживать reload, не обнуляться только из-за закрытия страницы.
- Установка/изменение/отключение подтверждается через защищённый сценарий и не подменяется фронтенд-имитацией.

### 6.2. Panic / Emergency PIN — целевой сценарий

1. Пользователь вводит `emergency_pin` в обычном PIN Shell.
2. Немедленно блокируется доступ к данным, отображается нейтральный loading/lock screen. Процесс фиксирует подписанный **destructive intent** и однонаправленное состояние.
3. Локальные ключи доступа и зашифрованные рабочие данные уничтожаются идемпотентно; небезопасные расшифрованные состояния закрываются; локальная очередь соответствующего устройства аннулируется.
4. Инициируется server-side отзыв сессии/устройства и **удаление live cloud данных**, с очередями/retries и зачисткой всех физических S3 локаций. Дистанционные cloud steps имеют статусы pending/confirmed.
5. **Последний подтверждённый зашифрованный backup сохраняется в Recovery Vault**, если он существует и доступен по тарифу. Он не отображается на очищенном устройстве.
6. На экране **Authorization Error** — подтверждённая причина emergency, закрытая сессия, только ссылка Welcome. Повторное восстановление исключительно Recovery Key.

**Обязательное разделение:** `local_locked`, `local_wiped`, `server_revoked`, `cloud_delete_pending`, `cloud_deleted`, `backup_preserved`. Вызов Panic **не означает** создание нового backup и не должен задерживаться долгой сборкой backup. Регулярное резервирование производится заранее. На Free резервного облачного backup нет.

### 6.3. Remote Wipe и Device Management

- На другом устройстве владелец входит по Recovery Key и видит доверенные устройства и их статусы.
- **Отключить устройство:** немедленно аннулировать серверный доступ и сессии, зарегистрировать signed command для будущей локальной очистки; статус `revoked / wipe_pending / wipe_ack`.
- **Remote Emergency:** при наличии тарифного права (Pro/Unlimited/Unlimited+) инициировать полный server purge live data/удалённые команды, сохранив предусмотренный подтверждённый backup.
- История/receipt подписи, `operationId`, идемпотентные повторные команды. Базовый отзыв скомпрометированного устройства доступен всем тарифам как безопасность аккаунта; расширенные remote emergency/backup operations регулируются тарифом.

### 6.4. Dead Man's Switch

- Настройка **Выключено / 4 / 6 / 12 / 24 месяца** отсутствия подтверждённой активности; по умолчанию выключено.
- Независима от Panic PIN, TTL файлов и платежного grace period.
- Серверные сроки, предупреждения, возможность предотвратить срабатывание входом с доверенного устройства, идемпотентное выполнение.
- `OPEN`: должна ли финальная автоматическая операция навсегда удалять Recovery Vault или сохранять его; до утверждения не запускать необратимое удаление backup. Не выводить этот выбор из текста рекламного UI.

### 6.5. Матрица опасных операций (не смешивать доменные события)

| Операция | Локальный доступ | Live S3/реплики | Recovery Vault | Matrix |
| --- | --- | --- | --- | --- |
| Обычный выход | Закрыть сессию, очистить расшифрованные буферы; защитить локальный encrypted outbox | Без удаления | Без удаления | Закрыть сессию согласно политике |
| Очистка кэша | Только пересоздаваемый encrypted cache | Без удаления | Без удаления | Не удалять ключи/неотправленное |
| Отзыв другого устройства | Серверная блокировка немедленно; очистка устройства при подключении | Без удаления файлов аккаунта | Без удаления | Отозвать device/Matrix grants по контракту |
| Emergency PIN / Panic | Немедленный lock и уничтожение доступных локальных секретов | Удаление live данных после серверного ACK, включая реплики | **Последняя verified копия сохраняется**, если есть право/ключи | Отзыв access и зачищение локальных tokens/crypto state |
| Добровольное полное удаление аккаунта | Подтверждённая необратимая процедура | Удалить все размещения с GC | Политика отдельного явного согласия/договора, не подменять Panic | Отзыв и возможная очистка по Matrix политике |
| Истечение TTL отдельного файла | Скрыть/запретить доступ | Удаление всех live размещений | Restore не возрождает просроченный файл | Вложение не расширяет исходный TTL |

**Конфликт исходников:** утвердившийся красный текст Security UI про удаление «всех облачных данных» нельзя дословно реализовывать как уничтожение recovery-копии, пока продукт одновременно обещает её сохранение после Panic. Перед production уточнить формулировку UI. Интерфейсный макет как эталон оставлять неизменённым, исправления делать в новой версии. Offline cloud delete не считается исполненным без server ACK.

## 7. Recovery Vault, backups и квоты хранилища

### 7.1. Концепция

**Recovery Vault** — отдельная от live storage **логическая зона защищённых зашифрованных снимков**, позволяющая восстановить структуру аккаунта/ключи/данные после Panic. Пользователь видит «Резервные копии», не обязан знать внутреннюю архитектуру Vault.

- **Текущая цель: 1 логический активный backup на аккаунт** для платных тарифов. Новое обновление заменяет прежнюю точку **только после** полной записи и проверки нового поколения. Архитектура/UI допускают 2–3 копии в будущем, но сейчас тарифы не обещают 2–3 хранимые точки.
- Частота **ручных** и **автоматических** обновлений — **две независимые квоты**, если явно не утверждено иное. Каждое обновление работает с **одной** точкой восстановления.
- Backup содержит зашифрованные медиа и необходимые версионированные конверты ключей, назначения, папки, метаданные, структуру аккаунта, восстановимые настройки, разрешённые entitlement metadata и manifest.
- Backup **не является дополнительным публичным разрешением** на файл и не должен возрождать материал, удалённый владельцем или просроченный TTL. Restore проверяет retention/tombstone и текущие права.
- Обновление/restore имеют журнал, checksum, `verified_at`, idempotency и серверно подтверждённое состояние. `failed` не заменяет последний `verified`.
- Для экономии используем инкрементальную синхронизацию, reuse ciphertext и reference accounting; до подтверждения нового поколения не освобождать старые объекты.

### 7.2. Учёт занимаемого места (решение PB3)

**Backup включается в пользовательский лимит облачного хранения**, но только по **фактически дополнительно занятому объёму**. Одни и те же blob/chunks, используемые live и backup, при dedup/reference reuse считаются один раз. Независимая физическая реплика в служебный S3 резервирования не должна автоматически тарифицироваться как второй пользовательский экземпляр тех же данных, если продукт не вводит отдельную услугу.

Пример: live файлы 28,4 ГБ + уникальные данные backup 12,0 ГБ = **40,4 ГБ** занятой пользовательской квоты (без локального кэша/outbox). Выбранную конвенцию GB/GiB и учёт служебных bytes необходимо согласовать в API, UI и биллинге.

- `used_live_bytes + used_backup_unique_bytes + reserved_upload_bytes <= plan.cloud_bytes_limit`;
- одновременный лимит **количества файлов** применяется к live-медиафайлам, backup snapshot сам по себе **не считается дополнительным фото/видео/аудио**;
- локальный encrypted cache/очередь **не входят в облачную квоту** до успешного серверного сохранения;
- пересчитывать учёт после реального GC, версионирования, удаления и сборки нового backup; избегать двойного учёта deduplicated данных;
- переполнение/смена тарифа не запускает произвольное удаление содержимого backup.

### 7.3. Экран «Данные и хранилище» — Fieldwork 1.2

- Два прогресс-бара: **количество файлов** и **объём облака**; демонстрационный Go `125/250`, `15/30 ГБ`, по 50%. Для Unlimited/Unlimited+ file-count без лимита, а объём ограничен.
- **Очередь отправки**: число файлов и сумма шифрованных байтов, кнопка «Открыть очередь», возможность удаления элемента с подтверждением. Показывать прогноз заполнения облака **после** синхронизации.
- **Резервные копии:** мобильные вертикальные карточки: дата/время, размер, число файлов, ручная/автоматическая, проверено/ошибка, доступные действия восстановить/удалить; у текущей единственной точки одна карточка.
- **Управление:** «Создать резервную копию», частота доступных ручных обновлений, расписание выбора **Пн–Вс** и времени; для Unlimited+ (3 автоматических обновления в сутки) предусмотреть **до трёх времён за день**, не ломая недельный UI. По окончании лимита кнопка правильно недоступна, объяснение и дата возобновления лимита.
- **Кэш:** отдельный объём, кнопка очистки и размер «Минимальный / Авто / Максимальный». Кэш **не** включает незагруженные originals, outbox или ключи; их нельзя удалить этой кнопкой.
- Перенос данных, экспорт и удаление — отдельные страницы и согласованные опасные операции.
- **Автоматическое продление хранения** по последнему продуктовому контракту включено **системно**, без пользовательского тумблера; действует только при разрешении retention policy и тарифа. Старый чекбокс из прежнего Photo Editor требует согласования визуальной адаптации перед переносом.

### 7.4. Восстановление

`Recover account with Recovery Key → проверка восстановительного конверта → список доступных verified backups → выбор текущей единственной точки → загрузка ciphertext → клиентская проверка и расшифрование → восстановление локального индекса → восстановление допустимых live файлов/метаданных → новый trusted device/session → resume sync`.

Отдельно сценарии «восстановить файлы в существующем аккаунте» и «восстановить доступ после Panic». Пользователь видит, что будет объединено/заменено, и подтверждает опасную замену. Текущий backup является независимой записью от Live Storage, поэтому Panic не удаляет указатель/конверт восстановления.

## 8. Тарифная карта PB3 — **ПРИОРИТЕТНЫЕ ЗНАЧЕНИЯ ВЛАДЕЛЬЦА**

Этот раздел **заменяет** тарифную матрицу из PR #56 и старого `BILLING-TARIFF-CONTRACT.md`. В том числе меняет Go/Pro/Unlimited, добавляет **Unlimited+**. Цены и права должны существовать в версионированном **серверном** `PlanDefinition`; HTML-числа служат лишь отображением.

### 8.1. Возможности и ограничения

| Право / параметр | Free | Go | Pro | Unlimited | Unlimited+ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Цена за месяц (USD) | $0 | **$15** | **$30** | **$50** | **$100** |
| Новые задания / месяц | **3** | **30** | **100** | ∞ | ∞ |
| Максимум одновременно хранимых медиафайлов | **50** | **250** | **2 000** | ∞ | ∞ |
| Зашифрованное облако | **1 ГБ** | **30 ГБ** | **200 ГБ** | **500 ГБ** | **1 ТБ** |
| Максимальный срок файла | **14 дней** | **30 дней** | **90 дней** | Пока план активен, с учётом правил задания | То же |
| Ручные обновления backup / неделю | **0** | **4** | **7** | ∞ | ∞ |
| Автоматические обновления backup | **Нет** | **2 в неделю** | **5 в неделю**, по умолчанию будни (можно перенастроить) | **1 в день** | **3 в день** |
| Зашифрованный cloud backup | Нет | Да | Да | Да | Да |
| Emergency PIN / локальная защита | Да | Да | Да | Да | Да |
| Panic с сохранением verified backup | Нет backup | Если существует | Да, если существует | Да, если существует | Да, если существует |
| Расширенный Remote Emergency/Backup | Нет | Нет | **Да** | **Да** | **Да** |
| Внутренний grace period после окончания оплаченного плана | — | **15 дней** | **30 дней** | **60 дней** | **90 дней** |
| Приоритетная поддержка | Нет | Нет | Нет | Да | Да |
| Matrix E2EE-мессенджер через сервер приложения | Да | Да | Да | Да | Да |
| Собственный Matrix-сервер (тарифное право) | Нет | Нет | Нет | Нет | **Да** — способ предоставления см. ниже |
| Собственный пользовательский S3 / BYO endpoint | Нет | Нет | Нет | Нет | **Да** |
| Дополнительный пользовательский S3 (как primary/secondary) | Нет | Нет | Нет | Нет | **Да** |
| Резервирование хранилища ПЛАТФОРМОЙ (инфраструктура, не пользовательский тариф) | Безопасное, по общей политике платформы | То же | То же | То же | То же |

**Подсчёт:** лимит по числу файлов **И** лимит по байтам — независимые ограничения; при достижении любого новые cloud uploads блокируются без удаления существующих файлов. Одна фотография с оригиналом, thumbnail и safe-версией — **1 пользовательский media file**, байты всех дополнительных физических вариантов учитываются по фактическому уникальному объёму. Созданное задание занимает месячную квоту, даже если позже удалено. Цели количества медиа в задании **не** являются лимитом загрузки.

**Free:** отсутствие облачных backup не отменяет шифрование и Emergency PIN; после Panic восстановление из несуществующего backup не предлагается. Не обещать локальную/облачную копию без её подтверждения.

**Unlimited+:** сохраняет права Unlimited, добавляя 1 ТБ вместо 500 ГБ, 3 автообновления в день, 90-дневный grace, собственный S3 и собственный Matrix-сервер. Тарифная возможность **должна быть реализована в PB3**, нельзя заменить её меткой `FUTURE`. «Свой Matrix-сервер» в исходном TS не уточняет эксплуатационную модель: *минимально* проектировать безопасное подключение совместимого пользовательского homeserver, но **не обещать** автоматически выделенный управляемый сервер без отдельного решения владельца. Общие Matrix-сообщения не требуют Unlimited+.

**BYO S3:** пользователь задаёт S3-совместимый endpoint, bucket и права через UI; для Unlimited+ предусмотрен выбор собственного S3 как основного и/или дополнительного. **Серверная резервная инфраструктура приложения** — мера доступности для всех и не подменяет коммерческое право на собственный S3. Учитывать объём с учётом выбранной физической модели после решения об атрибуции BYO bytes; до этого тарифная квота не обходится.

**Значение «Max Backup/week»:** 4 (Go), 7 (Pro) трактуются как ручные лимиты, а отдельно указанные Auto-backup — независимая автоматическая квота; это интерпретация, а не доказанное автором исходной карты определение. Реализация product accounting должна допускать конфигурируемую модель, а публичный текст окончательно подтвердить до оплаты.

**Не менять тарифные значения:** итоговый config registry и API берут точные значения из таблицы; старые UX demo $20 Go, 20/50 заданий и 1 ТБ Unlimited не являются актуальными. Семантика 4/7 обновлений остаётся явно отмеченной как решение перед биллингом.

### 8.2. Платёжные периоды (из указанных скидок)

| План | 1 месяц | 6 месяцев | 12 месяцев |
| --- | ---: | ---: | ---: |
| Free | $0 | — | — |
| Go | **$15** | **$81** (−10%) | **$153** (−15%) |
| Pro | **$30** | **$153** (−15%) | **$288** (−20%) |
| Unlimited | **$50** | **$240** (−20%) | **$420** (−30%) |
| Unlimited+ | **$100** | **$480** (−20%) | **$840** (−30%) |

*Период = месячная цена × число месяцев × (1 − скидка). USD — единица расчёта заказа. Реальная сумма токенов, комиссии, курсовая фиксация и налоги определяются подтверждённым серверным quote/провайдером; пока не утверждены.*

### 8.3. Серверный учёт тарифа

- **Источник планов — конфиг** `config/plans.php` + версионированные snapshots и административные overrides. Правка одного источника обновляет публичную таблицу API/UX/price calculator/entitlement policy, не требует ручного изменения строк в контроллерах.
- `PlanDefinition` с версией и effective date. Никогда не доверять тарифу из клиента или старого `payments/catalog.ts`.
- `QuotaUsage`: задания за расчётный период, active media count, live + backup occupied bytes, reserved bytes; защита race между параллельными uploads.
- `Subscription`: оплачено до, статус, grace_deadline, downgrade deadline, effective plan и история переходов.
- Восстановление подписки из grace возвращает права без повторного создания или удаления уже защищённых файлов.
- **Downgrade:** существующие превышающие квоту данные не уничтожаются сразу; исходный продуктовый контракт предлагает **15 дней** на безопасный экспорт/приведение к лимиту. Точный процесс уничтожения после grace — `OPEN`, требует решения и уведомления.
- **TTL задания и файла имеют приоритет**: grace оплаты не оживляет просроченные файлы.
- Для Free нет даты окончания оплаченного плана; не приписывать Free коммерческий 15-дневный grace из исторического документа без контекста.
- В UI показывать текущий план, дедлайн, использование, прогноз, цену периода, льготу и реальные права; при превышении квоты — отдельное понятное состояние.

## 9. Web3-платежи и биллинг

- `Payments & Tariffs Fieldwork 1.1` сохранить как визуальную основу: текущий план, сравнение, 1/6/12 месяцев, продление/смена, история. **Перед переносом заменить старые цифры на таблицы раздела 8 и добавить Unlimited+**.
- `Web3 Checkout 1.0`: отдельная страница заказа с тем же Shell, изменение выбранного плана/периода, итог USD, выбор платёжного провайдера. Первый кандидат **DePay**, резервный/дополнительный кандидат NOWPayments или другой Web3-провайдер. Нельзя навечно привязывать домен к DePay.
- Состояния `draft → quoted → pending → confirmed | failed | expired | cancelled`; отдельная обработка partial/overpayment, delayed settlement и неопределённых результатов. Не активировать подписку по frontend click, redirect или сообщению кошелька.
- Сервер формирует **immutable Invoice/Quote** с plan version, периодом, скидкой, валютой/суммой, expiry и idempotency key. Проверяет фактический платеж/адрес назначения, chain, token, подтверждения, callback signatures и replay.
- **Только серверно подтверждённый settlement** активирует entitlement; подписка и квота меняются атомарно с бухгалтерским ledger/event.
- История с датой, планом, оплатой и статусом, не раскрывающая приватные E2EE-секреты.
- `OPEN`: окончательный провайдер, сеть и токены, комиссии, возврат, налоги, автопродление подписки, coupons/trial, prorating и дата начала нового периода. Эти вопросы не подменять демо-текстом.

## 10. Retention / TTL / архив / безопасное удаление

### 10.1. Дедлайны

- Поля: `captured_at`, `file_expires_at`, `assignment_start`, `assignment_end`, `assignment_files_delete_at`, `assignment_delete_at`, `plan_retention_cap`, `grace_deadline`, `public_link_expires_at`, `archive_delete_at`.
- Срок хранения определяется **наиболее строгим применимым подтверждённым правилом** (владелец/задание/тариф/публичная ссылка). Дата окончания задания и дата уничтожения файла — **разные события**.
- Предварительный capture допускает фотографии/видео/аудио только в типах, разрешённых заданием, и по `beforeStart/afterFinish` rules.
- Старый backend допускает до 45 дней; PB3 должен мигрировать протокол на **14 / 30 / 90 дней / Unlimited**, не путём одного только изменения текстов UI.
- В исходном `ts(5).md` перечислены короткие варианты автоудаления камеры: **1 час / 3 часа / 12 часов / 24 часа / 5 / 7 / 14 / 21 / 30 дней / произвольно**. Это **историческое требование**, не подтверждённый готовый UX Camera 1.2: PB2 сейчас допускает минимально 24 часа. Не терять потребность в коротком TTL; перед реализацией определить единый **допустимый minimum TTL** по типу, тарифу и политике задания, а UX выбора согласовать с принятым Fieldwork, без обхода строгого серверного лимита.
- Системное автопродление — в рамках доступного оплаченного права и правил задания, не продлевает запрет пользователя/явный TTL/чужой файл. Не менять immutable `expires_at` скрыто: versioned entitlement revision и серверные подтверждения.
- Публичная ссылка имеет `share_expires_at <= действительный file/assignment TTL`, отзыв немедленно блокирует публикацию.
- Свои deadline/expiry каждого типа работают на авторитетном серверном времени; камера сохраняет локальный capturedAt с механизмом проверки офлайн-ограничений.

### 10.2. Browser Archive

- Browser v3 имеет настройку **«Использовать архив»**, по умолчанию включена, и **«Автоудаление из архива через 7 дней»** — по умолчанию включена.
- При обычном удалении помещать материал в архив; из архива — окончательно удалять с подтверждением. При отключённом архиве удаление сразу необратимо (в рамках подтверждённого процесса).
- Архивный срок **не продлевает** действительный file TTL или автоматическое удаление задания; если более ранний TTL наступил, архивная запись не возобновляет права.
- Скрытие вкладки Архив **не уничтожает** уже архивированные файлы без отдельного решения/подтверждения.
- Системные папки и папки заданий не переименовывать/удалять обычными Browser-операциями.

### 10.3. Cleanup lifecycle

`active → expired/revoked/archived_delete → logically inaccessible → tombstone → queued physical delete (all StorageLocation) → verified absent → clean database metadata`. Scheduler и GC **оставить и развивать**, а не удалить. Ошибки/delete retry отражать в системном состоянии и операционном журнале, без раскрытия ключей/секретов. Инвариант: нельзя удалить ссылку на ciphertext до подтверждённой физической очистки, если это разрушает возможность повторить GC.

## 11. Assignments — Fieldwork 5.0 + Editor Media 2.2

### 11.1. Список заданий

- Заголовок **«Задания»**, компактные счётчики **Всего / Активных / Готово** справа на одной тёмной поверхности.
- Фильтры **Активные / Архив / Все**, поиск по имени/описанию/команде/ID/типу медиа; сортировки по созданию, изменению, количеству материалов, ближайшему окончанию.
- Карточка: иконка 43×43 (без большой обложки), название, статус, участники, команда, краткое описание, начало/окончание/длительность, отдельные сроки автоудаления, прогресс.
- По разрешениям: открыть, редактировать, дублировать, завершить/возобновить, архивировать/удалить; кнопки **«Снимать / Записать»** и Browser.
- **Фото/Видео/Аудио независимо**: показывать `факт/цель`, если цель задана; без цели — только факт. Общий прогресс `Σ min(факт,цель) / Σ цель × 100%` **только для целевых типов**; если целей нет, общий процент отсутствует.
- «Цель» не ограничивает количество загружаемых материалов. Считать только авторизованные и подтверждённые server receipts; локальные pending показывать отдельно.
- `OPEN UX`: у списка 5.0 есть локальная панель деталей, но полноценный отдельный утверждённый экран **Assignment Detail** отсутствует — нужен отдельный эталон до финального production переноса.

### 11.2. Редактор задания — четыре вкладки

**Основное**

- Название, инструкции; начало «сейчас» по умолчанию; окончание необязательно (если установлено, позже начала).
- Отдельные запреты: добавлять до начала, добавлять после окончания (оба OFF по умолчанию).
- Автоудаление **файлов** (выкл. по умолчанию) с датой; автоудаление **задания** (выкл.) с отдельной датой и переключателем **«Удалить также файлы задания»**.
- Если окончание отсутствует, эффективное завершение в UI — ближайшая из активных дат автоматического удаления; если окончание задано, удаление не может быть раньше него. Нельзя путать состояние «завершено» с физическим удалением.

**Файлы** (внутри секция «Камера»)

- Выбор пресета и переход в Camera Settings.
- Три независимых разрешённых типа: фото, видео, аудио; хотя бы один обязательно включён.
- Необязательные цели: **Фото 1–9999**, **Видео/Аудио 1–999**; поля после названия типа и пояснения «Только для прогресса».
- Отдельные инструкции/список ожидаемых файлов для каждого разрешённого типа; пресет не отменяет ограничений задания.

**Участники**

- Выбор команды из существующих, отдельная текстовая ссылка на настройки команд.
- Участники: небольшие аватары, `@username` или `#ID`, роль и photo/file access scope в контекстном меню.
- Добавление через **Контакты / Поиск**, строки результатов в отдельных прямоугольных карточках, без скрытых серверных полномочий.

**Правила**

- NAME-ID в имени (по умолчанию ON), импорт медиа с устройства/HTTPS по разрешению (ON).
- Обязательная категория, список разрешённых категорий; обязательные теги/перечень; обязательное описание с минимальной длиной; обязательный GPS — независимые настройки (по умолчанию OFF).
- Разрешение редактирования файлов (ON), зависимое «Сохранять оригинал» (по умолчанию OFF), удаление оригинала по праву; редактирование не даёт доступа к чужим личным файлам.
- Просмотр (ON), зависимый режим «только миниатюры»; передача (ON), ограничения «только участникам» (ON) и «только кураторам» (OFF).
- **Public Card** в конце вкладки Правила после передачи: разрешено по умолчанию; разрешённые поля — Автор/Команда OFF, Дата добавления OFF, Дата изменения OFF, **GPS ON**, **Описание ON**, Теги OFF, Метаданные OFF. Это *потолок* будущей публичной видимости, **не автоматическая публикация**.
- Сохранение созданий/изменений — явно подтверждаемая доменная операция, с проверкой ревизии. UX редактора 2.2 не должен быть незаметно заменён autosave старой production-формы.

### 11.3. Политика работы с заданиями

- Владелец, Куратор, Исполнитель, Наблюдатель; дополнительно account/device/team binding и операция конкретного файла.
- Команда/контакт сам по себе **не даёт** права просматривать ciphertext/DEK. Роль+состояние задания+scope+grant+TTL должны быть разрешены в server Access Policy и клиентском key exchange.
- Участник не может удалять чужие личные локальные копии; удаление задания не должно тихо удалять данные участников вне его authority.
- Создание, изменение, дублирование, назначение команды, приглашение, отзыв, переходы состояния и review имеют журнал операций и уведомления.
- Дата и типы съемки проверяются **по подписанной версии политики задания**, а не по редактируемому клиентскому тексту.

## 12. Browser v3 — каталог, загрузка, поиск, архив

- Переключения **Все / Мои фото / Задания / Архив**, виды **Сетка / Список / Дерево**; по умолчанию демо — список.
- Одна иерархия папок; прозрачная breadcrumb-строка и back; системные папки (включая задания) защищены от переименования/удаления.
- Фото — изображения миниатюр, видео — значок видеокамеры, аудио — ноты; папки — 2×2 коллаж до четырёх доступных превью + маркер папки.
- Контекстное меню **•••** у элементов во всех видах; создание корневых/вложенных пользовательских папок, переименование/перемещение/удаление по праву.
- Загрузка **с устройства** (фото/видео/аудио, множественный выбор, drag/drop) и **по прямой HTTPS-ссылке**; по умолчанию открытая папка назначения; для назначения в задание обязательна его политика.
- Демонстрационные 100 МБ из HTML не становятся глобальным лимитом backend; лимит зависит от типа медиа, устройства, тарифа и server validation.
- Поиск: **Все файлы / Фото / Видео / Аудио**, текущая/выбранная/все папки; server cursor + local index с устойчивой синхронизацией.
- Массовые действия: выбрать/выбрать всё/отменить; добавить теги, заменить все, удалить выбранные; назначить категорию; переместить/архивировать/удалить в пределах прав.
- Сортировки: новые/старые/название/ближайший TTL/последнее изменение; **папки сверху** и **оставшиеся дни** — предпочтения представления.
- Избранное — системная виртуальная подборка без физического копирования медиа и дублирования ключей (`РЕКОМЕНДАЦИЯ`: виртуальная папка/метка с сохранённым пользовательским membership).
- Поделиться фото/несколькими файлами/всем заданием — запланированная точка входа; **общий механизм мультифайлового шаринга ещё OPEN**, см. `SHARING-OPEN-QUESTIONS.md`. Не выдавать существующие Public Cards за готовую передачу целого задания.

## 13. File Viewer, Photo Editor, Video & Audio Editor

### 13.1. File Viewer 1.0

- Общая **фиксированная медиасцена** для фото/видео/аудио, contain без скачков Header/Dock/метаданных при переходе; одинаковая позиция элементов при смене файлов.
- Фото: масштабирование/fullscreen, свайп влево/вправо для соседних фото, свайп вверх/вниз для выхода из fullscreen; поддержка back/клавиатуры и reduced motion.
- Видео: play/pause/seek/fullscreen, длительность, просмотр интервала, остановка прежнего видео при листании; возможность создать **стоп-кадр**.
- Аудио: player, таймлайн, волновое представление, play/pause; при смене файла прекращать фоновые звуки.
- Header actions: **Избранное**, **Копировать** (сжатое фото или кадр видео; для аудио недоступно), **Скачать** через подтверждение, **Удалить** с подтверждением.
- Блок информации: **полное описание сначала**, затем NAME-ID, тип/формат, категория, автор, даты, TTL, разрешённые метаданные и характеристики.
- Информация/редактирование — bottom sheets/переход в соответствующий отдельный редактор; Public Card preview — in-app browser, не публичная выдача по умолчанию.
- Копирование/скачивание/экспорт только разрешённых scopes, safe versions, без утечки original/EXIF.

### 13.2. Photo Editor 3.2 Fixed

Три вкладки **Информация / Фото / Проверка**, сохранение/отмена и breadcrumb **Browser › задание › файл**. Кнопка Save неактивна без изменений; возврат и отмена защищают черновик.

**Информация:** название (обязательно), описание, координаты + карта, одна категория, редактируемые теги через общий picker/chips, принадлежность заданию (смена с отдельным подтверждением), дата удаления и максимальная дата по тарифу, Public Card и разрешённые поля. Старый UI чекбокса автопродления согласовать с новой системной политикой без пользовательского тумблера.

**Фото — пять групп:**

1. **Кадр:** исходные / 1:1 / 4:3 / 16:9; поворот −90/+90, полноценный raster crop/rotation.
2. **Цвет:** яркость / контраст / насыщенность, 0–200%, предпросмотр и история изменений.
3. **Рисовать:** кисть / карандаш / ластик; цвет и толщина рядом; независимые растровые слои для штрихов.
4. **Текст:** tap по фото создаёт текст; **каждая надпись одновременно существует на картинке И в редактируемом списке**; менять текст, размер, цвет, позицию, удалять и undo/redo. Не сохранять только DOM overlay.
5. **Фигуры:** стрелка, круг, квадрат, треугольник, звезда; цвет/толщина рамки в одном ряду, цвет заливки + чекбокс «Залить фигуру» в следующем.

**Управление:** Undo / Redo, «Отменить изменения», «До / После»; безопасный flattened output соответствует предпросмотру, не содержит оригинала/запрещённых метаданных. Если original не сохраняется, отдельное предупреждение перед необратимой операцией. Перемещение задания и уничтожение original требуют **раздельных** подтверждений при одновременном изменении.

**Проверка куратора:** текущий статус, история, решения **Принять / Исправить / Переснять / Отклонить**; для последних трёх комментарий обязателен, для принятия не обязателен; права и журнал на сервере.

### 13.3. Video & Audio Editor 1.1

- Такой же Shell/трёхвкладочная схема **Информация / Видео(Аудио) / Проверка**, Undo/Redo, «Отменить изменения», «До/После».
- Общая вкладка информации — имя, описание, GPS, категория/теги, задание, TTL, Public Card с разрешениями.
- **Видео:** начало/конец, предпросмотр и применение обрезки; stop-frame JPEG из выбранного кадра. Для production нужно решить **реальный MP4 output** vs non-destructive EDL (`OPEN`) — в HTML границы локальные и не кодируют новый MP4.
- **Аудио:** начало/конец, предпросмотр, создание отдельного WAV-фрагмента (PCM 16-bit) как пример; production решает поддерживаемые codecs/encoding и исходный M4A.
- Результат можно **скачать на устройство**, **передать в системное меню Share** по явному действию пользователя или **сохранить как отдельный файл в Browser** (production — зашифрованный pipeline + outbox, не отдельная demo IndexedDB).
- «Проверка» и права — как Photo Editor; не считать синтетическое решение куратора реальным server receipt.

## 14. Camera 1.2 — фото, видео, аудио

- Header: **Перевернуть / Фонарик / Слепой режим**; непосредственно ниже **Фото / Видео / Аудио**, активный пункт подчёркнут.
- Для фото/видео центральный видоискатель; для аудио отдельный диктофон без камеры. GPS-индикатор **по центру над затвором**; внизу **Задание / Снять(Записать) / Настройки**; стандартный dock.
- Фото: 1:1, 4:3, 3:2, 16:9; качество Max/High/Medium/Low; optional сетка 3×3, масштаб, вспышка/фонарик по доступности.
- Видео: 480p/720p/1080p; 5–300 секунд; запись звука по отдельному разрешению микрофона.
- Аудио: 64/128/192/256 кбит/с (целевое качество), 5–3000 секунд; камера не требуется.
- **Слепой режим** скрывает картинку, но **не останавливает** активный поток/запись. На blind-screen остаётся доступная кнопка съёмки и таймер; аппаратные клавиши громкости — только опциональный ввод при реальной поддержке браузера.
- Объединённая панель **Задание / Категория / Ракурс / Описание** показывает инструкции и правила; категории/GPS/описание могут быть обязательными, съёмка не должна обходить правило пустым значением.
- Пресеты: выбрать, изменить, **«Сохранить пресет» / «Добавить пресет»** в одном блоке; пресеты сохраняются локально и синхронизируются безопасно, не меняют права задания.
- GPS: отдельные **«Отслеживать GPS»** и **«Показывать GPS над кнопкой Снять»**; обязательность задания сильнее переключателей. Один watcher, получение последней доступной точной позиции и позднее уточнение по разрешённой политике.
- Разрешения камеры и микрофона запрашиваются отдельно; ошибка формата/кодека/отказа понятна. Съёмка/запись **сразу** превращается в зашифрованный локальный результат и очередь cloud sync, без записи в системную медиатеку.
- Прерывание видео/аудио сохраняет уже полученные зашифрованные чанки там, где это позволяет платформа. Preview в макете не эквивалентен production capture; iOS PWA, длительные записи, движение GPS и ошибки MediaRecorder проверить отдельно.

## 15. Контакты, команды, профили

### 15.1. «Контакты и Команды» 1.1 — ОДИН экран

- Заголовок **«Контакты и Команды»**, вкладки **Команды (N) / Контакты (N)**; **единственная правая иконка Header — Blacklist**.
- В Teams **сразу под вкладками** полноширинная **«Создать команду»**. В списке: название, краткое описание, небольшие аватары, число участников, меню •••; **без бессмысленной крупной иконки людей**.
- Карточка команды: описание **сразу под счётчиком участников**, шестерёнка прямого перехода к настройкам, компактные строки участников, у **каждого включая владельца** меню ••• (запрещённые изменения роли владельца недоступны), внизу полноширинная «Добавить участника».
- Управление участником в bottom sheet, без нижней кнопки «Назад», закрытие крестиком. Роли: **Владелец / Куратор / Исполнитель / Наблюдатель**; файл scopes: по правилам задания / нет доступа / только предпросмотр / полный.
- Выбор участника **из контактов**, приглашение/отзыв/смена роли/доступа только с явным подтверждением; изменение роли должно реально изменять ACL и криптографический доступ.
- Контакты: поиск по точному **@username / #UserID**, прямоугольные строки и карточки пользователей; add/remove, блокировка. Blacklist — только через Header, не в виде отдельной общей страницы.
- Блокировка скрывает пользователя из обычного списка и выбора участников; не восстанавливать автоматически старые grants при разблокировке.

### 15.2. Профиль / Settings & Profile 1.6 — WIP

- В Settings верхняя карточка своего аккаунта открывает профиль; «Профиль и люди» включает настройки профиля и переход в единый экран «Контакты и Команды».
- Профиль: крупный `@username` с Copy, **неизменяемый восьмизначный #UserID** с Copy (не UUID), аватар, приблизительный online status, «О себе», команды по privacy policy, share/add contact/block; в текущем WIP некоторые действия на своей карточке сомнительны — перед финальным переносом утвердить.
- Настройки: avatar, имя, username, bio, видимость карточки/команд/онлайн; уровни всем / контактам / контактам+участникам команд / никому.
- `@username`: **3–15 символов** `a-z`, `0-9`, `.`, `-`; не начинать и не заканчивать точкой/дефисом; доменные правила доступности и уникальности определяет сервер.
- «Написать» и «Позвонить» в макете отключены, пока реальные сообщения/звонки не реализованы. Не объявлять голосовые звонки частью PB3 MVP.
- `OPEN UX`: финальный вид собственного профиля, 3 действия с иконками и профильные визуальные детали требуют owner review, поскольку PR помечает экран WIP.

## 16. Messages — Fieldwork 1.1 Beta + Matrix (**ОБЯЗАТЕЛЬНЫЙ МОДУЛЬ PB3**)

Дизайн Messages 1.1 утверждён в PR #56 как Beta. **В PB3 включена полноценная реализация** личных и командных сообщений через **Matrix protocol** с клиентским E2EE. Слово Beta описывает состояние UX-эталона, а не право пропустить backend. Начальный homeserver может быть внешним; свой homeserver — отдельная инфраструктурная опция, не требуется для принятия сообщений в PB3.

- **Список диалогов** внутри Fieldwork Shell, личные и командные чаты, поиск, фильтры, черновики, закрепление/сортировка и unread.
- **Открытый диалог — полноэкранный overlay НАД ВСЕМ приложением**, перекрывает Header, контент и Dock **на телефоне и Desktop**. Не desktop split view и не отдельный обычный route.
- При закрытии сохранять исходный список и позицию прокрутки; Escape/back, focus restore, небольшие анимации, reduced motion.
- Фон переписки `#101210`; входящие bubble `#272927`, исходящие светлее `#315640`; достаточные интервалы между сообщениями.
- Сообщения: текст, фото/видео/файлы/голосовые вложения, reply, reaction, edit, delete, forward, pin, search, drafts, delivered/read statuses.
- **Реализация PB3:** `MatrixMessagingAdapter` (SDK/transport подменяемы), Matrix Client-Server API, E2EE-ключи устройств, multi-device verification / key sharing / recovery, клиентские зашифрованные event-state/outbox, room sync/backfill, event dedupe, idempotent send, retry/ACK, delivery/read receipts, typing/presence с privacy-aware defaults.
- **Связь с Key-Only:** первичный Recovery Key аккаунта остаётся единственным ключом восстановления для пользователя; Matrix device/room key material хранится и восстанавливается через защищённые envelopes и выверенный crypto flow. Нельзя предполагать, что Matrix сам восстановит медиафайлы или что пользователь должен запоминать второй независимый пароль.
- **Личные и командные комнаты:** Matrix rooms связываются с локальными Contact/Team/Assignment IDs; ACL membership и реальное Matrix membership синхронизируются через отдельный процесс. Отзыв/блокировка, смена участника/роли отражаются в допустимом доступе; не доверять одной картинке роли в UI.
- **Вложения:** фото/видео/аудио и файлы шифруются до отправки; использовать Media/StorageManager и допустимые scopes/TTL для передачи вложений, запретить передачу `original` через неограниченный URL; вложение не продлевает TTL исходного файла.
- **Тех. контракт:** отправка текста/вложения, reply, reaction, edit/redact, forward, pin, search, drafts, read/unread, notifications, offline/reload, reconnect и большие беседы; для фич, не имеющих стандартного стабильного представления в Matrix, разрешён версионированный app extension без локальной фиктивной синхронизации.
- **Защита:** не логировать содержимое комнат, access tokens и E2EE ключи; Matrix-сервис не должен блокировать вход, камеру, задания, браузер или аварийное удаление других модулей. При Panic включить Matrix credential revoke и локальную очистку keys/outbox.
- **Гейт готовности:** два настоящих аккаунта на независимых устройствах, E2EE текст+вложение, offline/reconnect, rename/edit/delete, room membership, восстановление Matrix keys после нового Recovery Key login; реальная проверка отправленного и полученного ciphertext, не только UI демо.

### 16.1. Матрица доступности Messaging и собственного homeserver

- **Matrix Messenger входит в функционал приложения для всех тарифов**: E2EE личные/командные сообщения, attachments, outbox, доставка, восстановление. Платформа по умолчанию обслуживает комнаты на выбранной инфраструктуре Matrix; её конкретный сервер не привязывать к Identity или загрузке медиа.
- **Unlimited+** имеет отдельное продуктово-тарифное право **«Свой Matrix-сервер»**. На уровне архитектуры заложить `HomeserverBinding`, validation/handshake, allowlist/capabilities, storage credentials/token isolation, administrator-managed/owner-managed modes. Что в точности обещается (подключение своего или выделенный managed) — `OPEN` до коммерческого запуска.
- Переход с platform homeserver на пользовательский Matrix homeserver **не обещает бесшовную миграцию исторических комнат** без согласованного протокола: матрица доступности, перенос/архив, room membership, E2EE state и старые ссылки требуют отдельной техники.
- Администратор приложения не читает чужие E2EE-сообщения. Модерация и блокировки действуют через metadata/ACL/transport-level ограничения, а не расшифровку личной переписки.

## 17. Уведомления — Fieldwork 1.5

- Полноценная страница внутри Shell, в Header **иконки «Прочитать все» и «Настройки»**, без тарифной кнопки, без дополнительного Back над заголовком.
- Заголовок «Уведомления», вкладки **Все / Непрочитанные**, зелёная точка на непрочитанной иконке, прочитанные тусклее.
- Нажатие **раскрывает событие НА ТОЙ ЖЕ СТРАНИЦЕ**: остальные скрываются, единый header/body/footer с «К списку уведомлений». Сохранять контекст.
- Действия по типу: принять/отклонить приглашение, открыть задание/материал, review result, nearing TTL, новое медиа, backup status, подписка, безопасность.
- Настройки категорий и quiet hours; internal inbox доступен независимо от OS push permission. Отдельный системный PWA Push bridge, badge только по поддержке устройства.
- Notification model: стабильный type, targetId, encrypted/minimal display, server authorization on click, readAt, dedupeId, optional action intent.
- Не помещать приватные имена/координаты/содержимое вложений в незащищённые push payload. Время TTL/напоминаний — серверное, не только JS timer.

## 18. Public Card — Fieldwork 1.1

- **Внешняя страница без авторизованного Header/Dock**: логотип {{APP_NAME}}, «Установить приложение», имя/NAME-ID, действия **Copy / Download / Share** по разрешениям, safe media, доступные поля, TTL и футер «Опубликовано через {{APP_NAME}}» / copyright.
- Отображения: `full`, `restricted`, `viewOnly`, `expired` — это UX states; реальные ACL проверяются сервером, а не переключателем preview.
- Упоминаемые поля по разрешению: описание, дата съёмки, дата изменения, теги, автор/команда, GPS + карта, метаданные. Карта **не подключается автоматически**, если геолокация скрыта или нет пользовательского разрешённого действия.
- **Два уровня политик:** Assignment Editor задаёт верхний предел, Photo Editor — настройку данного файла. Эффективная выдача = пересечение `assignment policy ∩ file policy ∩ public grant ∩ time/TTL ∩ media scope`.
- Только отдельная **безопасная flattened derivative** без EXIF/неразрешённых GPS/оригинала; никто не должен получить приватный DEK. Внешний URL/token имеет срок, отзыв и scope. Реклама/предложение установки не раскрывают приватные данные.
- Public Card preview в File Viewer не является подтверждённой публикацией. Продажа доступа к карточке между третьими лицами **не равна** интеграции платежей {{APP_NAME}}; наше приложение не принимает эти сделки без отдельного решения.
- Экран установки PWA: адрес в эталоне `{{APP_URL}}` — целевой, доступность deployment проверить; на iOS Safari → «На экран Домой» → «Открыть как веб-приложение», Android Chrome → Install/Add, Desktop Chrome → Install.
- **OPEN:** окончательный формат публичного token/ключевой выдачи, безопасные форматы видео/аудио, точные download permissions, bundle/multi-file/whole assignment share. До принятия не включать лишние scopes.

## 19. Оформление, поиск настроек, помощь

### 19.1. App Appearance 1.3 — оформление и настраиваемый Dock

**Актуальный UX-эталон:** `docs/ux/app-appearance/accepted-app-appearance-v1.3-standalone.html` в PR #56 на указанном commit; 1.2 сохранить как историческую версию. Статус — `UX ACCEPTED / TARGET PB3`, не действующая настройка PB2 runtime.

- Тема: тёмная по умолчанию / светлая / системная.
- Основной цвет: зелёный по умолчанию / серый / янтарный / коралловый.
- Размер текста: мелкий / обычный / крупный.
- Стартовая страница: Камера / Задания / Browser.
- Язык в утверждённом интерактивном прототипе RU/EN; полноценная i18n расширяется по целевому списку ниже.
- **Настройка Dock в «Оформлении»:** пользователь выбирает **от 3 до 6** видимых пунктов (рекомендуется 4–5) из полного каталога: **Задания (A) / Browser (B) / Камера (C) / Уведомления (N) / Профиль и Настройки (S) / Контакты и Команды (T) / Сообщения (M)**. Один пункт не может быть добавлен дважды.
- **Профиль / Настройки (S) — обязательный пункт:** всегда присутствует, **удалить нельзя, перемещать можно** в любое место Dock. Остальные пункты разрешено добавлять, убирать и переставлять с соблюдением диапазона 3–6. Заводской набор: **Задания / Browser / Камера / Контакты / Профиль**.
- **Редактор порядка:** перетаскивание и доступные клавиатуре/касанию действия **вверх/вниз**; добавление через «+», который всегда **прижат к самому правому краю строки**. Обеспечить понятные состояния, когда достигнут максимум или минимум; не удалять обязательный раздел. Предусмотреть восстановление набора по умолчанию.
- **Живой предпросмотр:** черновые изменения сразу отражаются в нижнем Dock (количество и порядок иконок, одинаковая ширина слотов), без скачков высоты. **«Отмена» / «Сохранить»** — фиксированная панель над Dock, не внутри скролла. Отмена возвращает сохранённые настройки, сохранение атомарно принимает выбранные параметры и конфигурацию Dock.
- **Настройки Local-First:** сохранять порядок и состав локально для мгновенного запуска и синхронизировать с настройками аккаунта согласно принятой модели; сбои сети не должны сбрасывать пользовательский Dock. Реальный persistence и конфликт двух устройств требуют тестов, а не копирования demo state.
- Поиск в Settings с RU/EN синонимами ведёт **к КОНКРЕТНОМУ контролу** (например, `language/язык` — к селектору языка, `dock/док/панель навигации` — к настройке Dock), а не просто к корню страницы.
- **Повторное нажатие активного пункта Dock** выполняет возврат на один уровень внутри раздела (см. §20.2). Поведение обязательно, но **поясняющую фразу в интерфейсе настроек Dock не показывать**.
- Реальные пункты «Сообщения» и «Уведомления» открывают соответствующие модули; наличие кнопки в эталонном HTML не означает, что Matrix или push уже реализованы.

### 19.2. Help / FAQ / Legal 1.0

- Общая страница: О приложении, FAQ, Помощь, Условия использования, Политика конфиденциальности.
- FAQ: поиск/раскрытие вопросов о ключе, TTL, Panic, device, backup, приватности.
- Help: формирование обращения без утечки Recovery Key и приватных медиа; реальный канал поддержки `OPEN`.
- Terms/Privacy **пока заглушки**: перед публикацией юридическая проверка, фактические условия, политика обработок и сроков хранения.

### 19.3. Языки

**Целевой перечень из исходного задания:** русский, английский, украинский, польский, турецкий, грузинский, немецкий, французский, чешский, испанский, португальский. RU/EN — минимальный гарантированный launch baseline, остальные — отдельные переводческие задачи до заявления поддержки. Сообщения ошибок, тарифы, PIN, Recovery Key/backup и системные настройки переводятся из единого словаря, без строк, намертво зашитых в компоненты.

## 20. Единый App Shell, навигация и UI-поведение

### 20.1. Shell

- Header **64px**: `{{APP_MARK}}` квадрат 37px (mobile ~34px), `{{APP_NAME}}`, **системный статус под названием**, точечный индикатор, контекстные иконки справа **без обводки**.
- Dock **82px**: **закреплён снизу**, не прыгает и учитывает safe-area; **3–6 равных зон** по настройке App Appearance 1.3. Стандартно пять: **Задания / Browser / Камера / Контакты / Профиль**; также доступны **Уведомления / Сообщения**, а любой пункт, кроме обязательного **Профиль / Настройки**, можно убрать. Порядок свободный. Активный пункт — акцентный цвет выбранной темы, управление удобно для большого пальца; проверить узкие экраны при шести пунктах.
- Контент между Header и Dock — единственная вертикально прокручиваемая область, без скачков при изображении/клавиатуре. Для больших экранов Responsive без изменения смысловой навигации.
- **Исключения без Shell:** Welcome, Loader, PIN Shell, Authorization Error, внешняя Public Card. Сообщения открываются fullscreen-over-Shell, но список остаётся в Shell.
- Pathbar Browser/Viewer/Editor: прозрачный фон, Back, breadcrumbs; единый компонент, не новая панель на каждом экране.
- Bottom sheets/popovers/confirmation/in-app browser — единая система слоёв; сохранение scroll/focus, Escape, pointercancel, accessibility, `prefers-reduced-motion`.

### 20.2. Поведение Back и Dock

- Не складывать сотню просмотренных медиа в обычную browser history так, что кнопка «назад» листает их все. Из Viewer назад — к каталогу/папке с прежними фильтрами и scroll; из редактора — в тот же файл; из fullscreen — в Viewer; из чата — к тому же списку диалогов.
- Повторное нажатие активного dock-пункта возвращает **на один уровень назад в рамках текущего раздела**, а не в предыдущий случайный раздел. В корне раздела действие безопасно остаётся без перехода; открытая модальная панель обрабатывается согласно иерархии слоёв. Состояние, фильтры и прокрутка сохраняются. Не дублировать объяснение этого поведения текстом в настройках Dock.
- **Решение уже принято в App Appearance 1.3:** пользователь сам настраивает состав и порядок Dock (3–6 пунктов); **Профиль / Настройки неизменно присутствует**, но может быть в начале, середине или конце. Не фиксировать пять пунктов в роутере, CSS или доменных правах; скрытие пункта Dock не отключает доступ к разделу через другие разрешённые маршруты.
- Двойные нажатия отправки/удаления/оплаты/приглашения не создают двойных операций; UI и server idempotency обязательны.

### 20.3. Системный статус

- Зелёный: завершено/синхронизировано; жёлтый: операция выполняется/ожидает/офлайн; красный: ошибка с переходом к подробностям.
- Нажатие на статус открывает **общий журнал последних и текущих операций**, доступный на всех экранах, а не отдельный фиктивный лог в каждом HTML.
- Для каждой операции: тип, target ID, локальное/server состояние, ошибка, retry, время и безопасная user-readable причина; не хранить секреты в логах.
- Loader используется для конкретного ожидаемого действия без блокировки доступной оболочки. Успешный toast появляется после локального принятия с точной формулировкой, server success — **только после ACK**.

## 21. API, состояния, безопасность операций

### 21.1. API и контракты (целевые, не список уже существующих routes)

- `identity/v2`: регистрация/recover/rotate/device revoke/session; существующий PB2 pairing ограничить и не считать разрешённым обходом входа по Recovery Key, постепенно расширить Recovery Vault и signed emergency intents.
- `media/v1`: reserve/upload/read/finalize/assets/versions/metadata/edits/list с типами фото/видео/аудио. Сохранить существующие `photos/v1` до миграции или обеспечить версионированный adapter без разрыва клиентов.
- `folders/v1` и `browser/v1`: scoped tree, cursor list, batch tags/category/archive/favorites, permissions, metadata search.
- `assignments/v1`: CRUD/state/policy/members/progress/review, расширить media types/retention.
- `people/v1`, `teams/v1`, `contacts/v1`: search/profile/contact/block/team membership/roles; существующий `collaboration/v1` сохранять до адаптации.
- `grants/v1`, `public-cards/v1`: explicit scopes, public token/revoke/safe asset, no original.
- `storage/v1`: account usage, reservations, locations only in service boundary; never отдавать credentials/physical keys клиенту.
- `backups/v1`: create/verify/list/restore/delete/configure schedule, rolling pointer and tariff limits.
- `billing/v1`: plans/current/quote/invoice/settlement/history/subscription transitions.
- `notifications/v1`: list/read/preferences/action, optional push registration.
- `messages/v1` — **обязательно в PB3**: Matrix bridge/room binding, E2EE ключевые envelopes, encrypted attachment grants и app-specific metadata; обмен сообщениями по Matrix Client-Server API, не переизобретать протокол. Серверная и клиентская Identity/ACL интеграция версионирована.

### 21.2. Общие правила API

- Авторитетное серверное время; все timestamps/TTL в UTC и однозначных единицах.
- `operationId`/idempotency; `expectedRevision`/optimistic concurrency; ответ с чёткими `pending/verified/active/rejected/deleted` и receipt.
- Минимальные scopes на сессию, аккаунт, устройство, задание, получателя и физический asset; запрет привилегий по одному известному ID/URL.
- Cursor pagination (`limit` bounded, `nextCursor`) для media, folders, assignments, contacts, teams, notifications, invoices и локального списка Matrix messages/rooms (в PB3).
- Стабильные ошибки: authentication vs revoked device vs insufficient ACL vs expired vs conflict vs quota vs storage failure vs network. Никакого отображения глобального Authorization Error на обычный timeout.
- Конфиденциальный backend лог без Recovery Key, ключевых пакетов, plaintext, реальных координат и секретных URL; отдельный audit/security log минимальной детализации.
- `GET` не меняет состояние, destructive `POST/PUT/DELETE` — CSRF/signed intents и повторные подтверждения на клиенте.

- `admin/v1` (отдельный origin/контур): operator login MFA/RBAC, subscription grants, restriction intents, audits, support actions; никаких ключей расшифрования.
- `telemetry/v1` / `analytics/v1`: минимальные события использования, агрегированные отчёты, operational metrics; не принимать неконтролируемые секреты/пользовательский контент.
- `storage-providers/v1`: register/verify/health/select primary/add replica/repair/retire, с запретом экспозиции секретов клиенту.
- `release-integrity/v1` или статические release artifacts: подписанный manifest, trusted hash verification, release metadata и refresh/rollback policy.

### 21.3. Серверные операции и мониторинг

- Scheduler/queue: expired files, physical GC, abandoned uploads, asset retirement, public link expiry, backup staging cleanup, subscription grace/entitlements, invoice settlement rechecks, notifications.
- Метрики: очередь синхронизации/очистки, oldest pending, last verified backup, checksum failures, orphan count, quota drift, failed jobs, latency uploads, payment mismatches — без чувствительных значений.
- Reconciliation между PostgreSQL и S3; миграции/rollback и восстановление сервисной базы из инфраструктурного backup **не** заменяют клиентский Recovery Vault.

### 21.4. Кросс-модульные контракты и события

- Версионированные события `AccountCreated`, `DeviceRevoked`, `AssignmentChanged`, `MediaCaptured`, `MediaCommitted`, `MediaExpired`, `GrantRevoked`, `BackupVerified`, `PanicIntentCreated`, `SubscriptionEntitlementChanged`, `MatrixRoomMembershipChanged`, `ReleaseVerified`. Каждое содержит лишь безопасные ID, timestamps, `eventId`, tenant/account scope, schema version. **Запрещены plaintext, Recovery Key и приватные GPS/имена.**
- Outbox/inbox reliability: событие может прийти повторно/поздно или в неверном порядке; consumers idempotent, серверные транзакции короткие, retry/backoff, poison/quarantine и DLQ при необходимости.
- ACL permission matrix (actor/role/assignment/media/grant/share/Matrix room/storage) — **единая policy**. Права на просмотр не автоматически включают download/original/public/share; отзыв или expiry учитывают уже выпущенные ссылки и кэши.
- `Readiness` / `Liveness` / `Degraded`: API, PostgreSQL, primary S3, replica S3, Matrix, payment provider, queue, backup signing service оцениваются независимо. Отказ Matrix не блокирует камеру, отказ внешнего BYO S3 не уничтожает локальную очередь.

## 22. Конфигурируемые тарифы и технические лимиты (PB3)

### 22.1. Один источник конфигурации тарифов

- Пять планов из §8 — **единственная действующая тарифная карта**. В коде тарифы не задаются массивами в Vue, HTML, SQL-механизмах и контроллерах.
- Версионированный каталог `config/plans.php` (или сериализуемый реестр с неизменяемыми versioned snapshots) задаёт `plan_id`, `version`, `effective_at`, стоимость за 1/6/12 месяцев, скидки, `assignment_creations_per_month`, `max_file_count`, `max_encrypted_bytes`, `max_ttl`, ручные и автообновления backup, `grace_days`, `feature_flags` (например remote-wipe).
- Admin-переопределение хранится в БД как *новая версия* тарифного определения с `effective_at` и audit, а не редактирует уже оплаченный invoice задним числом; пользователь получает price/plan snapshot каждого заказа.
- Frontend всегда получает серверные public plan definitions и current entitlements через `billing/v1`; примерные цены старых Fieldwork HTML приводятся к актуальному каталогу при production переносе.
- Конфиги по окружению/секреты хранятся отдельно: публичные цены — не секрет, ключи платёжного оператора — секреты deployment.

### 22.2. Независимый Operational Limits Registry

**Тарифная «безлимитность» означает отсутствие продуктовой числовой квоты, но не отсутствие защиты ресурсов.** Отдельно в `config/operational_limits.php` или расширяемом registry задавать лимиты с версионированием и runtime-override по правилам оператора:

| Операция | Стартовая техническая политика (рекомендуемый default, изменяемая) |
| --- | --- |
| Создание/обновление backup | не чаще **1 успешного старта в 60 минут на аккаунт**, даже на Unlimited/Unlimited+; отдельная плановая квота по §8 |
| Параллельные backup | **1 активное** создание/верификация на аккаунт; очередь остальных |
| Upload | max concurrent upload per account/device + размер chunk + скорость/байты для защиты инфраструктуры |
| API/Identity/PIN/Recovery | separate short/long windows, security lockouts, IP/device/account scopes |
| Matrix messages и вложения | per-device/account bursts, антиспам, room limits, media bytes |
| S3 replication/repair | concurrency/byte budgets/queue priorities, circuit breaker на деградировавший provider |
| Web3 invoice | bounded new invoices / settlement polls / callbacks, idempotent receipt |
| Admin действия | MFA, RBAC, operator request limit + обязательный audit |

- `Retry-After`, статус следующего доступного обновления и причина ограничения показываются в UI через централизованный status. Failed/rolled-back backup не должен фиктивно потреблять полноценную продуктовую квоту; abuse-протекторы могут отдельно учитывать попытки.
- Все ограничения enforcement **server side** (atomic counters/locks/leases), независимо от клиента, конфигурации тарифа и сети. Состояния pending/active/complete и lease timeout не должны образовывать вечную блокировку после crash.
- Значения технического конфига **не являются новыми обещаниями тарифа**, не заменяют 4/7 ручных и 2/5/ежедневные автообновления из §8.

## 23. Administration, Analytics и Observability (PB3)

### 23.1. Изолированная административная поверхность

- Административный интерфейс на отдельном subdomain/route boundary с MFA, least privilege RBAC (например viewer/support/operator/security/superadmin), CSRF/session hardening, max session age и обязательным журналом действий.
- Список аккаунтов: публичный ID/технический ID, текущий план и deadline, anonymized activity, created/active, объём ciphertext, число файлов и заданий, нарушенные лимиты, security flags — **не открывая текст/файлы/сообщения**.
- Допустимые действия: **выдать тариф бесплатно/продлить/назначить временный entitlement** (`reason`, `expires_at`, `operator_id`); блокировка/разблокировка аккаунта, ключевого идентификатора/публичного locator, устройства, IP/CIDR с TTL/reason; отзыв sessions/токенов и forced re-auth; временное ограничение операций.
- Не использовать ACL администратора для чтения E2EE медиа. Права поддержки не дают Recovery Key или ключи Matrix/медиа.
- Не строить «бан ключа» на сохранении секретного Recovery Key: банить **безопасный идентификатор аккаунта/locator/fingerprint**, а не сам ключ или приватный материал.
- Защитить IP блокировки от ошибок NAT/CGNAT и совместных сетей: scopes/срок действия/ручная отмена, аудит и понятная причина без разглашения приватной аналитики.
- Все операции `AdminAction` — идемпотентны, с actor, reason, target, requestId, before/after (без секретов), `created_at`, reversible/irreversible flags; особо разрушительные — step-up auth/дополнительное подтверждение.

### 23.2. Privacy-preserving аналитика использования

- Считать **количество аккаунтов**, новые/активные аккаунты (DAU/WAU/MAU), retention, количество команд/заданий, создание/выполнение заданий, файлы **по типам** (фото/видео/аудио), облачные байты, очередь, частоту запросов, дни хранения, используемые экраны/функции, ошибки UX и conversion тарифов — **только события о действиях и агрегаты, без содержимого**.
- Метрики инфраструктуры: нагрузка CPU/RAM/DB/queue, S3 operations/storage/egress, failover/replication lag, failed jobs, latency p95/p99, Matrix sync health, backup success/last verified, payment settlement, PWA signature failures.
- По умолчанию не собирать GPS, названия заданий/папок/теги, текст сообщений, фото, filename, Recovery Key, PIN, IP в продуктовые агрегаты. Security IP signals ведутся отдельно, с доступом и ограниченным retention.
- Нужны версии схемы events, bounded sampling, политика хранения, privacy/consent при необходимости, умышленная минимизация связности, защита от логирования secrets, отдельные уровни доступа и экспорт обезличенных агрегатов.
- Дашборды: Overview, Accounts, Usage (Assignments/Media/Teams/Messages), Billing, Storage, Matrix, Security, Background Jobs, Releases. Настоящая telemetry pipeline; UI не «рисует» числа из демо-массива.

## 24. Self-Auditing PWA / Signed Release Integrity (PB3)

**Цель:** приложение проверяет целостность и подлинность загружаемых исполняемых ресурсов, прежде чем активировать новую версию, и предоставляет доступную пользователю информацию о проверенном релизе. SHA-256 — механизм контроля содержимого; **подлинность** обеспечивается отдельной цифровой подписью.

1. **Сборка CI:** фиксировать перечень JS, CSS, HTML/entry points, WASM, значимых assets и Service Worker с `path`, `sha256`, `size`, `release_id`, `build_time`, `manifest_version`, минимальной версией клиента, выбранными feature flags. Формировать канонический подписываемый JSON (детерминированная сортировка/нормализация).
2. **Подпись релиза:** detached Ed25519 (или эквивалентный прошедший security review алгоритм) поверх manifest. Приватный signing key хранится **в отдельном защищённом CI/signing контуре**, не в репозитории, frontend, S3, web env или Laravel config. Ротация/отзыв ключей — версия подписей + доверенная цепочка обновления.
3. **Проверка перед activation:** загрузить manifest+signature, проверить доверенную подпись, затем `SHA-256` каждого ресурса, включая Service Worker; при mismatch `reject/quarantine` релиз, не активировать его, сохранить last-known-good cache/version и зафиксировать безопасное диагностическое событие.
4. **Bootstrap trust:** обычный JavaScript, загружаемый с того же скомпрометированного origin, не может сам доказать собственную подлинность. Поэтому **для строгой независимой проверки нужен anchor вне контролируемого сервера**: закреплённый ключ в верификаторе/подписанном пакете/независимом канале, либо иной реально доверенный механизм. Встроенный verifier без такого anchor полезен против частичной/случайной подмены и corrupted cache, но **не называется полной защитой от malicious origin**.
5. **Дополнительно:** CSP без unsafe-inline где возможно, SRI для внешних статических ресурсов, HTTPS/HSTS, строгие разрешения к CDN и third-party scripts, signature verification в релизном процессоре, anti-rollback release sequence, reproducible builds/lockfiles, dependency checks и security advisories. Web3 SDK и аналитические скрипты не должны иметь доступ к private keys.
6. **UX:** Settings → «Информация и безопасность сборки»: version/release id, статус `Проверено / Обновление отклонено / Не проверено`, время последней проверки, опциональная сверка SHA-256, ссылка на публичный подписанный release manifest/инструкцию независимой проверки. Не раскрывать secrets.
7. **Готовность:** тесты на corrupt JS/CSS/SW, неверную/просроченную signature, altered manifest, ошибку сети, CDN cache divergence, rollback attack, переустановку PWA, ключевую ротацию, восстановление последней проверенной версии. Деструктивные операции/ключи не выполняются недоверенной новой сборкой до verification gate.

### 24.1. Реальный предел Self-Auditing в веб-PWA

**Важное ограничение:** манифест SHA-256, который проверяет код из **того же потенциально подменённого origin**, не защищает от атакующего, контролирующего и код проверки, и ключ доверия. Браузер также может исполнить обычный entry HTML/JS **раньше** любых проверок, если bootstrap не спроектирован специально. Поэтому в PB3 обязательно различать:

1. **Integrity внутри PWA:** защита от случайно повреждённых/частично заменённых файлов и от неполных релизов. Проверка подписанного манифеста до *активации обновления* там, где есть доверенный прежний bootstrap/Service Worker. Проверять HTML/CSS/JS/SW с учётом browser cache, CDN и atomic rollouts.
2. **Подлинность для пользователя:** независимый anchor публичного signing key **вне контролируемого CDN/web-origin** (например доверенная нативная оболочка/внешний verifier/публичный подписанный release ledger). Без такого якоря нельзя писать «PWA невозможно подменить» и нельзя объявить Self-Auditing защитой от полного компромисса сервера.
3. **Безопасный первый запуск:** для нового browser без trusted bootstrap не заявлять самостоятельную доказуемую проверку через полученный им же JS; до готовности независимой инфраструктуры честно показывать уровень проверки. При нарушении подписи у ранее доверенной установки — не активировать новую сборку, сохранять старую доступную verified (если существует) и блокировать sensitive operations из недоверенного кода.

**Acceptance:** подмена любого asset, manifest/signature, Service Worker, rollback/replay, первый запуск/обновление/offline, очистка caches, key rotation, повторная проверка. Отчёт и пользовательский статус должны точно отражать trust level, не обобщать его до «абсолютно безопасно».

## 25. Сквозные пользовательские сценарии приёмки

Каждый пункт требует **реального API/постоянного хранилища**, корректного UX и проверки error/offline/reload; нажимающийся HTML-прототип не считается PASS.

1. **Регистрация:** новый аккаунт, Recovery Key, сохранение в OS share/save, новая доверенная сессия, доступ без email/телефона.
2. **Восстановление:** новый браузер/телефон, Recovery Key, полная повторная регистрация доверенного устройства и зашифрованная синхронизация.
3. **Фото:** снять с разрешённым GPS/заданием → локально зашифровать → закрыть приложение → открыть offline → позже загрузить → verify/finalize → увидеть в Browser.
4. **Видео:** записать реальный 5–300-секундный поток, пережить прерывание, вернуть файл в Browser, посмотреть и создать стоп-кадр.
5. **Аудио:** записать 5–3000 секунд в доступном формате, безопасно сохранить чанки, проиграть, обрезать и создать новый файл.
6. **Задание:** владелец создаёт смешанное фото/видео/аудио задание, назначает команду, правила, сроки; реальный участник получает только разрешённые материалы; прогресс считается по целям.
7. **Команда/ACL:** contact invite, роли, доступ только thumbnail vs full, block/revoke, исключённый участник больше не получает ключи/asset.
8. **Фоторедактор:** два текста на изображении и в списке; Undo/Redo; фигуры/цвет/кадр; сохранение правильного flattened без оригинала/EXIF; original по policy.
9. **Архив:** удалить → архив → восстановить, удалить из архива → подтверждение и фактический GC; не продлить TTL.
10. **Public Card:** опубликовать safe asset с TTL и ограниченными полями; внешний browser без логина; revoke/expire блокируют URL; original недоступен.
11. **Backup:** платный план, ручное/auto обновление по квоте; сбой обновления сохраняет предыдущий verified snapshot; restore на новом устройстве; точный учёт bytes.
12. **Panic:** аварийный PIN блокирует/чистит локально, регистрирует cloud deletion, сохраняет verified backup, показывает Authorization Error; Recovery Key восстанавливает допустимые данные.
13. **Remote:** отзыв украденного устройства с другого и signed wipe command; статусы и повторный приём на отозванном устройстве.
14. **Тариф:** Free/Go/Pro/Unlimited/Unlimited+; сервер проверяет одновременно file-count/bytes/assignment creation и TTL, без доверия frontend.
15. **Оплата:** DePay invoice, ожидается, подтверждение блокчейна, subscription activation, повторный callback, отмена/ошибка/timeout/переход тарифа.
16. **Уведомления:** invite/TTL/backup/security, mark-read, раскрытие в той же странице, click-to-object с повторной ACL, push без приватных данных.
17. **Matrix Messages PB3:** два аккаунта, независимые устройства, Matrix E2EE, text/voice/media, reply/reaction/edit/redact/draft, доставка и read receipts, real offline outbox, восстановление диалога/ключей по Recovery Key, full-screen overlay не разрушает список.
18. **Устройство:** iPhone Safari/PWA и Android Chrome: permission/camera/GPS, keyboard, orientation, viewport safe areas, offline/cold start, browser back, fullscreen gestures. **Dock 1.3:** выбор 3/4/5/6 пунктов и порядок, обязательный (но свободно перемещаемый) Профиль / Настройки, правые «+», Save/Cancel, поиск `dock/док`, один уровень Back по повторному тапу, без скачков при клавиатуре/переключениях.
19. **Большой аккаунт:** десятки тысяч media/folders/events, cursor без дублей/пропусков, быстрый первый экран, отсутствие N+1 и неограниченного сканирования.
20. **S3/реплики:** подключить личный primary S3; подключить второй независимый S3; write/verify/replicate/read failover, provider removal/rotation, outage, GC всех live replicas без уничтожения Recovery Vault.
21. **Администрирование:** изолированный MFA admin, роли, выдать временный бесплатный тариф, заблокировать аккаунт/device/IP, снять блокировку, увидеть мотив/TTL/аудит, ни одного plaintext E2EE.
22. **Технические лимиты:** Unlimited+ backup updates не чаще server cooldown (по умолчанию 1/час), один одновременный backup; quota и rate limit независимо, ошибки без повреждения snapshot.
23. **Integrity PWA:** подписанный релиз; повреждённый JS/SW/CSS отклоняется до активации, предыдущая проверенная версия сохраняется; неверная подпись и downgrade заблокированы; документировать bootstrap trust.
24. **Branding:** замена `APP_NAME`, `APP_MARK`, `APP_PUBLIC_URL` на test brand без единичной правки Vue компонента/миграции/текста Public Card / PWA / push / инвойса.
25. **Fault injection:** lost ACK, partial upload, S3 outage, quota race, worker delay, repeated delete, interrupted backup, partial payment, revocation, expiration/downgrade, corrupted local cache, Matrix outage и tampered release.

## 26. План разработки PB3 в отдельном репозитории

**Репозиторий:** `1troitsky/photobunker-v3`. Репозиторий создаётся владельцем; его фактическое наличие и ветку проверить перед началом работы. Не пушить PR #56 в `main` старого репозитория; import/copy/selective merge из PB2/PR #56 в новую историю — отдельные контролируемые шаги. Спецификация не означает существования нового репозитория на GitHub до его фактического создания.

**Подготовительный P0 — foundation/результаты аудита**

- Инициализировать monorepo, `AGENTS.md`, границы слоёв, независимый брендинг, CI/CD, lockfiles, окружения и тестовые данные. Обязательно PHP **8.4.27+ (до 8.5) или 8.5.12+**, Laravel **13.4+**; patch-security gate и разные конфигурации среды.
- Зафиксировать PB2 commit, точный PR #56 (`daca24a4`, включая App Appearance 1.3), source mapping, лицензии и migration plan; переносить только нужные части без скрытого legacy runtime.
- Исправить `routes/web.php` parse errors, расширить CI PHP lint/route boot/migrations/tests, реально прогнать PostgreSQL/Garage/production frontend smoke; проверить причины провалов workflow.
- Включить signing key management, reproducible asset manifest generation и release-verifier architecture в P0 (полный PWA gate к P3/P4).

**Этап P1 — ядро, безопасность и хранение**

- Identity/Recovery Key, E2EE device/asset key hierarchy, signed operations и ACL. `MediaFile`/versions (фото/видео/аудио), большой chunked upload, TTL/GC, validated server receipts.
- `StorageManager` + `StorageLocation`, начальный GarageAdapter **и готовый контракт** UserS3Adapter/SecondaryS3Adapter; технический rate limiting конфиг, storage health и очередь repair. Не откладывать интерфейсы под будущее переписывание.
- Local-First encrypted durable outbox/indices, мультиаккаунтные grants, серверные квоты, пагинация, серверные операции из конфигурируемых entitlements.

**Этап P2 — пользовательское приложение и сообщения**

- Перенести принятый Fieldwork Shell и весь утверждённый UI из PR #56 на Vue runtime: Welcome/PIN/Error, Assignments 5.0 + Editor 2.2, Camera 1.2, Browser v3, Viewer/редакторы, Teams/Contacts, Profile/Settings, **App Appearance 1.3 с динамическим Dock**, Notifications и Public Card.
- **Matrix Messages 1.1** как обязательный PB3 user journey: личные/командные комнаты, E2EE, attachments, encrypted outbox, восстанавливаемый device crypto state; не считать макет интеграцией. Matrix outage не блокирует медиа/вход.
- Каждый экран принимать вертикально: UX + domain + API + E2EE + persistence + error/offline/reload и реальный mobile browser. Settings/Profile WIP до финальной UI-приёмки.

**Этап P3 — восстановление, оплата, администрирование и безопасные релизы**

- Rolling Recovery Vault с подтверждённым restore; Panic/Remote Wipe и Dead Man's Switch по явно выбранной retention policy.
- Все пять **config-driven** тарифов, backend quotas/grace/downgrade, DePay/подключаемые Web3 providers с проверяемым settlement. Переопределения тарифов через админку — с версиями/датами и журналом.
- **Admin/Analytics**: privacy-minimizing telemetry, operational dashboards, выдача бесплатного тарифа/grants, блокировки account/device/IP, RBAC/MFA, аудит. Production technical limits не зависят от Unlimited.
- Подписанный PWA release manifest, проверка SHA-256/assets, verified update/rollback, CSP/SRI и release pipeline с отдельным signing trust boundary.

**Этап P4 — обязательные S3/Matrix-расширения, проверка релизной готовности PB3**

- **Полностью реализовать и принять** BYO S3 и независимый/резервный S3: креденшелы, test connection, placement, replication, integrity, repair, failover, migrations, multi-provider deletion/backup policy. Пользовательский выбор primary/secondary, UX storage settings.
- **Unlimited+ Matrix homeserver:** поддержать выбранную и задокументированную модель «своего сервера» (как минимум безопасное подключение совместимого user-managed homeserver с проверкой E2EE/identity/federation), отдельные статусы, права/лимиты, тестирование двух серверов. Не продавать managed homeserver, пока его эксплуатационная модель не подтверждена.
- Production hardening Matrix и всех E2EE/TTL/recovery/permission сценариев, масштабирование очередей, нагрузочные тесты storage, telemetry validation, chaos/outage drills, release transparency/инциденты.
- Полная приёмка на мобильных PWA, мобильная производительность, реальный CI/CD, документация legal/support, операционные алерты, brand-switch smoke test. **P4 не «когда-нибудь»: это последний обязательный этап релиза PB3.**

**За пределами PB3:** IPFS не проектировать/не реализовывать. Указанные в Unlimited+ собственный Matrix-сервер и собственный S3 **НЕ являются будущими идеями**: это обязательные продуктовые возможности PB3. Способ предоставления Matrix-сервера (BYO vs dedicated managed) — отдельное решение, не отменяющее entitlement.

**Нельзя завершить P4**, если в PB3 отсутствуют Matrix-сообщения для реальных аккаунтов, интеграция Unlimited+ со своим Matrix-сервером согласно выбранной модели, пользовательский S3 и независимая резервная S3-репликация.

**Правило delivery:** одна бизнес-функция = endpoint/domain/UI/тесты/наблюдаемость; P0–P4 дают пять контрольных точек, из которых **четыре этапа разработки P1–P4 плюс подготовка P0**. Ни merge, ни deployment без отдельного решения владельца.

### 26.1. Формальная схема этапов и выходных артефактов

| Контрольная точка | Это отдельный этап разработки? | Что обязательно получаем | Приёмка/Exit gate |
| --- | --- | --- | --- |
| **P0: Preparation** | **Нет** | Новая репа, pinned versions, source map PB2/PR #56, CI/staging, security baseline и согласованный backlog | `php -v` не ниже безопасного patch; Laravel 13.4+, `route:list`, миграции, контрольные PB2 тесты, локальный запуск |
| **P1: Foundation** | **1 / 4** | Identity/Recovery, E2EE, единый media domain photo/video/audio, Local-First, StorageManager, TTL/GC, ACL, конфиг лимитов | Два аккаунта, реальная камера/загрузка/скачивание разных типов, encrypted offline → online, отказ S3 без потери ciphertext |
| **P2: Product + Matrix** | **2 / 4** | Реальный Fieldwork frontend (не standalone mock), задания, команды, Browser, editors, статусы, уведомления, public cards, Matrix E2EE | Реальная задача A→B, обмен/просмотр с правами, фото/видео/аудио, два Matrix-клиента E2EE, App Appearance Dock 3–6, mobile PWA |
| **P3: Recovery + Business + Trust** | **3 / 4** | Backup/restore, Panic/remote, DMS policy, пять тарифов/платежи, Admin/Analytics, rate limits, signed build/update | Panic→Recovery Key→restore, grace/downgrade, подтверждённый Web3 invoice, admin grant/ban audit, tampered asset rejected |
| **P4: S3 + Unlimited+ + Release** | **4 / 4** | Подключаемый личный S3, независимый резервный S3, собственный Matrix-сервер Unlimited+ по выбранному контракту, hardening и выпуск | Failover/repair/delete across all locations, cloud costs, Matrix custom homeserver acceptance, mobile/chaos/load tests, юридические тексты и отсутствие критических дефектов |

**Гейт закрытия этапа:** (a) код + API/схемы + миграции, (b) UI с настоящими данными, (c) проверенные права и E2EE, (d) offline/reload/retry/ошибки, (e) автоматические целевые тесты и ручная mobile приёмка, (f) owner acceptance. **Нельзя считать этап завершённым, если есть лишь HTML, README, зелёный unit test или незавершённый critical flow.**

### 26.2. Карта обязательных функций → этапы

| Функция | Первый законченный этап | Условие готовности PB3 |
| --- | --- | --- |
| PHP/Laravel security floor, новая репа, CI/мониторинг базиса | P0 | Verified runtime и зависимости в deploy |
| Identity, Recovery Key, PIN plumbing, шифрование, фото/видео/аудио, Local-First | P1 | Результаты P1 сохранены/восстанавливаются после reload и offline |
| StorageManager и абстракции S3 | P1 | Ни контроллеры, ни UI не вызывают provider напрямую |
| Настройки Dock, полный Fieldwork UX, камера, Browser, задания, Contacts/Teams, Editor, Public Card | P2 | Все подтверждены на реальном backend, без фейковых данных |
| Matrix Messenger на протоколе Matrix | P2 | Личные/командные E2EE сообщения и реальные вложения |
| Собственный Matrix-сервер Unlimited+ | P4 | Утверждённая модель/подключение, проверена федерация или независимая работа |
| Rolling Recovery Vault, Panic/Remote Wipe, Dead Man's Switch | P3 | Restore и destructive tests с точными статусами |
| Config-driven Free/Go/Pro/Unlimited/Unlimited+, Web3 Checkout | P3 | Серверные entitlements и проверяемый settlement |
| Administration & Analytics | P3 | RBAC/MFA, безопасные агрегаты и audit, без E2EE plaintext |
| Operational Limits (в том числе 1 backup/hour) | P1 framework → P3 full | Серверные лимиты с понятным Retry-After и защитой от гонок |
| Signed Release Manifest + SHA-256 + independent trust design | P0 design → P3 gate → P4 review | Пошагово проверена модель доверия и rollback |
| Собственный/дополнительный S3 для Unlimited+, резервный S3, repair/failover | P1 interface → **P4 работающая интеграция** | Тесты нескольких независимых providers и корректного GC |
| IPFS | **Не входит** | Нет backend реализации и тарифного обещания |

### 26.3. Конкретный стартовый backlog P0 (рекомендуемый порядок)

1. Создать `1troitsky/photobunker-v3` с независимой историей, подтвердить права доступа; добавить `ts.md`, `AGENTS.md`, переменные брендинга и продуктовые конфиги без привязки к UI-копирайту исторической версии.
2. Зафиксировать снапшоты PB2 `main@319e3bdd` и PR #56 `daca24a4` как **read-only reference**. Сделать инвентаризацию reusable commits/contracts/UI assets и список намеренно не переносимого кода; не использовать compat runtime как новый backend.
3. Подготовить pinned PHP (минимум 8.4.27 или 8.5.12), Laravel >=13.4, PostgreSQL 18, Vue/TS/PWA, Garage, seed/staging, локальный запуск.
4. Устранить воспроизводимые ошибки baseline (включая `routes/web.php` при подтверждении), затем проверить `php -l`, `artisan route:list`, migrations и контрольный upload → verify → finalize → readback; зафиксировать результаты.
5. Определить ADR для StorageManager, key envelopes/Matrix integration, backup lifecycle, retention revisions, BYO S3 auth, tariff registry, PWA signing trust и минимум threat model для Panic/Share.
6. Создать issues P1 по вертикальным сценариям, а не десятки косметических задач: Camera→encrypted queue→S3, Assignment A→B, Viewer/Editor→saved derivative, Matrix A↔B, Backup→Restore, Invoice→Entitlement, BYO/replica→failover. Запретить автоматический merge в `main`.

## 27. Нерешённые решения перед реализацией (OPEN)

| Вопрос | Уже заданная граница / безопасное поведение |
| --- | --- |
| Одна rolling backup или несколько? | **Сейчас одна**. UI расширяем на 2–3, но тарифы их не обещают. |
| Backup входит в облачную квоту? | **Да**, уникальные дополнительные bytes, не двойной учёт реиспользуемых chunks. |
| Короткий TTL снимков из старого задания (1/3/12 часов) | Указан в `ts(5).md`, однако PB2 min 24h и Camera 1.2 не подтверждает эту UI-настройку. Согласовать минимальную TTL-политику/пресет и безопасный GC до выпуска. |
| Go 4 / Pro 7 обновлений? | Нормализовано как **ручные** обновления, auto отдельно. Подтвердить смысл «Max Backup/week» перед биллингом. |
| Начало расчётной недели/таймзона автообновлений | Не установлено; server-authoritative календарь и timezone account, UI показывает следующее исполнение. |
| Реальный срок хранения Recovery Vault после отмены/понижения подписки | Не установлен; нельзя без договора тихо удалить последнюю точку. |
| Dead Man’s Switch и существующий backup | До отдельного решения не запускать необратимый план удаления recovery snapshot. |
| Как версионировать продление immutable `expires_at` | Требует контракт retention revision + security review. |
| Редактирование MP4 | Эталон поддерживает локальные trim bounds; MP4 export vs EDL требует решения о production. |
| Мультифайловый Share / Share целого задания | Дизайн входа есть, ACL/key wrapping/TTL/recipient/scope OPEN; Public Card не решает эту задачу. |
| Публикация safe video/audio и скачивание | Нужны per-media scopes и формат safe derivative, нельзя выдавать исходник. |
| Профиль Settings 1.6 | **WIP**; финальная UX-приёмка отсутствует, нельзя объявить окончательным. |
| «Детали задания» | В 5.0 нет отдельного финально утверждённого экрана. |
| Тарифная калькуляция GB vs GiB | В UI/биллинге единая метрика после утверждения. |
| Действия с избыточной квотой после grace | Сохранять данные fail-safe до оформленного решения/уведомлений, не удалять произвольно. |
| DePay / NOWPayments, токены, комисcии и auto-renew billing | Ни один SDK не подключён; invoice/settlement обязателен. Правила комиссии/возврата и налогов согласовать до production checkout. |
| BYO S3 и облачная квота | **Право Unlimited+ зафиксировано**; выбор primary/secondary обязателен; как считать BYO bytes/egress относительно общей квоты — `OPEN`, до решения лимиты не обходить. |
| Второй S3 по умолчанию | Репликация критичных live файлов заложена; какие именно классы файлов и replication factor — конфигурируемая политика/`OPEN` при первых настройках. |
| Свой Matrix-сервер Unlimited+ | **Право Unlimited+ зафиксировано**; нужно выбрать BYO homeserver как достаточный scope или managed dedicated instance, политику федерации и оплату инфраструктуры **до продаж**. Не отменять функцию, не подменять рабочей демоверсией. |
| Аналитика/приватность | Набор агрегатов и срок хранения событий должен быть документирован до включения персональных сигналов; plaintext и секреты исключены. |
| Bootstrap доверия PWA | Подписанный manifest обязателен; независимый публичный ключ/проверяющая среда должны быть закреплены вне произвольно изменяемого JavaScript, иначе не заявлять полной независимой аутентификации. |
| Стандартные лимиты операций | 1 backup/hour и 1 concurrent backup — **предлагаемые дефолты** технического конфига; для Unlimited+ auto 3/day scheduler учитывает 60-min interval и независимые тарифные квоты. Остальные resource limits — через конфиг и нагрузочные тесты. |
| Нативный экспорт в галерею | Только явное действие и системный share/save, не автоматическая запись. |
| Служба поддержки и юридические тексты | UI принято, содержимое/канал и policy требуют отдельной работы. |

### 27.1. Правила работы с открытыми решениями

`OPEN` не равно «можно выдумать». До старта соответствующей **опасной или платной** функции записать решение в `docs/adr/` или `docs/product/owner-decisions.md` с датой, правками контрактов, тестами и миграционным следом. Допустимо продолжать независимые архитектурные работы P0/P1, но нельзя отдавать в production технически не определённые обещания.

**Release blockers** (должны быть разрешены до активации соответствующей функции): юридические Terms/Privacy и тарифные формулировки; политика совместимости backup после Panic/TTL/downgrade; trust anchor для заявлений Self-Auditing; модель своего Matrix-сервера Unlimited+; entitlement/учёт BYO S3; настройки автоматического продления `expires_at`; опасные revoke/delete сценарии; безопасная публичная выдача media. Если нельзя разрешить автоматически, документировать безопасную блокировку/feature gate, **не теряя функцию из обязательного scope PB3**.

## 28. Файлы-источники и проверяемость

**Важно для нового репозитория:** URL `https://github.com/1troitsky/photobunker-new` в этом разделе — **технический источник PB2/PR #56**, а не публичное название продукта. Он оставлен действующим для чтения исходников. Все пользовательские названия и URL в PB3 должны формироваться из `BrandConfig` (`{{APP_NAME}}`, `{{APP_URL}}`). Новая разработка и issue tracker ведутся в `1troitsky/photobunker-v3`.

**Неподвижная версия PR #56:**

- [Каталог UX и статусы](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/README.md)
- [Shell Contract](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/UI-SHELL-CONTRACT.md)
- [Assignments 5.0](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/assignments/v5/README.md) · [Editor 2.2](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/assignments/editor/README.md)
- [Browser v3](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/browser/README.md) · [File Viewer 1.0](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/browser/viewer/README.md) · [Photo Editor 3.2](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/browser/editor/README.md)
- [Video & Audio Editor 1.1](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/browser/media-editor/README.md) · [Camera 1.2](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/camera/README.md)
- [Contacts & Teams 1.1](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/contacts-teams/README.md) · [Settings/Profile WIP](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/settings-profile/README.md) · [App Appearance 1.3 (Dock)](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/app-appearance/README.md)
- [Security 1.3](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/security-privacy/README.md) · [Data Storage 1.2](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/data-storage/README.md)
- [Messages 1.1](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/messages/README.md) · [Notifications 1.5](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/notifications/README.md)
- [Payments 1.1](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/payments-tariffs/README.md) · [Web3 Checkout 1.0](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/payments-tariffs/checkout/README.md) · [Public Card 1.1](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/public-card/README.md)
- [PIN/Device policy (историческое решение)](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/product/SECURITY-PIN-DEVICE-CONTRACT.md) · [Billing policy (исторические тарифы, НЕ использовать для PB3)](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/product/BILLING-TARIFF-CONTRACT.md)

**PB2 backend (фиксированная база аудита):**

- [Photo Sync](https://github.com/1troitsky/photobunker-new/blob/319e3bdd82e4640c385b42e7f32608bdc3add880/apps/api/app/Photo/PhotoSync.php) · [Reservation](https://github.com/1troitsky/photobunker-new/blob/319e3bdd82e4640c385b42e7f32608bdc3add880/apps/api/app/Photo/Reservation.php) · [Finalization](https://github.com/1troitsky/photobunker-new/blob/319e3bdd82e4640c385b42e7f32608bdc3add880/apps/api/app/Photo/Finalization.php)
- [Lifecycle](https://github.com/1troitsky/photobunker-new/blob/319e3bdd82e4640c385b42e7f32608bdc3add880/apps/api/app/Photo/Lifecycle.php) · [Gallery](https://github.com/1troitsky/photobunker-new/blob/319e3bdd82e4640c385b42e7f32608bdc3add880/apps/api/app/Http/Controllers/GalleryController.php)
- [Identity](https://github.com/1troitsky/photobunker-new/blob/319e3bdd82e4640c385b42e7f32608bdc3add880/apps/api/app/Http/Controllers/IdentityController.php) · [API Routes](https://github.com/1troitsky/photobunker-new/blob/319e3bdd82e4640c385b42e7f32608bdc3add880/apps/api/routes/web.php) · [Current CI](https://github.com/1troitsky/photobunker-new/blob/319e3bdd82e4640c385b42e7f32608bdc3add880/.github/workflows/pb2-draft-quality.yml)

**Примечание об источниках:** названия/версии и детальные UI-правила происходят из README и JS/HTML PR #56; факты существующего backend — из `apps/api` PB2; **цены, скидки, квоты и специальные права Unlimited+ в §8 — из `ts(5).md`, а не из устаревшей сетки PR #56**. Архитектурные сущности, контракты API, migration plan и рекомендации — целевая инженерная спецификация, а не описание уже существующих функций.