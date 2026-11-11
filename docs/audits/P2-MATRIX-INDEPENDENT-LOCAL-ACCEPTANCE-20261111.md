# P2 Matrix — независимый локальный security/integration-аудит

Дата: **11 ноября 2026**. Проверяемый продукт: [Draft #75](https://github.com/1troitsky/photobunker-v3/pull/75), **`e39b619dc9ec36eefc9ac322367e2d4348a1508e`**.
Задание: [PR #76, инструкция](https://github.com/1troitsky/photobunker-v3/blob/41b46bc8b5ac24ea42ee3af231e9d082c6cebee1/docs/audits/P2-MATRIX-INDEPENDENT-LOCAL-ACCEPTANCE-TASK-20261111.md).

**Итог: FAIL / BLOCKED для полной интеграционной приёмки. Предлагать весь стек для owner-approved merge — НЕТ.**
M-02 независимо воспроизведён настоящей подписанной ротацией Recovery Key. Дополнительно обнаружен отсутствующий Matrix proxy в Vite. Полноценный PB3 A→B, SAS/QR, доставка после reload, Lost ACK и восстановление истории не объявлены работающими: текущая реализация не предоставляет полный безопасный путь. Продукт, `main`, PR #75/#76 не менялись; merge/deploy не выполнялись. Исправлений продукта в этом QA PR нет.

## 1. Область и независимость доказательств

Прочитаны `AGENTS.md`, `ts.md §16/§19/§26`, `docs/status/CURRENT.md`, desk report #76, Matrix-контроллеры/миграции/тесты, реальные клиентские binding/escrow/trust/lease/outbox, Messages/drafts и соответствующие планы P2. `CHATBOT-AGENTS.md` в проверяемом worktree отсутствует. Принятый Messages 1.1 HTML использован как read-only структурный ориентир; его hash записан. Полное визуальное соответствие **NOT TESTED / NOT VERIFIED**.

Реальные регистрации выполнены через production UI и signed challenge/proof API; изолированные браузерные contexts, WebCrypto, IndexedDB, PostgreSQL и Synapse настоящие. PB3 authentication, Contact safety, signatures, whoami и lease **не подменялись**. Recovery Key rotation — реальный HTTP proof, без SQL изменения revision или присваивания фиктивной Session. Использовались только синтетические данные локальных fixtures.

Среда: macOS arm64, Node **22.23.3**, pnpm **10.20.0**, PHP **8.4.27**, Laravel **13.39.0**, PostgreSQL **18.6**, Synapse **1.161.0**, официальный `matrix-js-sdk` **44.0.0** и RustCrypto, Chromium/Playwright **1.56.1**. API source mounted read-only. Frozen vendor volume использован read-only после сравнения Composer lock. PHP security floor соблюдён. Локальный PHP8.5, production locks/load, физические Safari/iPhone/Android **NOT TESTED**.

Два изолированных fixture проекта: первый для обнаружения интеграционных/QA ошибок, второй для узкого escrow lifecycle. Audit Vite/API: loopback **5175/8002**, TLS proxy: loopback **443**, приватный hostname `matrix.pb3-audit.test`. Реальная TLS-проверка API и SDK сохранена: тестовый сертификат явно доверен только этому fixture; `verify=false` и `NODE_TLS_REJECT_UNAUTHORIZED=0` не применялись. Рабочее приложение владельца на5173/8000 оставлено отдельно.

## 2. Критерии задания

| Критерий | Результат | Независимое доказательство / точная граница |
|---|---|---|
| DAG #64→#66→#67→#68→#69→#70→#71→#72→#73→#74→#75 | **PASS** | Получены реальные base/head; fetched refs совпали; проверена ancestry каждого перехода. Это проверка состава, не функциональная приёмка. |
| Сохранение независимого docs commit `main` | **PASS** | `git merge-tree --write-tree` без конфликтов; все36 docs blobs и `.gitignore` совпали с `main`. Эфемерное дерево не стало веткой/коммитом, runtime этого дерева не проверялся. |
| Две Matrix-миграции, пустые таблицы | **PASS** | Реальный PostgreSQL: empty down/up восстановил3 таблицы; exit0. Дублирующих Matrix-файлов миграций нет. |
| Rollback заполненных binding/escrow таблиц | **PASS** | Оба `down()` отказались с `rollback_forbidden`; сравнение hashes всех строк подтвердило сохранность. Production migration reversibility/load не доказаны. |
| Два настоящих PB3 аккаунта и подтверждённые Contacts | **PASS** | Несколько ограниченных discovery runs достигли взаимного Contact подтверждения; safety number сравнен с собственным directory другого браузера. В сохранённом первом fixture2 настоящих Matrix account/device bindings и11 зарегистрированных синтетических PB3 аккаунтов после диагностики, без DB seed-вставок. |
| Настоящий PB3 signed binding → Matrix TLS whoami | **PASS** | Узкий финальный run: реальная регистрация, account+device signatures, Synapse whoami, SDK sync; отдельная доказанная часть интеграции. |
| Полный PB3 A→B, SAS/QR, cross-user trust, private room send/receive — M-01 | **BLOCKED** | **BY IMPLEMENTATION**. Send выключен; public adapter не выдаёт production synced client/SAS ceremony. Gate не обходился. Node cross-signing собственного fixture аккаунта не назван проверкой доверия собеседнику. |
| Credentials после реального browser reload | **PASS** | Перезагружена настоящая страница; дождались production online hydration; исходные sealed bound credentials прочитаны. Это не проверка восстановления Matrix sync/доставки. |
| Offline encrypted draft → reload → другой аккаунт | **PASS** | UI-only run: raw IndexedDB draft row без plaintext/UUID аккаунтов, реальный reload восстановил текст; после настоящего logout+Recovery Key login B чужой draft не появился. Это **draft**, не Matrix outbox. |
| Native Web Lock после уничтожения документа | **PASS** | Вторая вкладка отвергнута; reload первой освободил реальный Web Lock; вторая затем получила его. Не подменялся lease реального SDK клиента. |
| Offline Matrix outbox → reload → delivery / Lost ACK / same txnId — M-05 | **BLOCKED** | Полный production send путь недоступен из-за M-01. Существующий `vi.resetModules()` CI не переименован в browser reload acceptance. Локальный encrypted outbox send/retry не подтверждён. |
| Новый PB3 браузер / Recovery Key → исходный реальный Matrix4S seed | **PASS** | Seed создан официальным SDK и сохранён в настоящем4S; production PB3 escrow; новый браузер восстановил тот же seed; проверен MAC живого4S и неизменность исходного cross-signing root. |
| Неверный4S / неизвестный Recovery locator | **PASS** | SDK отверг random wrong4S; настоящий API возвратил404 для независимо созданного неизвестного валидного locator. Это не исчерпывающий аудит всех wrong-key атак. |
| Старый Megolm на новом браузере, старые устройства offline | **BLOCKED** | **BY IMPLEMENTATION**. PB3 seed bridge проверен; browser SDK provisioning/history restore отсутствует. Node-only protocol CI не повторялся как суррогат приёмки. |
| Genuine Recovery Key rotation → rev2 escrow — M-02 | **FAIL** | Signed rotate принят; новый браузер вошёл с revision2; GET escrow409, корректный подписанный/encrypted rev2 POST409; исходный ciphertext hash неизменен, строка осталась rev1. |
| Реальный device revoke / Panic и Matrix token revoke — M-03 | **BLOCKED** | Роут отзыва отсутствует, POST попытка404. Удаление local credentials и обычный PB3 logout не отозвали настоящий Matrix SDK token: whoami остался успешен. Настоящий revoke **не выполнен**, обход выполненного revoke не заявляется. |
| Конкурентный invite/join/policy между ACL preflight и Megolm — M-04 | **NOT TESTED** | Full production preflight/send недостижим. Не подставляли fake trust/lease; не доказаны ни получение ключа третьим лицом, ни защищённость гонки. Source risk остаётся OPEN/BLOCKED перед merge. |
| Messages fullscreen и Dock | **PASS** | Chromium1280×900 и390×844: после реальной160ms анимации overlay точно покрывает viewport и Dock; Send disabled; Escape и возврат focus проверены. Aesthetic parity **NOT VERIFIED**, mobile viewport не hardware. |
| API/Synapse logs | **PASS**, ограниченный | В реально выполненном узком run проверены точные Recovery Keys, access token и4S seed: совпадений0. Raw logs/ключи не публикуются. Общая безопасность любых будущих логов этим не доказана. |
| Stock Vite `/matrix/v1` — новый R-P2-01 | **FAIL** | JSON GET через Vite404; прямой exact-product API401 без auth. Production Vite config не содержит Matrix proxy. |

Доказательства: [runtime](evidence/P2-MATRIX-INDEPENDENT-runtime-20261111.json), [UI](evidence/P2-MATRIX-INDEPENDENT-ui-20261111.json), [DAG/tree](evidence/P2-MATRIX-INDEPENDENT-topology-20261111.json), [empty migrations](evidence/P2-MATRIX-INDEPENDENT-migrations-empty-20261111.json), [populated migrations](evidence/P2-MATRIX-INDEPENDENT-migrations-populated-20261111.json), [aggregate counts](evidence/P2-MATRIX-INDEPENDENT-first-fixture-counts-20261111.json), [source](evidence/P2-MATRIX-INDEPENDENT-source-20261111.json), [environment/routes](evidence/P2-MATRIX-INDEPENDENT-environment-20261111.json).

## 3. M-02: минимальное настоящее воспроизведение

1. Зарегистрировать PB3 A, войти в disposable Matrix, выполнить настоящий signed binding через TLS whoami.
2. Официальным RustCrypto создать cross-signing и4S/backup; AKEK-seal действительный32-byte4S seed production функцией `escrowMatrixSecretStorageKey()`. Подтвердить GET200 и исходный hash.
3. На новом браузере войти старым PB3 Recovery Key; `recoverMatrixSecretStorageKey()` возвращает тот же seed, реальный4S MAC корректен.
4. Новым PB3 Recovery Key зашифровать account package с revision2, сохранив account root/AKEK. Выполнить настоящий `purpose=rotate` challenge, проверить challenge, подписать account и device keys, отправить proof. Сервер подтверждает rotate.
5. Ещё один чистый браузер успешно восстанавливается новым Recovery Key с revision2. GET `/matrix/v1/recovery/ssss` → **409**.
6. Построить свежий корректный AES-GCM/HKDF escrow с rev2-bound AAD, новым operation/IV/keyId и действительной account signature. POST того же endpoint → **409**.
7. Прочитать именно строку A в PostgreSQL: revision1 и исходный `contract_hash` сохранены. Никакого overwrite/delete/снятия freshness checks.

Корень: [mine(), строка34](https://github.com/1troitsky/photobunker-v3/blob/e39b619dc9ec36eefc9ac322367e2d4348a1508e/apps/api/app/Http/Controllers/MatrixRecoveryEscrowController.php#L34) запрещает выдачу предыдущей ревизии; `store()` допускает существующую строку только при полном совпадении revision/hash/signature, а schema имеет единственный `account_id` PK. Корректный переход1→2 не представлен. Это доступность восстановления, не доказанная утечка и не доказательство безвозвратной потери всей истории: старые Matrix устройства/backup могут ещё существовать.

Нужна отдельная versioned remediation: append-only signed escrow epochs, parent/revision CAS под row lock, durable Lost ACK и монотонный recovery floor; сначала безопасно подтвердить новую обёртку, затем retirement старой. Отдельно определить переход при реальной смене AKEK/root. Не удалять единственный escrow и не ослаблять подписи/freshness. В этом аудите менялся Recovery Key, **root/AKEK оставались прежними**.

## 4. M-01 / M-03 / M-04 / M-05 и новый дефект

**M-01.** `matrix-rust-adapter.ts` инициализирует crypto без публичного `startClient()`/send handle; `MessagesView.vue` содержит disabled Send. Реальные signed PB3 cards не заменяют независимое Matrix cross-user SAS/QR. Full exchange заблокирован текущим объёмом реализации; включение кнопки ничего не докажет.

**M-03.** [Identity routes](https://github.com/1troitsky/photobunker-v3/blob/e39b619dc9ec36eefc9ac322367e2d4348a1508e/apps/api/routes/web.php#L33) имеют GET devices, но не routed `revoke()`; `route:list --json` это подтвердил. Более узкий корень, чем одно предположение «Matrix token не отзывается»: до реального PB3 device revoke публичным API дойти нельзя. Сам `IdentityController::revoke()` в source не является доступным user journey. Локальный credential delete/logout и последующий успешный Matrix whoami — наблюдение границы, **не** доказанный bypass уже выполненного отзыва. Panic не реализован/не выполнен. Нужен отдельный signed/idempotent device-revocation lifecycle с homeserver capability и offline retry, не отправка raw bearer token в Laravel и не переименование logout в Panic.

**M-04.** `matrix-text-outbox.ts` читает joined members/state перед асинхронным SDK send. Это не атомарная серверная ACL/key-release транзакция. `OnlySignedDevicesIsolationMode` полезен, но отсутствие third-party decryption теста остаётся существенным ограничением. Нужен контролируемый barrier после реального preflight, конкурентные invite/join/history/power-policy изменения и наблюдение выдачи Megolm key третьему получателю с настоящим production trust/lease. Пока это **risk/source review**, не подтверждённая утечка.

**M-05.** Успешные реальные reload credentials/drafts и Web Lock document-lifetime перечислены отдельно. Они не доказывают Matrix outbox ACK reconciliation, SDK crypto store recovery, холодный offline bootstrap или native PWA. unsigned Service Worker не включался. Известный CI module reset/fake-indexeddb gate остаётся отдельным доказательством.

**R-P2-01, FAIL, dev integration.** [Vite proxy](https://github.com/1troitsky/photobunker-v3/blob/e39b619dc9ec36eefc9ac322367e2d4348a1508e/apps/web/vite.config.ts#L37) содержит Identity/media/shares/assignments/teams, но не `/matrix/v1`. Production browser binding не достигает настоящего API при стандартном dev запуске. Для исследования downstream escrow был явно добавлен **только QA proxy** на отдельный8002, с сохранением Origin/CSRF/TLS/signatures. Это не исправление продукта и не PASS stock dev. Исправлять узким отдельным Draft PR с routing regression; само добавление proxy не снимает M-01/M-02/M-03.

## 5. Команды, exit codes и неудачные попытки

Скрипты: [README](../../scripts/p2-matrix-audit/README.md), [setup](../../scripts/p2-matrix-audit/setup.py), [topology](../../scripts/p2-matrix-audit/topology.py), [browser runner](../../scripts/p2-matrix-audit/browser.mjs), [focused escrow](../../scripts/p2-matrix-audit/escrow.mjs), [UI](../../scripts/p2-matrix-audit/ui.mjs), [migrations](../../scripts/p2-matrix-audit/migrations.php). `PRODUCT` — отдельный detached exact-SHA worktree; `RUN` — приватный disposable fixture directory, не пользовательский data directory.

| Выполненная команда/этап | Exit | Артефакт |
|---|---|---|
| `pnpm install --frozen-lockfile` в exact product | 0 | Frozen dependencies; environment |
| `python3 .../topology.py PRODUCT` | 0 после исправления quoting | topology JSON |
| `python3 .../setup.py PRODUCT RUN` для обоих fixtures | 0 | environment; реальный PostgreSQL/Synapse/TLS |
| `docker compose ... exec -T api php /audit/migrations.php` до enrollment | 0 | migrations-empty JSON |
| То же на заполненных таблицах | 0 | migrations-populated JSON |
| `PB3_AUDIT_FOCUSED_ESCROW=1 PB3_AUDIT_MATRIX_USER=third node .../browser.mjs PRODUCT RUN` | 0 | runtime JSON, включая **product FAIL M-02** |
| `PB3_AUDIT_UI_ONLY=1 node .../browser.mjs PRODUCT RUN` | 0 | UI JSON |

**Exit0 audit runner означает завершённые наблюдения, не зелёную приёмку продукта.** Неуспешные ранние checkpoints сохранены рядом с final JSON: general attempt01–06, focused escrow attempt01 и UI attempt01. [Полная обезличенная диагностика](evidence/P2-MATRIX-INDEPENDENT-diagnostics-20261111.json) разделяет:

- QA defects: Git quoting кириллицы; слишком точный UI status locator; SDK URL object в HTTPS adapter; default5s expectation при paced requests; async `waitForFunction` Promise в Playwright1.56; замер overlay до конца160ms entering animation.
- Environment limits: штатный общий PB3 throttle40/min и отдельный Synapse login429. Лимиты не отключались. Общий диагностический цикл остановлен; escrow исследован отдельно, без reset/overwrite старых данных/keys.
- Product defect: реальный Matrix dev404. Он не скрыт временной QA routing adaptation.

Первый discovery run с настоящими TLS bindings остановился позже в Contact card/rate-limit этапе. Не записывался как full two-user PASS. Повторно не запускались полные PHP/Vitest/Chromium/Synapse CI suites. Новые локальные probes проверяли границы, отсутствующие в CI mocks.

## 6. GitHub CI и disposition

Через GitHub API независимо прочитаны статусы **4/4 success на точном e39b619**: [Security42942155113](https://github.com/1troitsky/photobunker-v3/actions/runs/42942155113), [Foundation42942155087](https://github.com/1troitsky/photobunker-v3/actions/runs/42942155087), [PG/Garage/Chromium42942155022](https://github.com/1troitsky/photobunker-v3/actions/runs/42942155022), [Synapse42942155349](https://github.com/1troitsky/photobunker-v3/actions/runs/42942155349). [Metadata](evidence/P2-MATRIX-INDEPENDENT-ci-20261111.json). Это **GitHub CI evidence**, не локально повторённые независимые suites.

`main` для reconciliation: **`a8abcc55e73ea0a2d8be3a24052f814906b8bd1d`**, общий предок **`2c8ad9f6f18da9e87797d8df2cc0d6c3cf4eb7a6`**. Все11 heads и bases — [refs snapshot](evidence/P2-MATRIX-INDEPENDENT-refs-20261111.json). PR #76 — QA-only источник, не продуктовая зависимость. Зафиксированное ephemeral merge-tree доказывает отсутствие текстового конфликта и сохранение docs; не является разрешением на merge.

**Порядок merge/rebase/production rollback не предлагается: prerequisites не выполнены.** Безопасный порядок дальнейшей работы: отдельная routing correction; versioned escrow transition M-02; реальный revoke/Panic contract M-03; provisioning/SAS/synced-client integration M-01; затем полноценный A→B с browser outbox reload/Lost ACK, historical Megolm recovery и adversarial M-04, после чего exact-candidate review и отдельное решение владельца. Не сливать QA PR как скрытую продуктовую зависимость.

Локальная приёмка не подтверждает production готовность, mobile hardware, cold offline signed-PWA или owner acceptance. Связанные product security gates оставлены выключенными. В QA PR публикуются только отчёт, воспроизводимые scripts и sanitized statuses/counts/hashes; реальные synthetic tokens/Recovery Keys/4S bytes, raw logs, SQL dumps и screenshots/traces не публикуются.

Оба audit-стека остановлены после приватных `pg_dump`; исходные Synapse files и volumes сохранены. [Cleanup evidence](evidence/P2-MATRIX-INDEPENDENT-cleanup-20261111.json). Контрольный запрос к прежнему main-приложению не прошёл: Docker timestamps подтвердили, что его стек был остановлен **до начала этого аудита**. Main runtime не запускался/не останавливался аудитом; прежнее состояние оставлено. Первоначальное предположение об уже работающем main исправлено в evidence. Итоговая проверка QA scope/JSON/syntax/sanitization — `python3 scripts/p2-matrix-audit/check.py PRODUCT`, exit0; она сохраняет M-02 как **FAIL**.
