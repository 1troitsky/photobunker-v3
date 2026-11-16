> Исторический снимок до нового поручения на интеграцию. Текущее состояние и исправления: [core release audit](PB3-CORE-RELEASE-INTEGRATION-20261116.md). Исходные evidence этого снимка не изменены.

# PB3 — полный аудит PR, Issues, frontend и подготовки слияния

**Дата:** 16 ноября 2026, Asia/Tbilisi. **Решение:** **MERGE BLOCKED / MAIN НЕ ИЗМЕНЯЛСЯ**.

## 1. Поручение владельца и выполненное закрытие

Проверены все **285 PR**, **129 исходных Issues и 1 новая Issue после snapshot (итого 130)**, **289 исходных удалённых веток**, **1308 conversation comments** и **0 inline review comments**. Полная пагинация и исходные ответы API сохранены до закрытия.

Владелец прямо уточнил: **«Закрыть всё, остатки перечислить в аудите»** и **«пока не делай merge»**. В соответствии с этим закрыты все PR и Issues; это консолидация учёта. **Закрыто ≠ реализовано, принято или включено в main.** Незавершённые Issues закрыты с `state_reason=not_planned` для переноса учёта сюда; это **не отменяет обязательные требования `ts.md`**. Новые Issues/PR для замены закрытых не создавались.

- Открытых PR после проверки: **0**.
- Открытых собственно Issues: **0**.
- Локальный `main`: **`8ed66c438d090efd218efa80b027f0b2f854db4b`**.
- Удалённый `main`: **`8ed66c438d090efd218efa80b027f0b2f854db4b`**.
- Ветки, коммиты, пользовательские файлы и данные не удалялись; force-push, merge и deploy не выполнялись в этом аудите.

Проверяемые результаты операций: [closure proof](evidence/PB3-ALL-20261116/closure-proof.json), [журнал всех закрытий](evidence/PB3-ALL-20261116/closure-register.csv). Состояния до закрытия сохранены в реестрах отдельно от приёмки.

## 2. Где находятся код и документация

| Сборка | Точный код | Что это означает |
|---|---|---|
| Актуальный main | `8ed66c438d090efd218efa80b027f0b2f854db4b` | Уже объединённые P1/P2 модули и 117 исходных UX-файлов; 10 конкретных routed screens. Полной PB3 здесь нет. |
| Наиболее полный frontend, бывший PR #412 | `f4c7c91fe8100377c10d7af734c7ead90b217e7f` | Реальный Vue frontend, 26 конкретных маршрутов и 21 canonical surface/state из 22. PIN отсутствует; часть экранов содержит честные ограничения/disabled операции. |
| Защищённый donor подготовленной сборки | `783b6a7757b804d06d15426de2457f94e37ca741` | Сохраняет #403 logout barriers, независимые safety regressions, compiled local runner, account-scoped limits и восстановленный #66. Это **не** готовая замена более новому frontend #412. |
| Историческая подготовленная сборка | `edfaaee947940e4fe07fe8713565118dd39a4295` | База runtime evidence 15 ноября; 15 routed screens. Её старые PASS не переносятся на #412 или donor783 автоматически. |

Ветка данного аудита основана на точном frontend HEAD #412. Изменения в ней — аудит и реестры; продуктовый код #412 сохранён, **main с этой веткой не объединён**. Отдельная локальная donor-ветка сохранена для сопоставления исправлений.

Документация не потеряна: все **117 `docs/ux/**` файлов** побайтно совпадают с принятой PB2-базой `daca24a4a38c62473859b2b54b4999d50400c491` в main, прежнем candidate и #412. Сохранены 14 `docs/ux-integration` файлов и 23 HTML в карте. 23-й HTML DataStorage1.0 — исторический вариант действующего S16/1.2, не дополнительная отсутствующая функция.

