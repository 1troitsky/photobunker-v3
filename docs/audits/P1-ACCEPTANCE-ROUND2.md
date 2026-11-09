# P1 acceptance — Round 2, 2026-11-09

**Lost ACK закрыт: 3/3 на базе QA и 3/3 на PR #14.** Полная приёмка остаётся
открытой: подтверждены два продуктовых дефекта, безопасный offline bootstrap
**BLOCKED BY DESIGN**, native Safari и физические устройства **NOT TESTED**.
Продуктовый код не исправлялся; merge/deploy не выполнялись.

## Проверенные исходники и команды

- QA base: `qa/p1-local-acceptance` @ `5d6116ae222b0694344f42f2b9a8d5a853682dc4`.
- Новая ветка: `qa/p1-acceptance-round2`; целевая ветка Draft PR — QA base.
- PR #14 на момент получения: `p1/04-signed-state-transitions` @
  `fa6fabd103956942e602fa1124fc62ea3e858567`. Проверен отдельный **detached** worktree
  `/private/tmp/pb3-round2-integration.nxE7Ed`. QA-коммиты в него не переносились.
- Worktree остался без tracked-изменений. В QA checkout изменены только
  `scripts/local-acceptance/`, `tests/local-acceptance/`, `docs/audits/`.
  Локальные пользовательские `ts.md`, макеты и задания сохранены побайтно.
- Изучены правила, P1 capture-policy v2, signed-state design, исходные тесты,
  session/camera/outbox и серверная проверка исторических интервалов.

Из QA checkout:

```sh
python3 -B scripts/local-acceptance/round2.py
python3 -B scripts/local-acceptance/round2.py \
  --source-root /private/tmp/pb3-round2-integration.nxE7Ed \
  --source-ref fa6fabd103956942e602fa1124fc62ea3e858567
```

Для свежего worktree используйте `git worktree add --detach /TEMP/PATH SHA`,
подставив свой временный путь. Runner проверяет HEAD и diff относительно SHA,
не делает fetch/switch/merge и не меняет продуктовые ветки.

Точечные команды добавляют `--browser-suite product`, `state`, `late-capture`
или `lost-ack`. `state` включает отдельный camera regression; `late-capture`
не повторяет этот известный отказ. Во всех случаях окружение новое, с отдельным
Compose project, tmpfs DB/S3, credentials и временной копией API. Исходные
PostgreSQL/Garage smoke guards не ослаблены. PHP security floor не обходился.

## Артефакты и фактические exit codes

JSON содержит нормализованные команды/cwd/log paths, exit codes, версии,
результаты browser tests и разрешённые proof attachments. Успех отдельного
шага не означает успех полного acceptance.

| Артефакт | Run | Итоговый exit | Назначение |
| --- | --- | --- | --- |
| [Baseline](P1-ROUND2-BASELINE-EVIDENCE.json) | `70ysud8e` | 1 | Lost ACK 3/3, исходные E2E 4/4, offline probes; Safari timeout |
| [PR14 initial](P1-ROUND2-INTEGRATION-EVIDENCE.json) | `391l_97v` | 1 | PHPUnit/Vitest, Lost ACK 3/3, QA 4/4; диагностика loader/camera/Safari |
| [Product E2E recheck](P1-ROUND2-PRODUCT-RECHECK-EVIDENCE.json) | `2kj6gj40` | 0 | Исправленный cwd harness; исходные E2E PR14 **4/4** |
| [State/camera diagnosis](P1-ROUND2-STATE-DIAGNOSTIC-EVIDENCE.json) | `4uevh_14` | 1 | Подтверждённый camera hydration failure, signed-state checks passed |
| [Lifecycle and timestamps](P1-ROUND2-LIFECYCLE-EVIDENCE.json) | `fcha42jk` | 1 | 2 passed / 1 failed; сравнение временных границ и успешная полная lifecycle-цепочка |

Приватные originals находятся в `$TMPDIR/pb3-acceptance-RUN/`: `summary.json`,
JUnit в `api/`, Playwright JSON, server logs и read-only `state-timestamps.log`.
Raw traces, изображения, request bodies, Recovery Keys, DEKs и credentials
не опубликованы. JSON timing evidence содержит только синтетические assignment
IDs, состояния и timestamps. Экспортёр проверен на фактическом PostgreSQL
формате `+00` под Python 3.9; ошибки старого экспортёра не переписаны в PASS.

Среда: macOS 26.6.2 arm64, Python 3.9.6, Node 22.23.3, pnpm 10.20.0,
Docker 29.8.2 / Compose 5.5.0 / OrbStack, PHP **8.4.27**, Composer 2.10.3,
Laravel 13.39.0, PostgreSQL **18.6**, Garage **2.5.0**, Playwright 1.56.1,
Chromium 141.0.7390.37 headless. Native Safari driver: 26.6.2 (21624.5.1.11.3).
PHP 8.5 не запускался.

## Матрица сценариев

