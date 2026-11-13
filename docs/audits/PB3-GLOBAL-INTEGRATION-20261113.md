# PB3 — глобальный независимый аудит и подготовка интеграции · 13.11.2026

**Решение:** одна проверенная кодовая integration-кандидатура для review. **main НЕ изменён, merge в main/deploy НЕ выполнялись. Полный PB3/P4 к релизу НЕ готов.** Ни один существующий PR не закрыт, ни одна ветка/пользовательская запись не удалена; force-push не применялся.

**Ветка:** `integration/global-acceptance-20261113`, создана от действительного `origin/main` и fast-forward до точного #290, затем два узких integration/security коммита. Проверенный локальный код: **`9e2fbd71b0ef6b56d9b647eb84f6e9d023bfcd57`**. Окончательный SHA с этим отчётом и **все exact-head CI run URLs** публикуются в **Final validation** описания [единственного integration Draft PR #293](https://github.com/1troitsky/photobunker-v3/pull/293). [Сравнение ветки с main](https://github.com/1troitsky/photobunker-v3/compare/main...integration/global-acceptance-20261113).

Этот отчёт — актуальный срез. Старые слова «pending», «merged» и проценты в исторических PR/аудитах не подменяют проверку текущих refs, деревьев и запущенных сценариев.

## 1. Источники, метод и пределы

Прочитаны `AGENTS.md`, неизменённый нормативный `ts.md`, текущая/историческая таблицы прогресса, preflight #290, два pre-main #264 audit-wave документа, GPS #263, storage/quota/paid-retention аудиты, соответствующие routes, domain services, migrations, Vue views и тесты. PB2/accepted UX используются read-only. При UI-проверках применён skill `ui-ux-pro-max` и утверждённые `docs/ux/` источники, прежде всего клавиатура, фокус и отсутствие горизонтального overflow; нормативный приоритет остаётся у Fieldwork/`ts.md`, а не generic рекомендаций skill.

- API inventory: **все 198 PR**, `state=all`, `per_page=100`, **две страницы 100 + 98**; 189 OPEN, 7 merged, 2 closed/unmerged. Все 198 pull-head refs получены локально. Это полный Git/PR/tree review, не заявление о ручном penetration-тесте каждой строки всех 198 PR.
- Dependency graph: ветки + exact head/base SHA; дополнительно достижимость коммитов, mode/blob содержимого изменённых путей и `git merge-tree --write-tree` без изменения refs/index/рабочего дерева. Полный Git DAG включает **1966 коммитов**; для всех **57** open heads вне ancestry выполнен merge-tree: **32 с реальными конфликтами, 25 clean (что не означает acceptance)**; GitHub merged не считается доказательством reachability.
- Детальные артефакты: [198-PR graph/dispositions](evidence/PB3-GLOBAL-INTEGRATION-20261113-pr-graph.json), [branch DOT](evidence/PB3-GLOBAL-INTEGRATION-20261113-dependencies.dot), [commit parents DAG](evidence/PB3-GLOBAL-INTEGRATION-20261113-commit-graph.json), [critical blobs](evidence/PB3-GLOBAL-INTEGRATION-20261113-critical-blobs.json), [sanitized local results, 84 case names и диагностика](evidence/PB3-GLOBAL-INTEGRATION-20261113-local.json).
- REAL: PG18/Garage, signatures, WebCrypto/AES-GCM, browser IndexedDB, ciphertext uploads/readback, реальные два процесса quota race, фактический Garage stop/start. INJECTED: synthetic camera/GPS, network lost ACK/corrupt-response fault fixtures, trusted test-only paid entitlement events, unavailable PG connection. PHPUnit SQLite/Storage::fake и чистые domain tests отдельно от реального S3.
- NOT TESTED: реальный merchant settlement, physical iPhone/Android/GNSS, native permissions/OS airplane mode, full Matrix и destructive backup/Panic. Не подключались Matrix, чужие S3 или production-аккаунты.

## 2. Реальное состояние main и #290

Первый выполненный Git-запрос — read-only `git ls-remote origin refs/heads/main`; до него refs/файлы/контейнеры не изменялись.