Причина прежнего отсутствия документов в основной папке — локальный main оставался на `da7327b8...`. Он был fast-forward обновлён до `8ed66c43...` до начала этого аудита. Теперь `docs/ux` и `docs/ux-integration` есть в основной папке. Предварительно сохранены пользовательские изменения в `.local-delivery/owner-copy-before-main-sync-20261115/`; их исходные удаления/неотслеживаемые файлы не выдаются за потерю удалённой истории.

Начальные точки: [визуальная карта](../ux-integration/VISUAL-MAP.md), [реестр экранов](../ux-integration/SCREEN-REGISTRY.md), [UX-источники](../ux/README.md), [полная frontend-матрица](evidence/PB3-ALL-20261116/frontend-audit.md).

## 3. Проверка всей Git-истории

Собраны **3380** коммитов, достижимых из всех исходных удалённых/PR HEAD; **3381** с историческими GitHub merged commits; **3393** с дополнительно сохранённым local donor. В main достижимы 1555 коммитов. Разные числа описывают разные множества, а не пропавшую историю.

Проверены все **15 merge-коммитов** в достижимой истории main. Для пяти merge непосредственно в первой родительской линии main заново вычислен `git merge-tree --write-tree`; **5/5** ожидаемых деревьев точно совпали с actual trees, exit0. У внутренних ручных интеграций просмотрены реальные конфликтные файлы, а не только статусы GitHub:

- `349567c831c9` сохраняет product FileViewer, но incoming same-session guard уже присутствует; потери этого исправления не обнаружено.
- `031268fcef91` сохраняет Viewer-scoped status assertion; forged-page/count/security assertions сохранены.
- `c99fe952303d` сохраняет 31 UX и 133 source/docs пути; product Viewer/styles и UX Shell/router выбраны по проверенным источникам.
- `516b8a3ff558` сохраняет точные исходные product/AV/QA paths; дополнительные merge-only пути — аудит.
- У `f4bce2e1ab3e` вручную выбран более новый progress table при add/add конфликте. Его позднейшая неактуальность — долг отчётности, а не исчезновение UI-документов.

У ошибочно слитого в прошлом #290 merge **`9160cbf17b67af79b1950c3977260b7509c511f4`** действительно нет ancestry в текущем main. Но исходный HEAD **`f4bce2e1ab3e5ad72ec1d7e8c8f4d7517e286faa`** сохранён через #293, head `4521f7b9...`, merge `6565a0fe...`. Отсутствие того старого merge-коммита **не означает потерю его source tree**.

Не обнаружена массовая потеря файлов main: сохранены исторические apps/docs/scripts paths; `git fsck` не нашёл missing/corrupt objects. Это **не доказательство отсутствия любого семантического регресса**. Обнаружены конкретные пропущенные изменения между разными неслитыми кандидатами ниже.

Полные доказательства: [независимый Git-аудит](evidence/PB3-ALL-20261116/git-independent-audit.md), [матрица всех PR](evidence/PB3-ALL-20261116/pr-register.csv), [все ветки](evidence/PB3-ALL-20261116/branch-register.csv), [DAG](evidence/PB3-ALL-20261116/all-commit-graph.json), [каталог всех 495 документационных paths / 521 blob versions](evidence/PB3-ALL-20261116/documentation-catalog.json).

## 4. Что реально имеется во frontend

Полная матрица всех 22 областей, источников HTML, путей и трёх сборок находится в [frontend-audit.md](evidence/PB3-ALL-20261116/frontend-audit.md). Краткие функциональные границы:

