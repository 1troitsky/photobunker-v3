# P1 acceptance — Round 3 · 2026-11-09

**На точном HEAD PR #24 R2-01 подтверждён 3/3, R2-02 исправлен в выполненных
Chromium/component сценариях, Lost ACK 3/3. Новых подтверждённых дефектов продукта
в выполненном scope не найдено.** Signed-policy/metadata и pre-grant acceptance
пройдены. Native Safari и hardware **NOT TESTED**; cold offline bootstrap
**BLOCKED BY DESIGN**. Это не закрытие P1 и не production/owner acceptance.

## Исходники и изоляция

- [Issue #25](https://github.com/1troitsky/photobunker-v3/issues/25), продукт:
  [PR #24](https://github.com/1troitsky/photobunker-v3/pull/24),
  `p1/08-safe-submission-grant-gate` @ **`039762d3bec173b767cbb8898bda92d01e413f26`**.
  Свежий `git fetch`, GitHub PR metadata и branch ref подтвердили этот SHA до запуска.
- Product worktree `/private/tmp/pb3-round3-product` — detached, без изменений
  tracked files до/после. `main`, продуктовые PR, API, security gates и SW не менялись.
- QA baseline / целевая ветка нового Draft PR: `qa/p1-acceptance-round2`
  @ `07297a690265a362f8dbaa22f74976e2ebb74405` (PR #17). Ветка отчёта:
  `qa/p1-acceptance-round3`. Старые harness/tests/evidence сохранены без изменений.
- QA source первого run: `5675a30b4f25ac386d8bc13212e6bfc5665fe142`;
  исправленного focused run: `b674eb0bb027b33ed4ff352bd3668dbde669dbc9`.
  Последующие изменения runner/exporter/report не меняют проверенный продукт.
  JSON содержит SHA-256 QA-файлов на соответствующих source commits.
- Прочитаны AGENTS, нормативный ts.md, три design-doc из Issue, PR #17/#19
  evidence, camera/session и policy/preflight/photo/grant contracts.
  CHATBOT-AGENTS.md не найден.
- Два отдельных случайных Compose project, PostgreSQL/Garage tmpfs, новые
  synthetic accounts/credentials и private copy API; исходники продукта :ro.
  Никаких live S3, resets, customer data, merge/deploy. Cleanup обоих project
  exit **0**; после него QA containers не осталось.

## Команды и результаты

Из QA checkout с установленными locked dependencies, свободными 8000/5173/4173
и отдельным detached product checkout:

```sh
python3 -B scripts/local-acceptance/round3.py --source-root /private/tmp/pb3-round3-product
python3 -B scripts/local-acceptance/round3.py --source-root /private/tmp/pb3-round3-product --recheck-pregrant
```

| Run / artifact | Exit | Факт |
| --- | --- | --- |
| [Integrated evidence](P1-ROUND3-INTEGRATED-EVIDENCE.json), private run `bx6qhcce` | **1** | 29 passed / 1 failed browser executions; failure — QA dialog synchronization; отдельная неисполненная recheck-команда тоже exit 1 |
| [Focused evidence](P1-ROUND3-PREGRANT-RECHECK-EVIDENCE.json), private run `pz2t165n` | **0** | Единственный исправленный pregrant/consent сценарий: 1/1 PASS, новая fixture |

Не представляем первый run как зелёный. `offline-readiness` и performance
входят в browser counts как probes, а не как доказательство offline readiness.
Все suite-команды/cwd/exit codes/counts и allowlisted proofs находятся в JSON.
Raw logs/traces/images/GPS/keys остаются только в private `$TMPDIR/pb3-acceptance-*`.

Среда: macOS **26.6.2**, Node **22.23.3**, pnpm **10.20.0**, Docker **29.8.2**,
PHP **8.4.27**, Composer **2.10.3**, Laravel **13.39.0**, PostgreSQL **18.6**,
Garage **2.5.0**, Playwright **1.56.1**, Chromium **141.0.7390.37**.

## Матрица приёмки

| Сценарий | Статус | Проверяемое свидетельство |
| --- | --- | --- |
| Exact subsecond v2 capture → finish → late reserve | **PASS 3/3** | `round3-boundaries`, exit 0; trusted DB comparisons ниже |
| Поздний submission до resume / истинный post-finish capture | **PASS 3/3** | Submission 409, post-finish reserve 409; исходный personal photo active |
| Resume, owner decrypt, grant revoke, contributor ownership | **PASS 3/3** | После resume submission 201; recipient GET 410 после revoke; contributor cloud decrypt и прежние JPEG/metadata digests |
| R2-02 late permission при настоящем login proof | **PASS** | Независимый старый camera-reload + product camera E2E, exit 0 |
| Session wrapper, account/device/key change, unmount, denial/retry, tracks | **PASS** | Product camera E2E 6/6 + QA device/key tracks 2/2 + 24 camera Vitest cases в общем suite; Chromium использует fake hardware |
| Offline encrypted camera capture с проверенной политикой | **PASS** | Product camera E2E, настоящий API/crypto/IndexedDB/Garage |
| Старые policy revisions 1 и 2 после target/requirements amendment | **PASS** | `round3-security`: оба v2 assignment photos reserve/sync после более строгой revision 3; preflight возвращает исходные revisions |
| Category / description / GPS до сохранения | **PASS** | Реальные camera UI ошибки по каждой ступени; число ciphertext rows не увеличивается |
| AES-GCM metadata, local/remote owner decrypt, отсутствие plaintext | **PASS** | Row/contract/wire/Garage canary checks; read-only pg_dump и container-log canary scan exit 0; ciphertext digests не меняются |
| Pre-grant privacy: missing personal fields / unrelated assignment | **PASS** | Focused run: local grant delta=0, DB grant delta=0, grant POST=0; unrelated row скрыт UI и прямой preflight отклонён |
| Personal signed v1, current requirements и явное согласие | **PASS** | Missing requirements reject; cancel создаёт 0 grants; accept создаёт ровно 1, owner decrypt успешен |
| `/policy-history` ACL / append-only public chain | **PASS** | Outsider/unaccepted/revoked 404; accepted/owner 200; первый event неизменен после следующего amendment |
| Counterfeit signature / predecessor / rollback / missing / foreign chain | **PASS** | Настоящие owner-signed events, изменяемые копии отклонены; poisoned IndexedDB signature отвергнута при offline read |
| Account-scoped historical cache, warm offline re-verification | **PASS** | Ранее verified chain прочитан offline; historical preflight revision 2; новый реальный аккаунт в том же profile получает cache=null |
| Cache не является fresh ACL authority | **PASS в проверенном scope** | Synthetic membership revoke: history 404 и новый reserve conflict; generic photo-grant revoke отдельно даёт recipient 410 |
| Lost finalize ACK, reload, replay, Garage decrypt | **PASS 3/3** | `lost-ack-stability`, exit 0; 8 retention checkpoints, два exact signed reserve replays, ровно 1 server photo, совпадающий plaintext hash |
| Исходные Chromium product E2E / warm route / login/reload | **PASS 10/10** | Неизменённые product tests на точном SHA, exit 0; дополнительные resilience 4/4 |
| TS / Vitest / build / PHPUnit | **PASS** | Exit 0: **57 tests / 10 Vitest files**, PHPUnit **44 tests / 524 assertions** |
| Security floor / strict Composer / lint / routes / plans / health | **PASS** | Именованные commands exit 0, security floor не обходился |
| PostgreSQL18 / Garage2.5 smoke | **PASS** | Оба исходных integration scripts exit 0 |
| Cold reload Vite / production / installed signed PWA | **BLOCKED BY DESIGN** | Dev/prod probes: нет controller/registrations/cache, offline document не загрузился; installed PWA не запускалась |
| Native Safari lifecycle / физические iOS/Android GPS/gallery/permissions | **NOT TESTED** | Причина и границы ниже |

## R2-01 — точная серверная граница

JPEG создан offline штатным client pipeline; `signedCaptureBinding()` использует
настоящее время браузера. До capture применён только bounded wall-clock fence,
чтобы начать около начала секунды. Timestamp/contract/signature не редактировались.
Owner finish вызван после durable capture; `occurred_at_ms` прочитан непосредственно
из новой PostgreSQL через read-only QA inspection.

| Sample | Claimed capturedAt ms | Trusted finish occurred_at_ms | Finish − capture |
| --- | --- | --- | --- |
| 1 | 1794251618021 | 1794251618086 | 65 ms |
| 2 | 1794251622021 | 1794251622066 | 45 ms |
| 3 | 1794251626023 | 1794251626088 | 65 ms |

Во всех трёх случаях одна и та же целая секунда; reserve **200**, finalize **200**,
server photo **active**, оба ciphertext digests сохранены. Submission **409** до
подписанного resume и **201** после него. Настоящий более поздний capture со старой
cached active policy получает reserve **409**. Signed device time остаётся claim,
не trusted capture attestation; положительный результат относится к указанным
честным синтетическим клиентам и независимым server boundaries.

## Проблемы окружения/harness и ограничения

- **QA-H1, исправлено и проверено:** первый consent тест устанавливал следующий
  dialog listener до завершения предыдущего async preflight. Два listener
  обрабатывали один confirm: `dialog.accept: ... already handled`.
  Теперь ожидаются dismiss/accept и enabled кнопка. Исходный failure сохранён.
- **QA-H2, исправлено:** первоначальный focused grep `^title$` не учитывал полный
  Playwright test title, команда получила `No tests found`. Ни один сценарий в
  ней не запускался. Один фактический focused recheck с исправленным фильтром
  прошёл. Других интегрированных прогонов или циклов до зелёного не было.
- **Native Safari:** установлен 26.6.2. Один native safaridriver session attempt
  вернул явный `session not created`, требуя **Allow remote automation**.
  Probe exit **77**, сценарии регистрации/reload/IndexedDB/camera не исполнялись.
  Настройки безопасности не менялись; WebKit не выдавался за Safari.
- USB discovery: iPhone/iPad candidate не найден; `adb` и `devicectl` недоступны.
  Авторизованное hardware-окружение не установлено. Chromium GPS и камера —
  **синтетические fixtures**, не native hardware acceptance. Устройства не запрашивались.
- Membership revoke проверяется **только в disposable synthetic DB**: продукта
  API для этого ещё нет. Это не доказательство готовности UI отзыва приглашений.
  Offline history подтверждает прошлые подписи, не свежесть членства/ACL.
- Проверка private canaries относится к исследованному row/contract/HTTP flow,
  downloaded Garage ciphertext, disposable DB и container logs. Полный криптоаудит,
  злонамеренный клиент и защита от compromised delivery этим не доказаны.
- PHP 8.5 **NOT TESTED** локально. Полная визуальная сверка **NOT VERIFIED**.
- Production shell не имеет доверенного bootstrap/SW. Независимый trust anchor
  остаётся отдельным owner decision; unsigned SW не включён. См.
  [сохранённое предложение](P1-OFFLINE-BOOTSTRAP-PROPOSAL.md).

Performance: те же production bundle/URL/Chromium, viewport 390×844, по 5 warm
navigations до/после suite. Median responseEnd **1.5 → 1.4 ms**, DCL
**11.9 → 11.3 ms**, load **12.3 → 11.8 ms**. Raw samples в evidence; это локальные
Navigation Timing observations, не Lighthouse/RUM, не заданный budget и не
доказательство улучшения продукта. Продуктовый diff отсутствует.

Реальные оставшиеся acceptance blockers: безопасный cold offline bootstrap и
нативные/физические устройства. Ни P1 целиком, ни все photo/video/audio и
Storage Manager journeys, ни готовность production этим отчётом не принимаются.