| Объект | Точный SHA / дерево | Проверка |
|---|---|---|
| Удалённый и основной локальный main | `da7327b8c9c440dae3dc864b3245b9f9f4ad14eb` | SHA проверен при начале и после runtime-аудита; main содержит P0/P1 Teams и исходную таблицу прогресса, не новую интеграцию |
| main tree | `de727159d0a0732830294112f87eb93cc819f221` | `git rev-parse origin/main^{tree}` |
| #290 HEAD | `f4bce2e1ab3e5ad72ec1d7e8c8f4d7517e286faa` | **Не ancestor текущего main**; сам текущий main — ancestor #290; 895 ahead / 0 behind |
| Ошибочный merge #290 | `9160cbf17b67af79b1950c3977260b7509c511f4` | GitHub merged, но **не ancestor текущего main** |
| Оба дерева #290 HEAD / ошибочного merge | `1f5c8ecc6d7db5aab15815538d3e23c710379c96` | **Идентичны**; это сохраняемая combined code tree, а не содержимое действующего main |
| #292 Messages HEAD | `3faaed1cb4da7fb512e08c334cbeb0760ed25a2b` | Отдельный descendant #290; дерево `ff9889412c284340eb34ed64f192d8e0730fc4a1`; не включён |

#290 действительно имел [5/5 workflows на точном SHA](evidence/PB3-GLOBAL-INTEGRATION-20261113-source290-ci.json), Chromium83/83, PHP244/244 на каждой версии, Vitest446/446. Это **историческое свидетельство этого SHA**, а не результат новой ветки. Нет необходимости вручную повторно объединять десятки PR. Существующая история сохранена fast-forward нового branch ref; ни один merge в main не производился.

Исходная рабочая папка остаётся на main с пользовательскими удалениями `docs/status/**` и untracked handoff/task файлами. Они не восстановлены, не добавлены в коммит и не изменены нашим аудитом.

## 3. Сколько PR нужно и как интегрировать

Из **189 открытых**:

| Категория | Количество | Решение |
|---|---:|---|
| Exact HEAD уже reachable из main | **40** | Повторное merge не нужно |
| Exact HEAD reachable из #290, сверх main | **92** | Уже наследуются одной сборкой |
| Не ancestry, но все изменённые mode/blob значения совпадают с #290 | **14** | Содержимое уже включено; не считать это общей историей, не применять повторно |
| Частично совпавшие / evolved | **11** | Проверить контракты и сохранить более новые реализации |
| Divergent/deferred | **32** | Не добавлять автоматически |

**146/189 не требуют отдельного интеграционного merge**. Оставшиеся 43 получили индивидуальное disposition ниже/в JSON. Для выбранного подмножества реально нужен **один bundle #290**, **узкий перенос clock-margin из #63** и **security patch пяти Symfony-пакетов**, а не 189 merges. #292/Matrix и новый функциональный этап исключены. Состояния старых PR/веток сохранены.

14 полностью content-equivalent PR: **#184, #186, #188, #245, #246, #247, #249, #250, #252, #253, #255, #256, #257, #266**. Здесь сравниваются PR merge-base changed paths, включая удаления, mode и blob SHA. Это сильнее совпадения названий файлов, но не доказательство полноты production-функции.

### Критические развилки

- **GPS #262/#263:** обе исходные base-ветки существуют. `CaptureView.vue` и её regression tests в #290 **byte-identical #263**, исходный QA E2E #258 тоже неизменён. Raw #263 HEAD не ancestor #290: интеграция перенесла blob-содержимое, поздние paid retention/outbox правки сохранены. Повторное merge #263 конфликтует в старом media-outbox test, #262 — в обоих Camera файлах. **Выбран только #263**.
- **Messages #64/#292:** у #64 пять выделенных файлов отсутствуют в #290; слепое merge конфликтует в App.vue/styles/Playwright. #292 clean merge-tree, но на точном `3faaed1…` [CI 43422810058](https://github.com/1troitsky/photobunker-v3/actions/runs/43422810058) дал **83/85, 2 FAIL** в существующих Appearance/Dock tests. «Нет Git conflict» не означает работоспособность. #292 исключён по явному указанию; чужие assertions и ветка не изменены.
- **Media Grants #63:** был реальный непринятый пропуск: #290 по-прежнему подписывал local `Date.now()+24h`, что нарушает неизменённый server cap при clock lead. Перенесены исходные helper/tests, с сохранением позднего v3 source ceiling и assignment cap. Новый реальный browser test: clock +2min → signed grant → PG/Garage → exact replay → другой аккаунт decrypt с тем же SHA → revoke/410. Это bounded 5min mitigation, не authoritative clock sync; больший clock skew всё ещё может дать 422. Старые status docs #63 не переносились.
- **Storage #251:** ContractAdapter совпадает. Нынешний StorageContractTest сохраняет no-false-delete ACK и idempotency, добавляя cooldown/open/half-open durable circuit semantics после #202. Старая версия дала бы add/add conflict и вернула некорректное ожидание немедленного S3 retry; она не переносится.
- **Matrix:** #64–#81/#133/#261 остаются отдельной веткой/приёмкой. В выбранном runtime нет Matrix feature/SDK/proxy/route; навигационный probe увидел **0 Matrix requests**. Не включались transport, credential setup, Synapse или homeserver.
- **UX:** принятые **117** source files и карты целы, source verifier и lane tests PASS; shared Fieldwork Shell не заменялся старым Messages/UI. Наличие исходников 22 экранов не доказывает runtime всех 22 экранов.
- **Base edge cases:** полный inventory включает закрытые PR; base refs всех 189 open PR реально существуют. У #262 именованный alias base разрешается в exact SHA #258, а старые #51/#47/#3 не являются «пропавшими ветками» лишь потому, что их родитель не open.