| Область | Наличие в #412 | Фактический предел |
|---|---|---|
| Welcome / Loader / Authorization Error | Реальные Vue-состояния и create/recover flow | Только подтверждённая причина recovery error; полного набора серверных deleted/revoked/emergency состояний нет. |
| Camera / Assignments / Browser / Viewer / Editors | Существенные реальные encrypted/signed journeys, новая поверхность и controls | Визуальная приёмка всех состояний и физические устройства не подтверждены; есть failing acceptance. |
| Contacts / Teams / Profile / Appearance | Реальные local encrypted данные, signed Teams, device preferences | Local profile/visibility не публичный профиль, не global username и не server ACL. Языковая настройка не полный перевод приложения. |
| Security & Privacy | Реальные devices/session refresh/current-device signout | PIN/relock/Panic/remote revoke/key rotation/DMS не завершены. |
| Data & Storage | Реальная encrypted queue, retry/accounting, advisory backup status | Не backup worker, snapshot, восстановление или независимая реплика. |
| Notifications | Реальный encrypted local inbox и настройки | Server feed/ACK/target API и доставка не подключены; push не завершён. |
| Payments / Checkout | Живой server tariff catalog, текущие entitlement/grace, checkout layout | Нет принятого invoice/settlement/изменения прав по реальной оплате; Pay disabled. |
| Public Card / install | Deny-only public route и инструкции установки, private SafeJPEG consent | Нет завершённой безопасной публикации/token/read/TTL/revoke. Install guide не signed offline PWA. |
| Help / FAQ / Legal | Работающие offline FAQ/search и local support draft | Legal — draft; нет утверждённого канала отправки обращения. |
| Messages | Настоящие зашифрованные локальные черновики и fullscreen UI | Нет полного Matrix send/sync/rooms/history/attachments/calls и delivery. |

**Визуальное соответствие всех экранов, owner acceptance, native iOS/Android, permissions/background/codec/push — NOT VERIFIED / NOT TESTED.** Наличие маршрута, screenshots или Chromium не заменяет физическое устройство. Performance baseline/delta, Lighthouse и RUM не измерялись заново.

## 5. Подтверждённые пропуски и препятствия для merge

1. **HIGH — #402 logout barriers не перенесены в #412 семантически.** Сравнены `session.ts`: отсутствуют synchronous origin fence, cross-tab storage listener и повторные проверки marker/fence после async unseal/proof. Awaited logout сам по себе не защищает другую уже открытую вкладку. Источник защиты — #403 `f56e42ec3224bdd995f75c26abd47220469bda55`, сохранён в donor783. Dynamic reproduction именно #412 здесь NOT TESTED; code gap и отсутствие regression gate подтверждены.
2. **HIGH — пропущенное сохранение черновика #66 в старом candidate.** В `edfaaee9` ошибка IndexedDB/AEAD не препятствовала закрытию диалога и очистке текста. Существующее исправление `f927ce80...` восстановлено точечно и сохранено в donor783. Unit6/6 и TypeScript exit0; финальный post-fix полный E2E не принят. В #412 уже есть собственные guards, туда нельзя вслепую копировать старый View.
3. **MEDIUM — 3 новых UX spec #412 вне CI testMatch:** `p2-camera-fieldwork-ux.spec.ts`, `p2-camera-presets-ux.spec.ts`, `p2-contacts-team-profile-ux.spec.ts`. Все шесть шардов запускают только discovered tests; сам shard gate fail-closed, но эти файлы он не добавляет.
4. **MEDIUM — независимые safety regressions из #377/#380/#389/#394 отсутствуют в frontend-сборке.** Сохранить cloud clip/privacy/expiry assertions при объединении с более новым UI. Recovery export #401 заменён другим picker/share API #412; отсутствие старого filename само по себе не потеря функции.
5. **FUNCTIONAL — Notifications delivery не подключена.** Клиент обращается к `/notifications/v1/events`, `/ack`, `/events/:id/target`, но в mounted API/proxy нет соответствующей полной цепочки. Ledger/projection и local UI не являются доставкой.
6. **DOCUMENTATION — #292 audit-документ отсутствует в #412 при наличии его HEAD в ancestry.** Это конкретный пример, почему HEAD ancestry не доказывает сохранение всех файлов. Оригинал сохранён в source refs/bundle; canonical117 не затронуты.
7. **RUNTIME — исходный local Dockerfile #412 использует плавающий PHP tag.** Ранее он дал 8.4.26 и Composer остановил запуск ниже security floor. Проверенный pin8.4.27 и compiled Nginx runner сохранены в donor783; server/runtime security checks не ослаблены.