| Сценарий | Статус | Команда / проверяемое свидетельство |
| --- | --- | --- |
| Локальный JPEG → AES-GCM → IndexedDB | PASS | `lost-ack-stability`, exit 0, 3/3 на каждой базе |
| Сервер commit, клиент теряет finalize ACK | PASS | Реальный `route.fetch()` возвращает 200, клиентский response оборван; proof `lostAcknowledgements:1` |
| Reload после потерянного ACK | PASS | `reload-after-lost-ack`: неизменные account/photo/operation/asset IDs и ciphertext digests |
| Две отправки одного подписанного reserve | PASS | Два реальных HTTP replay, оба `active`; `serverPhotoCount:1` |
| Повторная загрузка из Garage и decrypt | PASS | Реальный GET ciphertext объекта, 200; изображение декодируется, plaintext hash совпадает с local decrypt |
| Сохранность bytes на всей lost-ACK цепочке | PASS | 8 checkpoints, `ciphertextRetained:true`; без удаления/перезаписи QA |
| TypeScript / Vitest / production build | PASS | `typecheck`, `vitest`, `production-build`, exit 0; baseline 15, PR14 18 Vitest tests |
| PHPUnit | PASS | `phpunit`, exit 0: baseline 27/227 assertions; PR14 **33/305** |
| Composer strict / PHP lint / plans / routes / health/readiness | PASS | Именованные checks, exit 0 в JSON |
| PostgreSQL/Garage readback и lifecycle | PASS | Оба исходных integration scripts, exit 0 на каждой базе |
| Исходные A→B→A E2E PR14, policy v2, finish/resume | PASS | `product-e2e` recheck, exit 0, **4/4**; продуктовые тесты не изменены |
| Policy tamper / forged state / stale revision | PASS | `state-integration`: tamper отвергнут, HTTP 401/409 |
| Idempotent state replay / observed-state rollback | PASS | Повтор unchanged/revision 2; `assignment.state_rollback`; resume revision 3 |
| Capture до finish, sync спустя ≥1.5 s по серверному времени | PASS | Lifecycle aged case: реальная подпись v2, encrypted outbox, PostgreSQL/Garage |
| Submission во finished → resume → E2EE grant/decrypt | PASS | Aged case: 409 до resume; revision 3, один submission, owner decrypt |
| Revoke после resume, фото contributor остаётся | PASS | Grant read 410, submissions 0, contributor cloud decrypt и прежние ciphertext bytes после reload |
| Capture непосредственно перед finish в той же секунде | **FAIL** | R2-01: HTTP 409, локальная очередь `conflict`; bytes сохранены |
| Late camera permission после session hydration | **FAIL** | R2-02: `camera-reload`, exit 1, `automaticallyStarted:false` |
| Cold offline reload — Vite dev | **BLOCKED BY DESIGN** | Probe завершён, но `renderedOffline:false`, no SW/controller/cache |
| Cold offline reload — production preview | **BLOCKED BY DESIGN** | Тот же результат с собранным fingerprinted bundle |
| Installed PWA с будущим signed SW | **BLOCKED BY DESIGN** | Нет согласованного независимого bootstrap; hardware execution NOT TESTED |
| Native Safari registration/reload/IDB/camera/navigation/offline recovery | **NOT TESTED** | Два native WebDriver probes завершились timeout; полного native результата нет |
| Физический iPhone / Android, gallery/GPS/background permissions | **NOT TESTED** | Устройства не использовались; Chromium fake camera не заменяет hardware |

`offline-readiness` имеет exit 0 как выполненный **measurement probe**; он
публикует отдельный readiness status `BLOCKED BY DESIGN`, а не offline PASS.
Нет общего зелёного acceptance результата, P1/production готовность не заявляется.

## R2-01 — P1: валидный offline capture отклоняется на subsecond finish boundary

Воспроизведение: создать/принять задание; offline сохранить v2 JPEG через
штатные `signedCaptureBinding` и `captureEncrypted`; после завершения capture
немедленно отправить owner-signed finish с другого context; восстановить сеть
и синхронизировать contributor outbox. Ожидается personal upload до-финишного
снимка без возможности submission до resume. Факт: `/photos/v1/reserve` → 409,
очередь становится permanent `conflict`.

В fixture capture **предшествует запросу finish**. Сохранено:

- `capturedAt = 1794234528100` (14:28:48.100 UTC).
- `assignment_state_events_v1.created_at = 2026-11-09 14:28:48+00`
  → `1794234528000`, на **100 ms раньше** claimed capture.
- При aged capture: `1794234545945`, finish `1794234548000`; sync и весь
  последующий lifecycle проходят, bytes не меняются.

Причина подтверждается кодом и данными: `changeState()` записывает `now()` через
Query Builder; установленный Laravel форматирует DateTime bindings как
`Y-m-d H:i:s` (`Connection::prepareBindings`, `Grammar::getDateFormat`).
`Reservation::requireCaptureAuthority()` сравнивает millisecond `capturedAt`
строго с сохранённой границей `$when < $at`. Потеря дробной части ошибочно
перемещает границу. Это не нарушение/подделка подписи и не потеря ciphertext.

