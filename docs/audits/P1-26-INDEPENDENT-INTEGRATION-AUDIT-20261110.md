# P1-21–P1-26 + scoped grants v2 — независимый интеграционный аудит

**2026-11-10. Вердикт: PASS в проверенном интеграционном scope; кандидат готов
к рассмотрению на merge. Подтверждённых блокирующих дефектов продукта не найдено.**
Это не разрешение на merge/deploy, не приёмка P1 целиком и не проверка физических
устройств. Исходные неудачные QA-прогоны сохранены, общий исходный run не назван зелёным.

## Точные исходники и dependency graph

- Проверен [PR #46](https://github.com/1troitsky/photobunker-v3/pull/46) / `p1/integration-contacts-scoped-grants`
  @ **`2c1406586dd819357bd3fcc933985f616ce72d39`**. Свежие fetch/PR metadata до
  запуска и повторная проверка после аудита дали тот же HEAD.
- База [#44](https://github.com/1troitsky/photobunker-v3/pull/44): `f13ad76929916ecfbb2ef0d5fd7a5a284f680e02`.
  Независимый источник [#45](https://github.com/1troitsky/photobunker-v3/pull/45): `3a5f5cf1d5f96c5e903e0099261081919b3236e1`.
  Общий предок: P1-21/#39 `3c499d672ad108ce1c2109c2b7a58e22f20f235b`.
- Полный [dependency graph](pr46/DEPENDENCIES.json) и [результат ancestry/patch/migration audit](pr46/STATIC-EVIDENCE.json):
  **35 продуктовых PR HEAD являются предками #46**. В проверяемой части:
  #39 → #40 private instructions → #41 roster → #42 camera guidance →
  #43 encrypted Contacts → #44 picker → #46. #45 ответвлён от #39; его изменения
  перенесены, но его commit не является предком #46. Аналогично прежняя camera
  ветка #19 параллельная; QA #13/#17/#27 не входят в продуктовую цепь.
- #46 имеет ровно одного родителя — точный #44. Во временном plain-file tree
  полный diff #45 (кроме намеренно сохранённой более новой status page) применён
  к #44: **20/20 результатов побайтно совпали с #46**, включая пять overlap-файлов.
  Прочие файлы #44 сохранены; добавлен только integration checkpoint и одна
  строка статуса. Нет wholesale переноса старого snapshot поверх P1-26.
- Все **18 прежних миграций неизменны**, новая только
  `2026_11_10_000006_add_assignment_scoped_recipient_grants.php`: nullable FK/index
  в photo/media grants; повторных имён нет. Старые signed v1 domains, canonical
  JSON, key hierarchy и TTL не переписывались.
- Продуктовые worktree #44/#46 detached и не изменены. QA-ветка
  `qa/p1-26-integration-audit` основана на #46; один Draft PR направлен в его
  интеграционную ветку. `main`, исходные PR, SW и пользовательские документы не менялись.

## Реальные команды и артефакты

Из отдельного QA checkout с locked dependencies и свободными 8000/5173/4173:

```sh
python3 -B scripts/integration-audit/analyze.py
python3 -B scripts/integration-audit/run.py \
  --source-root /private/tmp/pb3-pr46-audit-product \
  --baseline-root /private/tmp/pb3-pr44-audit-base
```

Точечные прогоны добавляют `--focused-journey`. Они не повторяют успешные
migration/adversarial/expiry suites. Полные PHPUnit/Vitest/17 E2E CI намеренно
не перезапускались: [существующие workflow conclusions на точном HEAD](pr46/CI-REFERENCE.json)
проверены через GitHub API — три PR workflow success (также три push success).
CI сообщает PHP 80/1371 на 8.4/8.5, Vitest 110/110, TS/build, Chromium 17/17;
это **CI reference**, а не результаты нового локального запуска.

| Локальный run | QA source SHA | Факт / exit | Sanitized evidence |
| --- | --- | --- | --- |
| `pc47_cos` | `f32864208bbe8b4fb60b581ab60a57c152f80bf9` | 4 passed / 1 QA failure; **exit 1** | [Integrated](pr46/INTEGRATED-EVIDENCE.json) |
| `3n7eh5qo` | `39967b940843ca44a30ff5f1aa6a5cee1ef63a0e` | Warm-cache precondition не выполнена; **exit 1** | [Cache diagnostic](pr46/WARM-CACHE-DIAGNOSTIC-EVIDENCE.json) |
| `v9y53pt_` | `c91c2a64583400dcbdbc62a321e95f60d342d435` | Offline instructions прошли; MIME ошибка QA adapter; **exit 1** | [MIME diagnostic](pr46/MIME-DIAGNOSTIC-EVIDENCE.json) |
| `8z94xfwz` | `5d4f08f691ea4b74a33ac2c51d7401c77db3298c` | Весь исправленный journey + privacy scan; **exit 0** | [Verified journey](pr46/JOURNEY-VERIFIED-EVIDENCE.json) |

Среда исходного run: macOS **26.6.2**, Node **22.23.3**, pnpm **10.20.0**,
PHP **8.4.27** (security floor реально выполнен), Composer **2.10.3**,
PostgreSQL **18.6**, Garage **2.5.0**, Playwright **1.56.1**, Chromium **141.0.7390.37**.
Версии, команды, cwd, exit codes, длительности и allowlisted proofs — в JSON;
каждый targeted run честно указывает, какие версии отдельно не перепроверялись.

## Матрица независимых проверок

| Интеграционный риск | Вердикт | Фактическое доказательство |
| --- | --- | --- |
| Patch transport / dependency chain / schema names | **PASS** | `analyze.py`, exit 0; 20 файлов, 35 ancestors, 18 неизменных миграций + 1 новая |
| Upgrade реальной старой БД без потери контрактов/объектов | **PASS** | PR44 API сначала создал/выдал signed v1 photo/video/audio; до/после upgrade совпали count + hashes полных строк восьми таблиц; legacy `assignment_id` стал NULL |
| Старые personal v1 после upgrade | **PASS** | Тот же browser identity/profile: все три recipient decrypt/hash и contributor cloud decrypt/hash совпали; никаких фиктивных SQL grant fixtures |
| Contacts → picker → signed invite → accepted roster | **PASS** | Контакт независимо подтверждён в UI; до явного Send roster=0; затем pending и accepted с реального API |
| Private instructions P1-22/P1-24 + offline | **PASS** | Private revision v2 действительно проверена/кэширована online; в warm-offline camera все три инструкции совпали по hash; локальные rows — ciphertext |
| A → B → A photo/video/audio v2 | **PASS** | Video/audio записаны настоящим Chromium MediaRecorder с fake hardware; photo — synthetic canvas JPEG; реальный ECDH/AES-GCM/outbox/SQL/Garage; все три plaintext hashes совпали у A и B |
| Lost grant ACK и submission ACK | **PASS** | Сервер commit через `route.fetch()` → response abort → reload → retry; два exact signed grant replays unchanged; submission replay unchanged; итог **1 photo + 2 media** без дублей |
| Offline/reload сохраняют ciphertext и stable IDs | **PASS** | Сравнение photo/operation/asset/media/chunk IDs и hashes до/после reload, retries и sync |
| Same-owner sibling assignment / pending contributor / wrong owner | **PASS** | Для photo/video/audio cross-assignment submit **403**, pending grant **403**, wrong assignment owner **403**; официальный pending preflight не добавляет grant |
| Forged fingerprint / directory / signature domain | **PASS** | Fingerprint mismatch и изменённая directory signature отвергнуты клиентом; v1 domain для v2 grant — **401** на сервере |
| Криптография сильнее server metadata | **PASS** | Для всех трёх медиа altered assignmentId с прежней подписью отвергнут; после действительной новой contributor signature старый DEK envelope с чужим assignment AAD даёт **OperationError**; исходный grant продолжает расшифровываться |
| Смена аккаунта и Recovery | **PASS** | В том же profile чужие локальные списки пусты, decrypt запрещён, old-photo API **404**; реальный Recovery proof восстанавливает собственные originals без смены ciphertext IDs |
| Grant TTL / signed schedule / signed retention | **PASS** | Own expiry **410**; beyond signed cutoff **422**; новый v2 после schedule end **409**; существующий read действует до отдельного retention cutoff, затем **410** |
| Прямой ciphertext доступ и replay после cutoff | **PASS** | Object/chunk endpoints **410** для всех типов, `/received` скрывает scoped grants; прежний exact POST ACK unchanged не возвращает read rights |
| Personal v1 независим от assignment и запрет чужого удаления | **PASS** | Те же файлы по personal v1 **200** и decrypt после cutoffs; signed `deleteOriginals:true` **422**; статус physical deletion false/not_authorized; contributor cloud hashes прежние |
| Приватность: Contacts, инструкции, метаданные, очередь/БД/logs | **PASS в проверенном flow** | Canary-строки отсутствуют в контактном row, photo/media/assignment IndexedDB rows, исходящих HTTP; read-only pg_dump и container-log scan exit 0. Внешний криптоаудит этим не заменён |
| Trusted cold-offline PWA bootstrap | **BLOCKED BY DESIGN** | Независимый anchor отсутствует; SW не включался. Cold document reload не считается принятой функцией |
| Native Safari / физические iPhone/Android, hardware permissions/GPS/gallery | **NOT TESTED** | Физических проверок не выполнялось; Chromium fake media не является hardware acceptance |

## Диагностика и оставшиеся риски

**Продуктовых merge blockers в выполненных сценариях не выявлено.** Подтверждены
три ошибки/предусловия QA harness; продукт ради зелёного теста не менялся:

1. `listAssignmentParticipants()` возвращает массив, а первое ожидание читало
   `items.length`. Исправлен только тест.
2. Публичная cached assignment card может появиться до online proof и заполнения
   encrypted private summary. Отключение сети в этот момент не является warm-cache
   acceptance. Добавлены ожидание настоящей reauthentication, online refresh и
   verified cached private version=2. После этого offline инструкции прошли.
3. QA adapter использовал codec-qualified `recorder.mimeType` вместо выбранного
   canonical MIME. Продуктовый CaptureView сохраняет `{type:mime}` из собственного
   allowlist. Adapter приведён к этому контракту; MIME/security checks не отключались.

Всего один полный интеграционный run и три целевых диагностики разных причин;
исходные failures не переписаны в PASS. Повторения успешных CI-наборов и циклов
одной причины не было.

Документационный долг: `docs/status/CURRENT.md` и исходный integration checkpoint
на проверяемом SHA ещё говорят «CI/local audit PENDING». Реальный CI проверен
отдельно выше; эту устаревшую status prose не использовали как факт. Продуктовая
status page не исправлялась в QA-ветке.

Для решения о merge учитывать незакрытые границы: весь Draft dependency stack
ещё не интегрирован в main; #45 — параллельный источник, а не дополнительный
необходимый merge поверх уже перенесённого патча. Upgrade проверен; rollback
после выдачи v2 **NOT TESTED** — `down()` удаляет scope columns, поэтому его нельзя
выдавать за проверенный безопасный downgrade. Большие migration locks/production
load, BYO/replica storage, внешний полный crypto audit и все P1 journeys не проверялись.
Владельцу остаётся принять решение по стеку и перечисленным release gates.

## Изоляция и воспроизводимость

Четыре независимых случайных Compose project: новые credentials, tmpfs PG/Garage,
новые accounts/browser contexts, private copy API; product mount :ro. Для upgrade
менялся только private runtime copy #44→#46. Все cleanup commands exit **0**; после них собственных QA containers не осталось;
реальные данные, ключи, соседние контейнеры и пользовательские файлы не тронуты.
Все 37 локальных пользовательских файлов сверены с исходными SHA-256, Git status исходной папки сохранён.
Locked dependencies и архитектура не переписывались; новых зависимостей нет.

[Runner и provenance](../../scripts/integration-audit/README.md). Raw profiles,
Recovery Keys, private instructions, исходные записи, traces/logs и canaries
остаются только в private temporary run directories. JSON публикует только
synthetic IDs/timestamps, ciphertext/row/source hashes, коды и boolean proofs.
Performance/визуальная эстетика **NOT VERIFIED**: продуктового diff нет, benchmark
и полная UI-приёмка не входят в этот ограниченный интеграционный аудит.

Публикационный safety gate: `python3 -B scripts/integration-audit/validate.py` с
четырьмя `--private-run` — **exit 0**: counts/proofs, Git SHA-256 и отсутствие
реальных fixture credentials/private canaries в опубликованных JSON/отчёте.
`git diff --check` и protected product diff — **exit 0**.