### 43 неочевидных open PR — решения по каждому

| PR | Disposition | Evidence / причина |
|---|---|---|
| [#292](https://github.com/1troitsky/photobunker-v3/pull/292) | `EXCLUDE_FAILED_MESSAGES` | Exact 3faaed1 CI 83/85 with 2 existing Dock failures; excluded per owner, clean merge-tree is not acceptance |
| [#270](https://github.com/1troitsky/photobunker-v3/pull/270) | `HISTORICAL_QA_ONLY` | Historical independent QA harness/report; preserve provenance without blindly merging obsolete product snapshots |
| [#267](https://github.com/1troitsky/photobunker-v3/pull/267) | `EVOLVED_RETAIN_CURRENT` | Later quota decimal units, immutable entitlement and paid retention descendants supersede standalone initial billing implementation |
| [#263](https://github.com/1troitsky/photobunker-v3/pull/263) | `SELECTED_EVOLVED` | Vue and its tests match #263 exactly; later media/outbox/retention code retained, not raw head ancestry |
| [#262](https://github.com/1troitsky/photobunker-v3/pull/262) | `EXCLUDE_GPS_ALTERNATIVE` | Conflicts in CaptureView.vue/test; selected #263 implementation already has identical critical blobs |
| [#261](https://github.com/1troitsky/photobunker-v3/pull/261) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#259](https://github.com/1troitsky/photobunker-v3/pull/259) | `EVOLVED_RETAIN_CURRENT` | Latest workflow adds PG races; outage fixture now includes new-worker lost ACK; original real stop/restart retained |
| [#258](https://github.com/1troitsky/photobunker-v3/pull/258) | `SELECTED_QA` | Original GPS negative spec byte-identical; old standalone audit need not overwrite consolidated report |
| [#251](https://github.com/1troitsky/photobunker-v3/pull/251) | `EVOLVED_RETAIN_CURRENT` | Adapter blob identical; test evolved to durable circuit cooldown and no-false-ACK assertions; local real Garage + unit PASS |
| [#133](https://github.com/1troitsky/photobunker-v3/pull/133) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#130](https://github.com/1troitsky/photobunker-v3/pull/130) | `EVOLVED_RETAIN_CURRENT` | Cursor/generation media import guards retained in newer shared panel; current strict pagination/import E2E retained |
| [#112](https://github.com/1troitsky/photobunker-v3/pull/112) | `EVOLVED_RETAIN_CURRENT` | Archive-aware submission behavior lives in later current media submission/grant paths; do not restore older three-file versions |
| [#91](https://github.com/1troitsky/photobunker-v3/pull/91) | `EVOLVED_RETAIN_CURRENT` | Archive preferences/outbox safety covered in current E2E; later shared identity/browser UI retained |
| [#84](https://github.com/1troitsky/photobunker-v3/pull/84) | `STALE_DOC` | Older draft progress claims superseded by factual current integration table |
| [#81](https://github.com/1troitsky/photobunker-v3/pull/81) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#80](https://github.com/1troitsky/photobunker-v3/pull/80) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#79](https://github.com/1troitsky/photobunker-v3/pull/79) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#78](https://github.com/1troitsky/photobunker-v3/pull/78) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#77](https://github.com/1troitsky/photobunker-v3/pull/77) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#76](https://github.com/1troitsky/photobunker-v3/pull/76) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#75](https://github.com/1troitsky/photobunker-v3/pull/75) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#74](https://github.com/1troitsky/photobunker-v3/pull/74) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#73](https://github.com/1troitsky/photobunker-v3/pull/73) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#72](https://github.com/1troitsky/photobunker-v3/pull/72) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#71](https://github.com/1troitsky/photobunker-v3/pull/71) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#70](https://github.com/1troitsky/photobunker-v3/pull/70) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#69](https://github.com/1troitsky/photobunker-v3/pull/69) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#68](https://github.com/1troitsky/photobunker-v3/pull/68) | `DEFER_MATRIX` | Separate non-integrated Matrix lane; owner explicitly forbids automatic connection |
| [#67](https://github.com/1troitsky/photobunker-v3/pull/67) | `SUPERSEDED_DOCK` | Old Matrix-side Appearance branch superseded by selected Fieldwork Dock/UX integration |
| [#66](https://github.com/1troitsky/photobunker-v3/pull/66) | `DEFER_MESSAGES` | Local encrypted draft follow-up belongs to excluded Messages lineage |
| [#64](https://github.com/1troitsky/photobunker-v3/pull/64) | `DEFER_MESSAGES` | Five source files absent in bundle; legacy shared Shell conflicts; evaluate separate #292 only |
| [#63](https://github.com/1troitsky/photobunker-v3/pull/63) | `PORT_SELECTED` | Port bounded 23h55 margin + original negative tests; retain later Safe source expiry/ACL, omit stale status docs |
| [#61](https://github.com/1troitsky/photobunker-v3/pull/61) | `HISTORICAL_QA_ONLY` | Historical independent QA harness/report; preserve provenance without blindly merging obsolete product snapshots |
| [#58](https://github.com/1troitsky/photobunker-v3/pull/58) | `HISTORICAL_QA_ONLY` | Historical independent QA harness/report; preserve provenance without blindly merging obsolete product snapshots |
| [#55](https://github.com/1troitsky/photobunker-v3/pull/55) | `HISTORICAL_QA_ONLY` | Historical independent QA harness/report; preserve provenance without blindly merging obsolete product snapshots |
| [#54](https://github.com/1troitsky/photobunker-v3/pull/54) | `EXCLUDE_OLD_TEAMS` | Older incompatible epoch-invitation variant; accepted #59/#60 lineage is already in main |
| [#49](https://github.com/1troitsky/photobunker-v3/pull/49) | `STALE_DOC` | Old CURRENT/history documentation must not overwrite current status |
| [#47](https://github.com/1troitsky/photobunker-v3/pull/47) | `HISTORICAL_QA_ONLY` | Historical independent QA harness/report; preserve provenance without blindly merging obsolete product snapshots |
| [#45](https://github.com/1troitsky/photobunker-v3/pull/45) | `SUPERSEDED_P1_GRANTS` | Old contributor scope implementation reconciled through existing P1 Teams/Fieldwork integration; retain current scoped read/revoke tests |
| [#27](https://github.com/1troitsky/photobunker-v3/pull/27) | `HISTORICAL_QA_ONLY` | Historical independent QA harness/report; preserve provenance without blindly merging obsolete product snapshots |
| [#19](https://github.com/1troitsky/photobunker-v3/pull/19) | `SUPERSEDED_CAMERA` | Integrated P1 recovery + current camera ownership/late-track regressions supersede early fix tip |
| [#17](https://github.com/1troitsky/photobunker-v3/pull/17) | `HISTORICAL_QA_ONLY` | Historical independent QA harness/report; preserve provenance without blindly merging obsolete product snapshots |
| [#13](https://github.com/1troitsky/photobunker-v3/pull/13) | `HISTORICAL_QA_ONLY` | Historical independent QA harness/report; preserve provenance without blindly merging obsolete product snapshots |

Порядок для review: текущий main → неизменённая полная история #290 → адаптация #63 без старых docs → ровно 5 security patch updates + обязательный audit gate → этот единый QA/progress пакет → окончательный main-base CI → отдельное решение владельца. Matrix, #292 и cleanup PR к этой последовательности не добавляются.

## 4. Security finding вне зелёного CI — исправлено в integration

Обычные checks #290 проверяли floor/контракты, но **не Composer advisory audit**. `composer audit --locked --format=json` локально вернул exit1: **8 advisory matches / 5 пакетов**; не заявляем, что все эти уязвимости были эксплуатируемы через PB3. [Полное before evidence](evidence/PB3-GLOBAL-INTEGRATION-20261113-composer-before.json).

| Пакет | Было | Минимальный patch |
|---|---|---|
| symfony/filesystem | 8.1.9 | 8.1.11 |
| symfony/http-foundation | 8.1.9 | 8.1.11 |
| symfony/http-kernel | 8.1.9 | 8.1.11 |
| symfony/routing | 8.1.9 | 8.1.11 |
| symfony/mime | 8.1.7 | 8.1.10 |

Патчи сверены с первичными [Filesystem advisory](https://github.com/symfony/symfony/security/advisories/GHSA-6prc-h956-hxjq), [HTTP Foundation advisory](https://symfony.com/cve-2026-118514), [MIME advisory](https://symfony.com/cve-2026-45070). Остальные IDs/primary links сохранены в before JSON. Ни один пакет не добавлен/удалён; Laravel13.39.0, composer.json и PHP floor не изменены. Обновлены ровно эти 5 lock entries с минимальным разрешением зависимостей, advisory ignore rules не добавлялись.

**После:** `composer audit --locked` exit0, **0 advisories / 0 abandoned** ([after JSON](evidence/PB3-GLOBAL-INTEGRATION-20261113-composer-after.json)); `pnpm audit --prod --json` exit0, 0 vulnerabilities в 41 production dependency ([JSON](evidence/PB3-GLOBAL-INTEGRATION-20261113-pnpm-production-audit.json)). В foundation CI добавлен обязательный Composer audit для обоих PHP. Registry snapshot не является доказательством отсутствия неизвестных уязвимостей; CVE exploitation/Pentest отдельно NOT TESTED.

## 5. Реальная локальная приёмка

Отдельный worktree и отдельный Compose project, собственные volumes и сгенерированные private credentials, loopback-only 8000/5173/3900. На хосте PHP отсутствует; PHP исполняется **локально в Docker**, не заменяется удалённым CI. Матрица: PHP8.4.27 и PHP8.5.12, Laravel13.39.0, PostgreSQL18.6, Garage2.5, Node22.23.3, pnpm10.20.0. Ни одна пользовательская БД или прежний stack не переиспользованы. Для первоначально CI-only fixtures выставлены их guard-compatible names/flags в отдельном loopback network namespace; `GITHUB_ACTIONS=true` здесь **не означает**, что локальный результат получен на GitHub runner.

| Проверка | Результат / команда / exit |
|---|---|
| Frozen frontend dependencies | PASS, `pnpm install --frozen-lockfile`, 0 |
| Strict TypeScript / production build | PASS, `pnpm typecheck`, `pnpm build`, 0 |
| Vitest | PASS, `pnpm test:web`, **449/449**, 0; baseline #290 — 446/446 |
| PHPUnit PHP8.4.27 | PASS, `php vendor/bin/phpunit`, **245 / 3661 assertions**, 0 |
| PHPUnit PHP8.5.12 | PASS, та же команда, **245 / 3661 assertions**, 0 |
| Fresh PG18 migrations | PASS, `php artisan migrate --force`, **36** migrations, 0 |
| Nonempty main → integration upgrade | PASS: 24 main migrations → +12; **6/6** исходных строк, stable IDs/expiry/signature/envelope/S3 refs, реальный SHA object и assignment-meter backfill сохранены; 0 |
| PG quota race | PASS, `php tests/integration/p1-quota-postgres-race.php`, **5/5** настоящих двухпроцессных interleavings, 0; это SQL fixtures, не 5 concurrent HTTP uploads |
| Garage digest / TTL / repeated tombstone sweep | PASS, `garage-postgres-smoke.php`, `lifecycle-garage-smoke.php`, 0 |
| Actual Garage outage/new-worker/Lost ACK | PASS, оригинальный `garage-outage.php prepare / s3-down / recover` в 3 PHP processes и реальный stop/start **собственного** Garage; 0. PostgreSQL server оставался live; DB-failure подслучай injected |
| Full Chromium на финальном коде и patched dependencies | **PASS 84/84**, `pnpm exec playwright test --config tests/playwright.config.ts --reporter=json`, exit0, **0 skips/retries**. Все старые specs/config неизменны, +1 real clock/replay/read/revoke test |
| Source integrity / lane | PASS, `node docs/ux-integration/verify-source.mjs`, 117 files; `node --test .../check-pr-lane.test.mjs`, 5/5; 0 |
| Unsigned release-integrity tools | PASS, `TMPDIR=<canonical> node --test scripts/release-integrity/integrity.test.mjs`, **32/32**, 0; не проверка signed PWA |
| UI surface | PASS проверенный subset: 27 переходов на 375×812, 812×375, 1440×900, keyboard focus и overflow; [before](evidence/PB3-GLOBAL-INTEGRATION-20261113-surface-before.json), [after](evidence/PB3-GLOBAL-INTEGRATION-20261113-surface-after.json) |
| Native Safari | BLOCKED: Safari26.6.2 установлен; один WebDriver session probe отказал: Allow Remote Automation выключен. Настройка не менялась; functional native tests NOT TESTED |
| Physical iOS / Android / GNSS / OS permissions | NOT TESTED; Chromium fixtures не hardware acceptance |
| Cold offline reload | BLOCKED: реальный reload без сети дал `ERR_INTERNET_DISCONNECTED`; 0 registered Service Workers. Shell offline bootstrap и independent trust anchor не готовы; не «исправлено» неподписанным SW |

Upgrade rehearsal использует точный read-only архив исходников main в отдельной **новой** БД, а не rollback/сброс существующих данных. Синтетические random-byte object/SQL rows проверяют миграционную сохранность, не добавляют самостоятельного криптографического attestation; реальный E2EE доказан браузерными journeys отдельно. Авто-GC production flags не включены.

### Диагностика, а не скрытые retries

1. Первый полный browser trial: **79/83, 4 FAIL**. Vite был запущен до окончательной правки #63; traces показывают timestamped module URLs `?t=…`, а offline imports используют bare URL и получают network failure. Первые traces/JSON сохранены приватно. После холодного Vite на замороженном коде **все 83 прежних теста PASS**. Assertions/таймауты не переписывались.
2. Во втором полном trial **83/84 PASS**; новый тест ошибочно ожидал 404 от revoked grant, тогда как существующий API намеренно отвечает **410**. Исправлен **только новый oracle на строгий 410**, targeted case 1/1 PASS. После security patch выполнен заключительный **84/84 PASS** полный прогон. Это не допускающий оба статуса weakened assertion.
3. Harness-only ошибки: `/garage` — binary, не mount directory; отсутствовал vendor mountpoint; HTTP file-session env попадал в PHPUnit CLI; неверное имя cache option; Python3.9 не поддерживает новый tar filter argument. Исправлены только setup/environment, первоначальная диагностика не удалена. По одной причине бесконечных повторов не было.
4. Default macOS `/var` temp ancestor является symlink, и unsigned-integrity инструмент корректно отказал. Канонический private TMPDIR дал 32/32 без ослабления symlink gate.

### Performance и визуальная приёмка

Сохранены по 3 warm Vite-navigation samples: **53.99 / 50.91 / 53.56ms** до и **51.77 / 50.55 / 52.76ms** после. Это N=3 лабораторный probe, не RUM/Lighthouse. Первый fixture имел HMR activity; эти числа **не считаются валидным comparative baseline или perf PASS**, порог не придуман. Формальный performance/load и aesthetics по всем референсам — **NOT VERIFIED**. Проверены конкретные responsive/keyboard функции, но не объявлена полная WCAG/native/visual acceptance.

## 6. Глобальная функциональная матрица

`IMPLEMENTED` означает наличие указанного кода, а не всей функции. `TESTED / PASS` относится только к перечисленному сценарию и его команде/evidence выше. Полный user journey без реализации получает BLOCKED, незапущенный — NOT TESTED.

| Направление | Реализация | Фактически проверено | Итог / оставшееся |
|---|---|---|---|
| Identity / Recovery Key | IMPLEMENTED register/recover/login, server crypto primitives | TESTED real A→B browser recovery, wrong key/signature/account negatives, cookie proof и reload | PASS core; browser rotation/full device lifecycle NOT TESTED. Dormant controller methods не равны подключённому UI/route |
| E2EE / Local-First / offline | IMPLEMENTED AEAD assets/chunks/outboxes | TESTED real browser→PG/Garage→recovered account decrypt, Lost ACK, corrupted bytes, warm offline | PASS subset; cold shell reload BLOCKED |
| Camera GPS/photo | IMPLEMENTED #263, signed requiredGps и isolated consent | TESTED unchanged #258 negatives, no stale fix, late permission/context races, encrypted private GPS | PASS Chromium fixtures; actual GNSS/iOS/Android NOT TESTED |
| Video/audio capture | IMPLEMENTED MediaRecorder / encrypted queue | TESTED short synthetic tracks, interruption/permission/context checks | Partial. **FAIL spec coverage:** hard cap `recordLimitMs=175000` против video300s/audio3000s `ts.md` §14; long hardware recording NOT TESTED. В этом audit новый media этап не начинался |
| Photo editor / File Viewer | IMPLEMENTED real raster/crop/RGB/text/shapes/blackouts, E2EE versions | TESTED decoded pixels, >16.8MP native JPEG, low-memory refusal, Undo/Redo, route/back and recipient safe-only decrypt | PASS covered journeys; full visual/native acceptance NOT VERIFIED |
| Video/audio editors | IMPLEMENTED WAV trim, decoded stop-frame, trim EDL preview | TESTED actual small WAV/VP8 fixtures and independent encrypted derivatives | PASS subset; general AAC/MP4 export/long recordings BLOCKED or NOT TESTED |
| Browser / import / storage | IMPLEMENTED bounded metadata index, folders/search/archive/upload | TESTED 10k synthetic index, genuine authorized deep-link page2, CORS/private URL gates, 65MiB resumable E2EE | PASS covered paths; production scale/RUM NOT TESTED |
| StorageManager / Garage | IMPLEMENTED single AppS3 adapter, durable circuit/retry | TESTED actual outage/restart/new worker/SHA/TTL + contract tests separately | PASS app S3; BYO/independent replica/failover BLOCKED |
| Assignments / Contacts / Teams | IMPLEMENTED signed owner policies, E2EE instructions/invites/rosters | TESTED multi-account grant, signed policy, participant consent/removal, ACL negatives and quota races | PASS covered journeys; owner full UX/native acceptance NOT TESTED |
| ACL / Media Grants / revoke | IMPLEMENTED current effective scopes, Safe source ceiling and ported #63 clock margin | TESTED 3 accounts, wrong/restored device negatives, exact replay, recipient decrypt, revoke/410 | PASS explicit file/team scopes; full remote device wipe/Panic BLOCKED |
| Profile / Settings / Dock | IMPLEMENTED Account access, Settings/Appearance/search, configurable Dock | TESTED browser keyboard/mobile viewports, persist/reload/Cancel/back | PASS covered settings; final Profile/PIN, 6 fully available destinations, actual devices NOT TESTED/incomplete |
| Messages 1.1 / Matrix | В выбранной сборке отсутствуют route/view/SDK | Route `/messages` redirected to assignments; #292 separate CI FAIL | **BLOCKED**. Matrix not connected; full A↔B/SAS/QR/escrow/attachments/receipts NOT TESTED here |
| Notifications | IMPLEMENTED encrypted local-inbox model only | TESTED isolated Vitest privacy/read-state | PASS contract; no mounted inbox/transport/push; `/notifications` fallback → **BLOCKED** full flow |
| Help / FAQ / Legal | IMPLEMENTED isolated HelpCenter/domain unit-tested components | TESTED component logic; not mounted in main router | BLOCKED full screen/wiring/legal acceptance; component existence ≠ functioning route |
| Backup / Recovery Vault | IMPLEMENTED only admission/lease/cooldown primitives | TESTED PHPUnit safety/unit admission, not actual backup | **BLOCKED** snapshot/restore/replica, prior verified backup preservation NOT TESTED |
| Emergency/Panic / DMS | No full runtime product journey | NOT TESTED destructive cloud/local lifecycle | **BLOCKED**; no wipe/production cleanup launched |
| Billing / real payment | IMPLEMENTED server catalog/entitlement primitives; no checkout settlement route | TESTED immutable signed snapshots and trusted **synthetic** Go/Pro fixtures | PASS primitives; **real payment NOT TESTED**, cannot claim paid commercial flow |
| Tariff quotas / retention / grace / GC | IMPLEMENTED server file/bytes/monthly quotas, 14/30/90-day admission and immutable signed expiry | TESTED 5 real SQL races, 13/29/89 client writes, synthetic downgrade preserves prior bytes, real tombstone GC fixtures | PASS implemented scope; Unlimited renewal/grace/backup precedence #203 BLOCKED; no real merchant expiry claimed |
| Admin / Analytics / Events | IMPLEMENTED isolated pure contracts only | TESTED PHPUnit RBAC/MFA decision, metadata allowlists, privacy/idempotency | PASS contract; no production MFA/admin routes/ingestion UI/ops integration — **BLOCKED** full system |
| Public Card / sharing | IMPLEMENTED private preview ceilings and owner editorial bindings | TESTED safe derivative masks and addressed encrypted grants | PASS private scopes; anonymous publication/token/revoke flow **BLOCKED**, not implied by preview UI |
| PWA / release security | IMPLEMENTED unsigned manifest tooling, no registered SW | TESTED 32 integrity cases, refused symlink root, no hidden Matrix activation | PASS unsigned tool; signed chain/independent trust/rollback/fully offline startup **BLOCKED** |
| Dependency/runtime security | IMPLEMENTED patched floor and strict Composer CI gate | TESTED PHP8.4.27/8.5.12 + Laravel13.39, before/after audit and full patched-runtime regressions | PASS known audit snapshot; CVE exploitation/unknown bugs NOT TESTED |

## 7. Воспроизведение и сохранность данных

QA-only воспроизводимые scripts: [local runner](../../scripts/audits/global-integration-20261113/local.py), [graph analysis](../../scripts/audits/global-integration-20261113/graph.py), [upgrade rehearsal](../../scripts/audits/global-integration-20261113/upgrade.py). Они не меняют main/PR states, создают private fixture вне repo и отказываются его перезаписывать. Runtime images должны удовлетворять floor; использованные локальные image tags и реальные версии перечислены выше. Экспортированный runner прошёл AST validation; первоначальные команды и исправления окружения сохранены отдельно, не выдаются за дополнительные product fixes.

```sh
# Все команды — в отдельной integration рабочей копии, не в main.
export PB3_AUDIT_WORKSPACE="/absolute/path/to/integration-worktree"
export PB3_AUDIT_OUTPUT="/private/tmp/pb3-independent-fresh-fixture"
pnpm install --frozen-lockfile
python3 scripts/audits/global-integration-20261113/local.py setup
python3 scripts/audits/global-integration-20261113/local.py backend
python3 scripts/audits/global-integration-20261113/local.py frontend
# В отдельном терминале: штатный Vite, только после фиксации исходников.
pnpm --filter @pb3/web exec vite --strictPort
# Затем:
python3 scripts/audits/global-integration-20261113/local.py e2e
python3 scripts/audits/global-integration-20261113/upgrade.py
```

Полный PR inventory воспроизводится `gh api --paginate 'repos/1troitsky/photobunker-v3/pulls?state=all&per_page=100&sort=created&direction=desc'` и сохранёнными immutable pull refs; алгоритм graph.py использует merge-base и mode/blob comparisons. Его вывод не разрешает merge/close автоматически.

Исходные logs/traces/credentials/SQL dumps хранятся **приватно** и не коммитятся: browser traces могут содержать тестовые ключи/metadata. Публичные JSON обезличены, actual generated credential values отдельно просканированы против экспортируемых файлов. Данные disposable volumes и исходного local stack не удалены. Local app bind только loopback; это test fixture, не deploy.

## 8. Что блокирует принятие и main

1. **Никакого разрешения на самостоятельный main merge нет.** GitHub status #290 merged вводит в заблуждение, реальный main остаётся исходным. Новый единственный Draft integration PR нужен, поскольку старый #290 уже закрыт/merged в интерфейсе и не является корректной поверхностью нового owner review.
2. **Полный PB3 scope не завершён:** Messages #292 failing, Matrix отдельно, Backup/Panic/DMS, BYO/replicas, real payments, Unlimited/grace destructive policies, Admin wiring, native permissions и signed PWA trust anchor остаются BLOCKED/NOT TESTED. Зелёный технический CI их не принимает.
3. **Конфликтующие/устаревшие heads не сливать вслед за bundle** (#262, raw #263/#251/#267/#64 и старые docs). Решения по закрытию/удалению веток в задачу не входят.
4. Для принятия именно этого **ограниченного core bundle** нужны owner code review и явный выбор scope с указанными gate-ограничениями; после exact-head CI техническая интеграция может быть рассмотрена отдельно от релизной готовности. После возможного разрешённого merge таблица в main обновляется отдельным owner решением — сейчас она изменена только здесь.

**Передача:** один Draft PR, один подробный QA отчёт, одна таблица прогресса, точные Git/evidence artifacts. Никаких force-push, массовых merges, автоматического PR cleanup, подключения Matrix или production mutations.
