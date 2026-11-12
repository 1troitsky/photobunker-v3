# P2 Matrix Re-acceptance — независимая локальная проверка

**Дата:** 12 ноября 2026, Asia/Tbilisi. **Продукт:** [Draft #81](https://github.com/1troitsky/photobunker-v3/pull/81), точный SHA **`5f13992b94b90157a38d25b3fe27543e3e8642f1`**. База #80, проверена цепочка #78→#79→#80→#81. Задание — локальный файл `11 - P2 Matrix Re-acceptance.md`; исходный текст сохранён при переименовании.

**Результат: PASS для четырёх обязательных пунктов этой ограниченной re-acceptance**, включая негативные сценарии и Lost ACK. Новых дефектов продукта в выполненных сценариях не обнаружено. Это не приёмка всего Matrix/P2 и не разрешение на merge/deploy. **M-01, M-04 и полный Panic остаются BLOCKED / не приняты.**

## Метод и среда

Прочитаны `AGENTS.md`, Matrix-разделы `ts.md`, независимый [аудит #77](https://github.com/1troitsky/photobunker-v3/pull/77), планы #79/#80 и поведение #81. `CHATBOT-AGENTS.md` в проверяемом worktree отсутствует. Product worktree detached на указанном SHA, исходники API смонтированы read-only. Продуктовый код, `main`, таблица прогресса и прежние пользовательские изменения не менялись.

Использована обвязка [#77 @33d5c7f](https://github.com/1troitsky/photobunker-v3/tree/33d5c7fb8df55ccd86a3b5749a4476e9f1cf976e/scripts/p2-matrix-audit) с необходимой адаптацией точного SHA, нового набора сценариев и доверия браузера к локальному TLS. PHP **8.4.27**, Laravel **13.39.0**, PostgreSQL **18.6**, Synapse **1.161.0**, официальный Matrix SDK **44.0.0** с RustCrypto, Playwright **1.56.1** / Chromium. [Фактическая среда](evidence/P2-MATRIX-REACCEPTANCE-20261112-environment.json).

Stock `pnpm exec vite --strictPort` запущен из product `apps/web` на5173, API на8000. Никакой временный QA Vite config или дополнительный `/matrix/v1` proxy не добавлялся. Отдельный TLS nginx → настоящий disposable Synapse использует только loopback443 и fixture hostname `matrix.pb3-audit.test`. API и Node SDK проверяют TLS по явно доверенному fixture CA. Для отдельного процесса Chromium установлен pin конкретного SPKI этого сертификата и локальное разрешение fixture hostname; глобальное системное доверие и проверка остальных сертификатов не отключались.

Настоящие регистрации и восстановление PB3 выполнены UI/production API, подписи account/device и CSRF проверял реальный Laravel. **SQL revision не менялся; Session/auth/Matrix whoami не подменялись.** Matrix SDK наблюдателей синхронизировался в Node, а production self-revoke/logout выполнялся в настоящем браузере. Это доказывает браузерный revoke→logout путь и соответствующий bearer, не полный браузерный RustCrypto Messenger.

## Результаты

| Пункт | Результат | Фактические наблюдения |
|---|---|---|
| **1. M-02: настоящий Recovery Key rotate → новый браузер → Matrix4S** | **PASS** | Подписанный `purpose=rotate`, revision1→2; новый браузер вошёл новым Recovery Key; production rewrap создал append-only rev2. Возвращён тот же32-byte seed, исходный реальный4S MAC корректен, cross-signing root не изменился. |
| Старый ciphertext / parent lineage | **PASS** | Сравнены hashes всей исходной v1 строки и rev2; v1 не изменена, родитель rev2 равен исходному contract hash. До rewrap v2 строк0, после — ровно1 с revision2. |
| Lost ACK / фактический reload / идентичный повтор POST | **PASS** | QA отправила настоящий POST через `route.fetch()`, дождалась **HTTP201**, затем оборвала только ACK браузеру. Sealed pending сохранился. После реального `page.reload()` тот же canonical POST повторился byte-for-byte, ответ **HTTP200**, pending очищен после readback, второй v2 строки нет. |
| Изменённый AKEK | **PASS, fail-closed** | Настоящий следующий signed rotate создал revision3 с новым AKEK при том же root; новый браузер действительно вошёл. Попытка rewrap старого escrow вернула `matrix.recovery_unwrap_failed`; rev3 не добавлена, v1/rev2 не изменены. |
| Изменённый/чужой root подписи предыдущего receipt | **PASS, fail-closed** | Исторический ciphertext в контролируемом негативном GET был подписан **другим настоящим PB3 аккаунтом**. Production verifier вернул `matrix.recovery_untrusted_receipt` до rewrap. Auth/Session не заменялись, серверные ciphertext не менялись. Это проверка distrust untrusted receipt, **не** поддержка миграции самого account root. |
| **2. M-03B: PB3 self-revoke → Matrix logout → прежний bearer401** | **PASS** | Через production Settings UI и явное подтверждение: signed PB3 revoke200 → реальный Matrix whoami200 → logout200 → whoami401. Независимый запрос тем же прежним bearer также401; PB3 Identity/Matrix APIs401, локальная Session закрыта. UI сообщил подтверждённый отзыв только этого токена. |
| Ошибка Matrix после self-revoke | **PASS** | Оборван только реальный browser POST Matrix logout после PB3 commit. UI: «Удалённый отзыв … НЕ подтверждён». PB3 Identity/Matrix APIs401, Session закрыта, credential rows0. Самостоятельный Matrix bearer по-прежнему200. Никакого ложного remote revoke или Panic. |
| **3. Other-device revoke** | **PASS** | Восстановленное устройство того же PB3 аккаунта подписало отзыв первоначального Matrix-bound устройства. Старый browser cookie получил401 на Identity и PB3 Matrix APIs. Matrix-токен именно отозванного PB3 устройства сохранил200. UI явно сообщил, что отзыв чужого Matrix-токена не выполнен. |
| **4. Vite `/matrix/v1`** | **PASS** | Настоящий root+device-signed binding дошёл через stock Vite до точного продукта, затем прошёл настоящий TLS whoami и readback. Временного QA proxy нет. R-P2-01 из #77 в этом сценарии не воспроизводится. |
| M-01 / M-04 / полный Panic | **BLOCKED, не приняты** | Полный A→B/SAS/QR/send, гонки ACL/key-sharing и emergency/remote wipe не проверялись этим заданием. Другие Matrix устройства и уже полученные ключи не считаются отозванными. |

[Обезличенный runtime JSON](evidence/P2-MATRIX-REACCEPTANCE-20261112-runtime.json) содержит все assertions/statuses и точную HTTP последовательность self-revoke. Реальные ключи, bearer, UUID аккаунтов/устройств, seed и тела signed contracts в отчёт не включены.

## Независимые проверки и границы

**M-02.** Исходный seed создан официальным RustCrypto и сохранён в настоящем Synapse4S. PB3 v1 escrow сформирован production `escrowMatrixSecretStorageKey`. После настоящей смены Recovery Key `recoverMatrixSecretStorageKey` в новом контексте самостоятельно выполнил v2 rewrap; новый Matrix access token ему не передавался. Read-only PostgreSQL snapshots подтвердили append-only и сохранность v1. Утрата ACK вызвана после фактического commit, а не искусственным обещанием server success. До повтора перезагружалась вся страница, не только JS module cache. Recovery с новым AKEK намеренно отказал; доступность восстановления при настоящей замене AKEK/root этим исправлением не заявляется.

**M-03B.** До self-revoke локальные credentials действительно были sealed production binding. Привязка account/device подтверждалась backend по настоящему TLS Synapse. Прежний bearer проверен до и после production UI операции, без cookie-authorized Matrix substitute. Успешная последовательность сохранена в JSON: **PB3 revoke200 → Matrix whoami200 → Matrix logout200 → Matrix whoami401**. Ошибка logout проверена отдельным настоящим PB3 аккаунтом/Matrix устройством и endpoint-level transport fault; PB3 security barrier сработал независимо от Matrix. Обычный logout не выдавался за Panic.

**Root negative.** Вторая fault injection касается только недоверенного исторического signed receipt: при неизменной настоящей Session его подпись заменена на подпись чужого реального account root. Это не mock личности/устройства и не изменение product cryptography. Для AKEK negative применён полноценный signed rotate и новый Recovery Key login. Эти разные границы указаны отдельно, чтобы не объявлять поддержанным перенос между разными корневыми ключами.

Выполнен **один bounded runtime run**, exit0, без диагностического повторения всего набора. Ожидания ограничены, PB3 запросы paced1850ms при сохранении штатных server limits. Полные ранее зелёные PHPUnit/Vitest/Chromium/Synapse CI suites не перезапускались. Device hardware/Safari/PWA integrity и историческая Megolm decrypt на новом браузере не проверялись и не заявляются PASS.

## Воспроизведение и delivery

Скрипты: [README](../../scripts/p2-matrix-reacceptance/README.md), [setup](../../scripts/p2-matrix-reacceptance/setup.py), [run](../../scripts/p2-matrix-reacceptance/run.mjs), [scenarios](../../scripts/p2-matrix-reacceptance/scenarios.mjs). Достаточно нового приватного disposable `RUN`, exact-SHA `PRODUCT`, свободных5173/8000/443 и локального frozen vendor volume, как в #77.

```sh
pnpm --dir "$PRODUCT" install --frozen-lockfile
python3 scripts/p2-matrix-reacceptance/setup.py "$PRODUCT" "$RUN"
node scripts/p2-matrix-reacceptance/run.mjs "$PRODUCT" "$RUN"
python3 scripts/p2-matrix-reacceptance/check.py "$PRODUCT"
```

Команды frozen install, setup, `node --check` и runtime runner завершились exit0. [Dependency refs](evidence/P2-MATRIX-REACCEPTANCE-20261112-refs.json) получены с GitHub и сверены с fetched refs/ancestry. Продуктовый SHA не заменялся более свежей веткой. Отчёт и обвязка находятся только в QA-only Draft PR поверх #81; product fixes не потребовались.

[Ledger hashes](evidence/P2-MATRIX-REACCEPTANCE-20261112-ledger.json) фиксируют сохранившийся v1 anchor и единственную rev2 запись. После приватного backup одноразовый стек остановлен без удаления volumes/Synapse files — [cleanup](evidence/P2-MATRIX-REACCEPTANCE-20261112-cleanup.json). Файл задания переименован локально с удалением `(не выполнен) `, без изменения содержимого и без commit/push в `main` — [completion proof](evidence/P2-MATRIX-REACCEPTANCE-20261112-task-completion.json). Scope/syntax/sanitization gate завершился exit0; [проверка](evidence/P2-MATRIX-REACCEPTANCE-20261112-verification.json).

**Решение:** узкие M-02 same-root/same-AKEK rotation, M-03B own-token logout, PB3 other-device barrier и routing исправления независимо подтверждены. Предлагать весь Matrix стек к merge или считать P2 принятым нельзя: M-01, M-04 и полный Panic остаются отдельными открытыми acceptance gates. `main`/продуктовые PR не изменялись, merge/deploy не выполнялись; таблицы прогресса не создавались и не редактировались.