Блокирует корректную синхронизацию недавно снятого offline фото после finish.
Fixture с настоящим server-time fence показал, что историческая синхронизация
вдали от границы работает. Никакой timestamp не подделывался для обхода ACL.
Рекомендация владельцу продукта: определить точность и сохранять authoritative
event time совместимо с wire milliseconds; отдельно сохранить fail-closed
проверки закрытых интервалов. Продуктовый код QA не менял. После двух отказов
immediate-case цикл диагностики остановлен.

## R2-02 — P2: камера не восстанавливает автоматический запуск после hydration

Контролируемый browser repro использует настоящие login proof и getUserMedia
с fake Chromium device; QA удерживает только порядок их завершения:

1. Зарегистрировать trusted device, перейти полноценной навигацией на `/camera`.
2. Удержать online login proof, пока локальная сессия уже вызвала getUserMedia.
3. Разрешить proof и дождаться online session; затем вернуть camera stream.
4. Ожидать автоматическое подключение видео. Факт: `videoWidth=0`, start button
   доступна, автоматического повторного запуска нет.

`openCamera()` запоминает объект локальной Session. Online hydration создаёт
новый объект; late stream останавливается проверкой identity. Watcher online
уже пропускает restart из-за `starting=true`; `finally` снимает флаг без нового
запуска. Ошибка проявилась и при обычном reload в отдельном lifecycle fixture;
контролируемый repro сохранён в JSON. Hardware permissions этим не проверены.
Это дефект продукта с доступной ручной кнопкой, не доказательство потери данных.
Он не исправлялся и далее не повторялся; независимый lifecycle тест переведён
на синтетический canvas JPEG через реальные публичные crypto/outbox API.

## Ошибки harness и ограничения окружения

- Первоначальный PR14 E2E loader использовал Playwright из QA cwd, а тесты
  импортировали второй экземпляр из worktree. Ни один product test тогда не
  исполнился. Исправлен cwd; отдельный recheck дал 4/4. Это не продуктовый FAIL.
- Session helper больше не запускает повторный resume для уже активной сессии;
  он присоединяется к настоящему pending bootstrap/reauthenticate. Lost-ACK gate
  не полагается на промежуточный UI `retry` или cached `synced` как HTTP ACK.
- Native Safari установлен. В этом раунде оба probes дали `timed out`, а не
  прежний явный ответ о выключенном Allow Remote Automation. Нельзя заключить,
  что текущий флаг выключен. Логи старой пробы не определяют точную фазу таймаута;
  добавлена фазовая диагностика и классификация transport unavailability.
  После двух отказов третий native запуск не выполнялся. Настройки безопасности
  не изменялись; native registration/camera/recovery не выдаются за проверенные.
- Playwright WebKit не запускался и не назывался Safari. Полная визуальная
  сверка Fieldwork / accessibility audit — NOT VERIFIED, UI не менялся.

## Cold offline readiness и предложение

Dev: `/@vite/client` + `/src/main.ts`; production: `/assets/index-CrfGTXgP.js`
на базе QA (PR14 — собственный bundle). Оба fresh profiles были secure contexts,
но `controller=false`, `registrations=0`, `cacheNames=[]`. Offline document
reload дал `net::ERR_INTERNET_DISCONNECTED`; после online страница восстановилась.
Файл `dist/sw.js` создаётся сборкой, но не регистрируется и не контролирует app.

[Техническое предложение](P1-OFFLINE-BOOTSTRAP-PROPOSAL.md) разделяет shell cache,
версионирование/подпись, origin/asset verification, atomic activation, downgrade
защиту, last-known-good rollback и восстановление после cache corruption без
сброса ciphertext/keys. Реализация **BLOCKED BY DESIGN** до решения владельца
о независимом anchor и контроле всех исполняемых обновлений, включая SW.
Неподписанный SW не включался, weak same-origin self-verification не предлагалась
как полная защита от malicious origin. Установленная PWA не тестировалась.

## Performance и окончательные ограничения

Navigation Timing: по 5 warm production-preview навигаций до/после browser suite,
одни URL/viewport 390×844/Chromium/bundle **внутри каждой базы**.

| База | DOMContentLoaded median, до → после | load median, до → после |
| --- | --- | --- |
| QA base | 10.4 → 7.2 ms | 10.8 → 7.6 ms |
| PR14 | 8.1 → 7.4 ms | 8.5 → 7.8 ms |

Это local laboratory samples, не Lighthouse/RUM и не доказательство улучшения;
между разными bundles performance regression не выводится. Нет придуманного
budget. Raw samples сохранены. PHP 8.5, storage eviction, реальные мобильные
PWA, долгий suspend и полный security audit не проверялись. Подписанные
client-clock claims по-прежнему не являются trusted timestamp attestation.

Все созданные Compose projects завершены собственным `down`; существующая
PhotoBunker среда не использовалась. Результаты относятся к зафиксированным SHA,
не к последующим изменениям PR #12/#14 и не являются merge/deploy разрешением.