## 6. Фактические проверки

Получены check-runs на точных SHA всех PR и main: **286 разных HEAD**, из них **244 aggregate PASS**, **41 FAIL**, **1 NO_CHECKS**. Это исторические/разные ветки; **41 FAIL не означает 41 установленный дефект продукта**, а 244 зелёных HEAD не означают готовность общей сборки. [Полный реестр](evidence/PB3-ALL-20261116/ci-head-register.json).

**#412 `f4c7c91fe8100377c10d7af734c7ead90b217e7f`: FAIL.** В workflow [43821489589](https://github.com/1troitsky/photobunker-v3/actions/runs/43821489589) шесть шардов дали **124 PASS / 11 FAIL / 135 discovered tests**; shards1/2 и общий gate failed. Остальные25 check names этого HEAD success. Сводка: [exact-head CI evidence](evidence/PB3-ALL-20261116/pr412-ci-summary.json).

Failing scenarios: Assignments AV, Lost ACK и corrupt ciphertext, ACL revoke, media revisions, Teams invitation, Browser archive batch/conflict/preferences/delete и Contacts Blacklist. Девять завершились timeout/cleanup-context error, два — ожиданием hidden upload status. Без повторного воспроизведения/trace root cause не выдаётся за установленный продуктовый дефект, но acceptance gate остаётся FAIL. Три исключённых UX spec в135 не входят.

Историческая main-based подготовленная сборка 15 ноября: **105/110 Chromium**, **666/666 Vitest**, **314/314 PHPUnit на PHP8.4.27 и8.5.12**. Пять падений: четыре strict synthetic paid fixtures были запущены в неверном runtime namespace; одно — substring selector `Back`, совпадавший с FAQ text. Selector исправлен, fixture guards сохранены. Последующий targeted local run не завершён доказанным PASS: перенос QA namespace столкнулся с занятым15173. Это **ограничение окружения**, не основание ослаблять guard или объявлять зелёный результат.

Отдельно собранный Nginx frontend на persistent-cache PHP/PG18/Garage прошёл **2/2** обычных UI journeys: offline capture→sync→recovery cloud decrypt и A→B grant/read/revoke. Подтверждён и исправлен shared-IP budget defect без увеличения лимитов40/120; новые6 PHPUnit gates вошли в314. Это ограниченная приёмка прежнего candidate, **не** новый PASS всей #412/PB3. Детали и границы: [runtime evidence](evidence/PB3-ALL-20261116/issues-runtime-evidence.md).

В этом аудите не запускались заново весь продуктовый CI, production операции или physical-device проверки. Проверки Git/API/inventory/source integrity детерминированны; команды и exit evidence включены в component reports и verification artifacts.

## 7. Сохранение всех Issues и обязательного scope

Все **129 исходных Issues** имеют отдельную строку с title, исходным state/labels, acceptance, references/comment URLs, кодом и оставшимися требованиями: [реестр](evidence/PB3-ALL-20261116/issue-register.md), [JSON](evidence/PB3-ALL-20261116/issues-audit.json), [CSV](evidence/PB3-ALL-20261116/issues-audit.csv).

Оси разделены: `implementation_presence`, `available_evidence`, `audit_reacceptance_status`, `final_head_acceptance`. Статус NOT TESTED здесь означает отсутствие полной повторной приёмки текущего HEAD, а не отсутствие ранее работавшего кода. Подтверждённые GPS/logout/drafts/export/recovery поднаборы сохранены отдельно.

Обязательный незавершённый scope остаётся в реестре: Matrix E2EE; Notifications delivery/push; PIN/Panic/DMS/remote wipe; immutable Vault backup/restore; real payment settlement; Safe Public Card publication; MFA/Admin/analytics; BYO/replica/failover/GC; trusted signed PWA/cold offline/bootstrap/rollback; physical devices/performance/release acceptance. **Closure не удаляет эти требования из PB3.** Точные номера и критерии: [Issues audit](evidence/PB3-ALL-20261116/issues-audit.md).

