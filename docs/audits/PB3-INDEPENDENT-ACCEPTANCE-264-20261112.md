# PB3 #264 — независимая приёмка pre-main сборки #265 (QA-only)

**Дата:** 2026-11-12 · **Репозиторий:** 1troitsky/photobunker-v3 · **Метод:** независимая сверка exact Git trees/blob SHA, production source, original negative tests, workflow YAML и полных логов GitHub Actions; документальный аудит отдельных доказательств Matrix #133. **Физические iOS/Android недоступны.** Никаких заявлений о собственном запуске native hardware или отдельного локального Synapse в этом отчёте.

**Вердикт:** **PASS** в пределах подтверждённой объединённой Chromium/Linux/PG18/Garage сборки; **NOT TESTED** на физических iOS Safari / Android PWA; **BLOCKED** полный Matrix Messenger и релизный main gate. Это **не** production acceptance. Подтверждённых FAIL по запущенным интегрированным сценариям нет, но есть source-level UX parity finding (ниже). Не сливать и не включать Matrix по результатам этого отчёта.

## 1. Точные версии и интеграционная цепочка

| Источник | Exact SHA | Назначение |
|---|---|---|
| [#265](https://github.com/1troitsky/photobunker-v3/pull/265) | b5783a731ec565b6abf1158dc86ed13de6ea5c71 | **Проверяемый combined HEAD**, Draft |
| [#248](https://github.com/1troitsky/photobunker-v3/pull/248) | f4c8ebdfae54d9c526133a723d2f2fbb0edc7d45 | V55 base, включает предков |
| [#187](https://github.com/1troitsky/photobunker-v3/pull/187) | 7a309508cc140897ae6dd75f8d473a89c7296be2 | V54 verified ancestor |
| [#263](https://github.com/1troitsky/photobunker-v3/pull/263) | e79b438d5f08ed85ba15c7289d94a0423795c54d | **Выбранный** GPS product fix |
| [#262](https://github.com/1troitsky/photobunker-v3/pull/262) | 6e2698a316abc5153d38bfb894b53d1b10a6f7a2 | Конкурирующий, **не** включённый GPS fix |
| [#258](https://github.com/1troitsky/photobunker-v3/pull/258) | 16ecbfa5720e93ebc0ebb2fd12ab4a5c0e3a5283 | Original negative GPS QA, без изменений |
| [#133](https://github.com/1troitsky/photobunker-v3/pull/133) | 0aa993e3944e02d7c87908cca8a4573cc61a9ea0 | Отдельная QA-only Matrix reacceptance |
| [#81](https://github.com/1troitsky/photobunker-v3/pull/81) | 5f13992b94b90157a38d25b3fe27543e3e8642f1 | Фактически проверенная Matrix product версия #133 |
| main (на момент проверки) | da7327b8c9c440dae3dc864b3245b9f9f4ad14eb | Не менялась, **не** является интеграционной базой |

Детальный manifest из **16 исходных PR** / 55 source paths находится в [исходном pre-main отчёте](https://github.com/1troitsky/photobunker-v3/blob/b5783a731ec565b6abf1158dc86ed13de6ea5c71/docs/audits/PB3-PREMAIN-INTEGRATION-264-20261112.md). Аудитор отдельно проверил 56 changed-file paths PR #265, полный Git tree (**851 entries, не truncated**), workflow конфигурацию и прямые исходные Git blob SHA.

**Дополнительная независимая машинная проверка всех источников:** для **каждого** из 16 указанных source PR отдельно получены GitHub PR changed-file paths и полный recursive Git tree точного source SHA; каждый путь сопоставлен с блобом в exact integrated tree #265. Результат: **55 source paths / 55 exact Git blob SHA match / 0 mismatches / 0 pairwise path overlaps**, ни одно дерево не truncated. Число source paths по PR: #263=10, #252=2, #253=2, #255=1, #256=1, #257=1, #259=4, #251=2, #250=4, #249=6, #247=5, #246=4, #245=5, #188=4, #186=2, #184=2. 56-й файл integration PR — только собственный предварительный отчёт #264, а не повторное применение кода. Это **доказательство побайтового переноса**, не утверждение что отдельные foundation-компоненты подключены к UI/API.


## 2. Ключевая security развилка: #263, НЕ #262

**PASS — provenance, без двойной накладки.** В точном #265 **совпадают побайтово с #263** четыре критических продукта/теста:

| Файл | Git blob SHA в #265 = #263 |
|---|---|
| apps/web/src/views/CaptureView.vue | d9cfa58830e098c90b53b51ea3874042da8db487 |
| apps/web/src/views/CaptureView.test.ts | b3d93de045c2df0116101d1967f318bf56ecf0a1 |
| apps/web/src/features/photo-sync/application/p1-photo.ts | bd9d011da4b74e75e088446a68b536bcae28a544 |
| apps/web/src/features/media/application/media-outbox.ts | ab62d2bf3ee926cebbf07d90645e4b7153ed94a4 |

В #262 эти файлы либо имеют иные SHA (\`CaptureView.vue\` = \`7183dd554ccd3856fab7bf4ed5448909996dcc0e\`, \`CaptureView.test.ts\` = \`607cda2da23f49ecc19cae773d5280eb5d7017d6\`), либо являются прежними без atomic guards. **Нельзя поверх #263 слить #262 автоматически**. Выбор #263 обоснован более сильным контролем P1+P2 на границе durable-write, а не только повторной проверкой перед затвором.

**PASS — сохранение исходного красного negative QA #258:** \`tests/e2e/p2-browser-camera-gps-permission.spec.ts\` имеет один и тот же Git blob SHA **\`da38a7f35ead05fab71f27fa7b4000bc836fc722\`** в #258, #262, #263 и #265. Все **четыре исходных E2E кейса** остаются неизменёнными, включая deny/required policy, трёхминутный stale fix, реальный Chromium permission revoke и проверку *расшифрованных* GPS координат. Дополнительный \`tests/e2e/p2-browser-camera-gps-consent-race.spec.ts\` SHA **\`e8b785dc70220e7bc164f3d6cdeee72872c6da63\`** проверяет revoke **без второго нажатия GPS** для optional и signed-required вариантов.

**PASS — source review защиты:** \`CaptureView.vue\` сбрасывает предыдущий fix ещё до запроса, связывает поколение consent с identity/route/assignment/mode, читает permission перед shutter, после async Canvas, после signed binding и на finalization A/V. В \`p1-photo.ts::captureEncrypted\` и \`media-outbox.ts::enqueueEncryptedMedia\` сохранены синхронные \`assertCurrent()\` до/внутри атомарной IndexedDB транзакции. Негативные Vitest проходят настоящую AES-GCM/IndexedDB отмену: при изменившемся consent новая строка не сохраняется. Optional без доказуемого GPS сохраняет **без координат**, signed \`requiredGps\` — отказывается сохранять. Нет фонового geolocation watcher. **Оставшаяся фундаментальная граница:** Permissions API/read→commit не являются одной OS-транзакцией; поздний аппаратный revoke, которого browser ещё не сообщил, независимо не доказан.

**OPEN (не подтверждённая privacy утечка):** при сравнении с #262 обнаружен узкий UX gap. Альтернатива #262 различает нативные \`GeolocationPositionError.code=1/2/3\` (\`camera.gps_permission_denied\` / unavailable / timeout); выбранный #263 в \`obtainGPS\` для не-\`Error\` объекта возвращает общий \`camera.gps_unavailable\`. Тест #258 требует безопасной очистки GPS и наличия alert, но **не** конкретного error code. На безопасность E2EE это не влияет и не является регрессией относительно прежнего V55 mapping; ошибка формулировки/кроссбраузерной UX параллели требует отдельного product review перед физической приёмкой.

## 3. Combined CI — полные реальные подтверждения

**PASS — строго на product HEAD b5783a731ec565b6abf1158dc86ed13de6ea5c71**, все четыре GitHub Actions завершены success (сверены состояния, job conclusions и полные журналы):

| Тестовый контур | Результат | Exact run |
|---|---|---|
| Real PostgreSQL 18 + Garage 2.5 + Chromium | **77/77 PASS**, worker=1, \`retries:0\`, E2E без skip | [43221178753](https://github.com/1troitsky/photobunker-v3/actions/runs/43221178753) |
| PHP 8.4 / PHP 8.5 / маршруты / миграции | **196 tests / 3002 assertions** на каждой версии | [43221178727](https://github.com/1troitsky/photobunker-v3/actions/runs/43221178727) |
| Vue + TypeScript + build + Vitest | **81 test files, 413/413 PASS** | [43221178727](https://github.com/1troitsky/photobunker-v3/actions/runs/43221178727) |
| Security floor + плановые контракты | **PASS** (но это не полноценный внешний pentest) | [43221178726](https://github.com/1troitsky/photobunker-v3/actions/runs/43221178726) |
| UX lane scope/integrity | **PASS**, workflow log \`# skipped 0\` | [43221178688](https://github.com/1troitsky/photobunker-v3/actions/runs/43221178688) |

В хранилищном log реально присутствуют \`P4 Garage fault matrix S3-DOWN PASS\`, \`RECOVERY PASS\`, \`COMPLETE\` — настоящий stop/start одноразового Garage и восстановление readback. **Падение PostgreSQL намеренно инжектировано на уровне соединения**, не настоящий stop DB. По E2E report — \`77 passed (4.9m)\`; это Linux **Chromium**, не iOS WebKit.

\`tests/playwright.config.ts\` проверен: testMatch включает \`p1-*.spec.ts\`, \`p2-browser-*.spec.ts\`, \`p2-settings-*.spec.ts\`; именно так #258 original и #263 race попадают в 77, без скрытой папки. workers 1, retries 0, trace-on-failure. Workflow выполняет \`pnpm exec playwright test --config tests/playwright.config.ts\` против реальных disposable PG18/Garage. Ни один изменённый путь #265 не уменьшил существующий negative GPS тест.

## 4. Регрессии: что подтверждено, а что нет

| Контур | Решение | Доказательство / ограничение |
|---|---|---|
| Camera GPS permission denial/revoke, signed required policy, stale fix, private metadata | **PASS (Chromium / synthetic GNSS)** | Четыре оригинальных #258 E2E + два новых #263 E2E + \`CaptureView.test.ts\` + real AES-GCM IndexedDB rollback |
| Camera фото/видео/аудио, identity/context change, save cancel | **PASS (tested paths)** | Включённые legacy P1/P2 media E2E и focused Vitest в combined CI; не аппаратная аттестация |
| Browser 10k+ pagination/search/sort | **PASS (synthetic load)** | \`p2-browser-large-account.spec.ts\`: 10 051 AES-GCM metadata fixtures, 202 cursor pages, 257 виртуальных каталогов |
| Browser real E2EE deep link beyond first page | **PASS (tested path)** | Второй \`p2-browser-large-account\` case: реальный PB3 account, облачная ciphertext media, серверная проверка доступа |
| E2EE account isolation, grant → revoke, foreign root deny | **PASS (tested paths)** | \`p1-grant-revocation-matrix.spec.ts\`; внешний C и восстановленное B2 не получают приватный медиа-grant |
| Recovery A→B и logout account fence | **PASS (tested paths)** | \`p1-recovery-device-acceptance.spec.ts\`, log \`PB3_QA_199_RECOVERY\` с A→B, 8192 bytes, server ACK и cloud-only B; **не** доказан offline cache B |
| Local-First AES-GCM pending queue, Lost ACK, corrupted PUT/GET, retry | **PASS (tested paths)** | \`p1-fault-injection-envelopes.spec.ts\`, настоящий серверный commit до lost ACK, неизменяемый replay, отказ чужому аккаунту и corrupt ciphertext |
| Garage outage/recovery | **PASS (disposable)** | Реальный stop/restart Garage; PostgreSQL stop НЕ тестировался |
| Native iOS Safari (permission prompt/revoke, background/foreground, app install) | **NOT TESTED** | Нет физического iPhone/iPad, WebKit runtime или device evidence |
| Native Android PWA (permission lifecycle, MediaRecorder, install/relaunch) | **NOT TESTED** | Нет физического Android, Chrome PWA install/device evidence |
| Real GNSS accuracy, OS radio airplane mode, revoke exactly during commit | **NOT TESTED** | Chromium synthetic geolocation и Permissions API не являются аппаратной гарантией |
| Full PIN/Panic, complete Recovery Vault, BYO S3, real paid entitlements/backup/release signing | **NOT TESTED / BLOCKED** | Изолированные foundation классы не равны работающему полнофункциональному продукту; #224/#266 и поздние product branches не являются частью этого immutable HEAD |

**Важно:** label PASS означает проверенный контур и условия; не обобщать его до «вся Camera / всё E2EE / все native платформы без ошибок».

## 5. Matrix PR #133 — отдельный документальный reacceptance audit

**Отдельный продукт:** Matrix #81 exact \`5f13992b94b90157a38d25b3fe27543e3e8642f1\`, не #265. **QA-only** #133 \`0aa993e3944e02d7c87908cca8a4573cc61a9ea0\`; независимый compare показал **ровно 13 новых paths — только scripts/docs/evidence, ни одного изменения продукта**. У интеграционного #265 отсутствуют Matrix product controllers, migrations, application modules и отдельный Synapse workflow. **#133 нельзя считать тестом Matrix на #265**.

Пересверены [полный локальный отчёт #133](https://github.com/1troitsky/photobunker-v3/blob/0aa993e3944e02d7c87908cca8a4573cc61a9ea0/docs/audits/P2-MATRIX-REACCEPTANCE-20261112.md), [runtime JSON](https://github.com/1troitsky/photobunker-v3/blob/0aa993e3944e02d7c87908cca8a4573cc61a9ea0/docs/audits/evidence/P2-MATRIX-REACCEPTANCE-20261112-runtime.json), environment/ledger/ref/verification/cleanup files. Это независимое **прочтение доказательств**, а не новый физический Synapse rerun с моей стороны.

| Граница / результат агента #133 | Статус по его локальному runtime | Что подтверждено |
|---|---|---|
| M-02 настоящая signed Recovery Key rev1→rev2 → новый браузер и original Matrix4S MAC | **PASS (#133 evidence)** | Same-root+same-AKEK, сохранность исходного 4S seed/cross-signing root и append-only старого ciphertext |
| M-02 Lost ACK | **PASS (#133 evidence)** | Фактический POST201 commit, ACK потерян в browser, полный reload, byte-identical retry HTTP200, нет дубля rev2 |
| M-02 changed AKEK / чужая подпись legacy receipt | **PASS negative (#133 evidence)** | Fail closed: \`matrix.recovery_unwrap_failed\` и \`matrix.recovery_untrusted_receipt\`; миграция account root НЕ заявлена |
| M-03B own-device signed PB3 self-revoke / Matrix logout | **PASS (#133 evidence)** | PB3 200 → настоящий Synapse whoami200/logout200 → тот же bearer whoami401; локальная PB3 Session закрыта |
| Matrix transport failure after PB3 self-revoke | **PASS fail-closed local (#133 evidence)** | PB3 Identity/Matrix API401, local credentials 0; **старый Matrix bearer остаётся200**, UI честно сообщает неподтверждённый удалённый отзыв |
| Other-device PB3 revoke | **PASS bounded (#133 evidence)** | Другой PB3 cookie401; его независимый Matrix bearer **всё ещё200** — remote Matrix revoke НЕ выполнен |
| Stock Vite \`/matrix/v1\` signed binding | **PASS (#133 evidence)** | Production proxy + real TLS Synapse, без QA Vite proxy |
| M-01 full PB3 A→B contact approval, SAS/QR, E2EE UI send/backfill/reload | **BLOCKED / NOT TESTED** | Нет подтверждённой сквозной приёмки |
| M-04 adversarial ACL/membership/key-sharing races | **BLOCKED / NOT TESTED** | Частичный pre-send guard #261 НЕ доказывает атомарное право на выдачу Megolm keys |
| Full Panic/remote Matrix bearer revoke/physical clients/historic Megolm restore | **BLOCKED / NOT TESTED** | Revocation одного PB3 device не отзывает чужие homeserver bearers |

По #133 выполнен **один** scoped runtime pass, exit 0; \`fullCiRepeated:false\`. Не переименовывать это в полный CI/Synapse/release PASS. Matrix **не** импортировать в #265 и не включать Send.

## 6. Решение и обязательные отдельные gates

**INTEGRATION QA: PASS** на точном #265 HEAD по текущим Linux/Chromium/PG18/Garage/security/UX suites и Git blob provenance. **PRODUCTION / MAIN MERGE: HOLD**.

До решения [#183](https://github.com/1troitsky/photobunker-v3/issues/183) остаются:
1. **Native device acceptance NOT TESTED:** физический iOS Safari и Android PWA, versions/build, repeated grant/revoke, background/relaunch, optional vs required GPS, audio/video, IndexedDB durability, app install. При неподдерживаемом \`navigator.permissions.query\` #263 специально не прикрепляет GPS (fail-closed); на конкретных mobile браузерах это может сделать required GPS недоступным.
2. **Matrix BLOCKED** M-01/M-04/full Panic; #133 ограничен отдельным product #81, а не объединённой сборкой.
3. **OPEN UX parity:** native \`GeolocationPositionError\` mapping из #262 не перенесён; отдельный небольшой продуктовый review, не накладывать #262 файлы автоматически.
4. Product/release gates #224 billing, #266 storage resilience, PIN/Panic, BYO S3, signed release/integration, backup и owner approval должны оцениваться отдельно и только после включения в актуальный tree. Этот отчёт НЕ заявляет их tested.
5. Не закрывать #264/исходные Issues автоматически, не менять \`main\`, не проводить merge/deploy и не хранить секреты/ключи/точные пользовательские координаты в evidence.

**QA provenance:** единственное содержательное изменение поверх exact #265 — этот Markdown-файл в отдельной QA-ветке. Сырой аппаратный evidence отсутствует; текущий report воспроизводим по ссылкам на сохранённые exact-source tests, Git blobs и GitHub Actions runs.