### 7.1. Новая Issue после исходного закрытия

В 08:04:30 UTC другим участником создана **#415 — Camera/Photo Fieldwork 1.2**. Она также сохранена и закрыта; полный scope и новая ветка `ec3670a1970e9be55c815aed6920b760c8c3ad30` включены в [дополнение](evidence/PB3-ALL-20261116/post-snapshot-issues.md). Приёмка этой ветки — **NOT TESTED**, остаток — **TRANSFERRED_UNRESOLVED**. Исходные 129 Issues остаются в неизменной подробной матрице; с дополнением охвачены все **130** на финальный момент **2026-11-16T08:08:29.999091+00:00**. В этот момент открытых PR/Issues — **0/0**, исходные 289 branch HEAD неизменны.

## 8. Предложенный порядок будущей интеграции

Это план подготовки проверяемой сборки, **не разрешение и не команда на merge**:

1. Использовать точный #412 `f4c7c91fe8100377c10d7af734c7ead90b217e7f` как source наиболее полного frontend. Не повторять ручное объединение всех старых UI PR и не заменять новый View более старым только ради ancestry.
2. Сохранить семантику #403/#402 и её negative regressions, согласовав с новым bootstrap #412. Сопоставить проверенный PHP pin/compiled runner/account budgets из donor783. Новое recovery-key-save и guards Messages #412 сохранять по их действительному контракту.
3. Вернуть независимые safety gates #377/#380/#389/#394. Добавить три пропущенных UX spec в явный discovery, не ослабляя их assertions; восстановить traceability отсутствующего audit-doc.
4. Разобрать11 failing acceptance scenarios на точном общем HEAD: продуктовый дефект / stale UI harness / среда. Сохранить первоначальную диагностику; после двух неудач одной причины остановить диагностический цикл. Не скрывать падения retry/skip/timeout inflation.
5. Выполнить Foundation на обеих поддерживаемых PHP, strict TypeScript/build/Vitest, реальный PG18/Garage и полную Chromium suite на **общем** SHA; отдельно compiled UI journeys. Результаты родителей и прежних HEAD не переносить.
6. Принять отдельное owner/device/release решение по остающимся обязательным функциям. Matrix не подключать автоматически, unsigned SW не включать, destructive/GC/production payment не активировать ради теста.

Нет корректного порядка «merge всех285 PR подряд»: часть уже в main, часть byte-equivalent, часть superseded, часть конфликтует или содержит только preflight. Полная path/SHA/source матрица позволяет выбрать конкретные изменения без потери более новых исправлений.

## 9. Архив и воспроизводимость

Каждый исходный PR HEAD и remote branch сохранён в локальных `refs/audit/20261116/**`; исторический merge290 тоже сохранён. Локальный проверенный Git bundle и исходные API bodies/comments находятся в **приватной** `.local-delivery/audit-all-20261116/raw/`. Они не публикуются в документации. [Bundle/ref manifest](evidence/PB3-ALL-20261116/git-preservation.json) содержит SHA256, размер и exit0 `git bundle verify`.

Обезличенные реестры и component audits находятся в `evidence/PB3-ALL-20261116/`. Полные исходные body/comment тексты не являются активными инструкциями; unsafe/OPEN требования из них не выполнялись автоматически. Секреты локального runtime, Recovery Keys, media plaintext и private credentials в аудит не включены.

Контрольная проверка артефактов: `python3 scripts/audits/verify-all-prs-issues-20261116.py`. Она проверяет полноту285 PR /129 исходных +1 дополнительной Issue /289 исходных веток, состояния после закрытия, main SHA, canonical source proof,135-test outcome, реестры и файловые hashes без LLM/сети. Результат — `audit-verification.json` в evidence.

**Итог:** источники и требования сохранены, GitHub учёт закрыт по явному решению владельца. Полная готовность приложения и разрешение на merge из этого не следуют. **MAIN НЕ СЛИТ. MERGE BLOCKED** перечисленными выше acceptance/security/functional остатками.
