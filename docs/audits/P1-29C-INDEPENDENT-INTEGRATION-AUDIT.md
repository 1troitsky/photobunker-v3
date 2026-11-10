# P1-29C — независимый security/integration аудит, задание 08

Дата: 2026-11-10. Исходный продукт: [#59](https://github.com/1troitsky/photobunker-v3/pull/59)
**`ff9c7bab2485c7d2cfd094e67fdb505a1221ee00`**, база #57 `65f0c1a`.
Отдельное исправление: [Draft #60](https://github.com/1troitsky/photobunker-v3/pull/60)
**`54f984162451e44e49d374ba5c08cb3a2b7a0536`**.

**Итог: исходная цепочка #50 → #51 → #52 → #53 → #56 → #57 → #59 — FAIL.**
Найдены два новых дефекта R08-01/R08-02. **С отдельным исправлением #60 — PASS
в проверенном объёме**: PHP8.4/8.5, Vitest/TS/build, реальные PostgreSQL/Garage,
Chromium 19/19, независимые инварианты 74/74, CI3/3. Для технического рассмотрения
интеграции нужна именно исправленная цепочка, не один исходный #59.
**Старый #54 отдельно сливать не требуется и не следует**: его функциональность
уже перенесена в #59. Merge/deploy не выполнялись; owner acceptance не заявляется.

## Область, источник и сохранность

Прочитаны `AGENTS.md`, релевантные §§4.6/5/15.1 `ts.md`, актуальный
`docs/status/CURRENT.md`, `P1-29C-EPOCH-INVITES-CONSENT-INTEGRATION.md`, исходные
аудиты #55/#58, исторический #54, v1/v2 контроллеры/клиенты/миграции и тесты.
Проверка исполнялась в отдельных worktree исходного #59, QA и исправления.
Оригинальные #55/#58, #59 и 39 локальных файлов владельца сохранены; hash/ref
проверки — в [GitHub/preservation evidence](evidence/P1-29C-INDEPENDENT-AUDIT-github.json).

Все данные синтетические. Random Compose projects, PostgreSQL/Garage tmpfs,
loopback API, отдельные приватные runtime copies. Нет prune, reset, production
key rotation, удаления пользовательских данных, merge или deploy. Исходные
отрицательные результаты сохранены отдельно; нет retries-until-green и
expected-failure маркировки security assertions. Service Worker не регистрировался.

## Интеграция и происхождение #54

`python3 -B scripts/team-crypto-audit/analyze.py <product>` — **exit 0**.
Все base→head связи #50/#51/#52/#53/#56/#57/#59 и #60 подтверждены ancestry;
stable patch-ID не дублируются, conflict markers отсутствуют. #54 **не** ancestor
#59: `merge-base --is-ancestor` exit **1**, ожидаемый результат read-only переноса.
Возможности #54 перенесены коммитом `11a081d` и последующими security/integration
изменениями, а не дополнительным слиянием старой несовместимой ветки.

Из миграций относительно #57 добавлена только
`2026_11_10_000011_team_epoch_invitations_v2.php`, байт-в-байт совпадающая с #54.
Предыдущие миграции не менялись. Новая таблица добавляет immutable invitation/
consent ledger и защиту от destructive down при наличии данных. PostgreSQL
проверялся на новой схеме; production upgrade load/locks не проверены.
Source manifest и точные SHA всей цепочки включены в local evidence.

## Обязательные gates и точные запуски

Исходный продукт:

```sh
python3 -B scripts/team-crypto-audit/run.py \
  --source-root /private/tmp/pb3-r08-product --diagnose-media
```

Private run `pb3-acceptance-3gm1a03v`, общий exit **1**: два продуктовых FAIL
и отдельная ошибка первого QA PHP8.5 image build. Исправленный образ проверил
тот же неизменённый продукт отдельно: `pb3-acceptance-g48q2kek`, exit **0**,
PHP8.5 PHPUnit 108/108. Первая build-ошибка не заменена зелёным результатом.

Исправление:

```sh
python3 -B scripts/team-crypto-audit/run.py \
  --source-root /private/tmp/pb3-r08-fix \
  --target-ref 54f984162451e44e49d374ba5c08cb3a2b7a0536 --diagnose-media
```

Private run `pb3-acceptance-jgysh554`, общий exit **0**.

| Команда / gate | #59 | #60 |
|---|---|---|
| Frozen pnpm / Composer validate / PHP lint / routes / plans | PASS, exit0 | PASS, exit0 |
| PHP8.4 PHPUnit, network none | PASS, 108 / 1796 assertions | PASS, 109 / 1807 assertions |
| PHP8.5 PHPUnit, network none | PASS, 108 / 1796, supplemental run | PASS, 109 / 1807 |
| `pnpm test:web` | PASS, 147 | PASS, 151 / 29 files |
| `pnpm typecheck`, `pnpm build` | PASS, exit0 | PASS, exit0 |
| PostgreSQL migrations / Garage SQL/S3 / lifecycle smoke | PASS, exit0 | PASS, exit0 |
| Full Chromium product suite | PASS, 19/19 | PASS, 19/19 |
| Separate original media scenarios | PASS, 3/3 | PASS, 3/3 |
| Independent Teams journey | FAIL, 72/74 | PASS, 74/74 |
| Private canary pg_dump/log scan | PASS | PASS |
| Product source unchanged after run | PASS | PASS |

Реальные версии: PHP **8.4.27 и 8.5.12**, Laravel 13.39.0, PostgreSQL 18.6,
Garage 2.5.0, Node22.23.3/pnpm10.20.0, Chromium141.0.7390.37/Playwright1.56.1,
macOS26.6.2. Оба PHP security floor scripts завершились exit0 перед тестами.
PHP unit/feature используют SQLite; интеграционные сценарии — настоящие PG/S3.

Точные CI через GitHub API: #59 **3/3 success**, attempt1 —
[foundation](https://github.com/1troitsky/photobunker-v3/actions/runs/42880171764),
[security](https://github.com/1troitsky/photobunker-v3/actions/runs/42880171740),
[SQL/S3/browser](https://github.com/1troitsky/photobunker-v3/actions/runs/42880171540).
#60 **3/3 success**, attempt1 —
[foundation](https://github.com/1troitsky/photobunker-v3/actions/runs/42889142988),
[security](https://github.com/1troitsky/photobunker-v3/actions/runs/42889143053),
[SQL/S3/browser](https://github.com/1troitsky/photobunker-v3/actions/runs/42889142940).
Зелёный CI исходного #59 не отменяет новых независимых FAIL.

## Независимые сценарии и signed retirement

Сохранены все 45 проверок #58 и добавлены 29 v2/current-member/PG проверок.
Исполняемая команда: `pnpm exec playwright test --config
tests/team-crypto-audit/playwright.config.ts`; exit1 на #59, exit0 на #60.
Персональные `audit-proof` результаты находятся в
[sanitized local evidence](evidence/P1-29C-INDEPENDENT-AUDIT-local.json).

- **PASS:** A/B/C consent v1, pending D v1, B role/removal, quarantine,
  epoch2 точный signed retirement D, C decrypt; последующее исключение C и epoch3.
- **PASS:** B получает новый epoch3 v2 ECDH envelope, подписывает fresh consent,
  реально расшифровывает текущий профиль; повторно читает contributor role.
  C отдельно принимает v2 и остаётся survivor при epoch4 для проверки fallback.
- **PASS:** invitation и consent каждого отдельно: сервер commit201 → ACK lost
  → full reload с сохранённым ciphertext hash → identical signed body replay
  200/unchanged=true. Нет повторной подписи и дублей membership/epoch ledger.
- **PASS:** fresh independent DEK/AES-GCM и scoped ECDH/HKDF; старый DEK не
  открывает новую версию, неверный AAD отвергается. Backend membership/роль
  не выдают автоматически photo/media/assignment grants.
- **PASS:** B исключён; D pending v2; epoch4 подписывает ровно D ID. Пропущенный,
  foreign и лишний ID →409, повтор →422, подделка подписанных байтов →401.
  Исходные отрицательные v1/role/digest/hash/CAS проверки тоже сохраняются.
- **PASS:** epoch4 снимает quarantine только после атомарного ledger/grants/
  v1+v2 retirement commit. DB имеет три immutable новых epoch records; pending
  v2=0; B/D member endpoint404; D получает только inviteId/teamId/state.
- **PASS:** после ротации owner roster остаётся проверяемым, C получает новую
  роль через штатный signed membership action. История revoked B/D сохранена.

### Реальное пересечение PostgreSQL-транзакций

**PASS**, не вывод из одного Promise.all. В отдельном synthetic fixture одна
транзакция держит team row lock; два независимых PHP процесса исполняют настоящие
`rotate()` и `accept()` controllers. `pg_stat_activity` показывает **2 lock waiters**
до освобождения. Затем rotation201, consent409; exact retry ротации unchanged.
В согласии после quarantine нет допустимого выигрыша: оно должно отклоняться и
до rekey, и после signed retirement. Никакое неподписанное принятие D не произошло.

Controller-процессам задаются trusted test Sessions с настоящими fixture account/
device IDs; signatures, actor DB lookup, транзакции и CAS реальные. Это проверка
domain/DB concurrency, не утверждение о production HTTP load. Session/CSRF/HTTP
проверяются отдельными настоящими browser flows. Lock holder bounded, выполняет
rollback без изменения данных; привязка к random project/owned synthetic team
проверяется helper. Production locks не проверены.

## Freshness всех новых путей

**PASS на #60:** direct v2 member, v1 survivor, superseded v2→current grant fallback.
C действительно переживает epoch4, получает отдельный свежий grant и decrypt.
После verified epoch4 воспроизведение подлинных epoch3 v2 ответов отвергается
`teams.verified_epoch_rollback`. Genuine owner-signed same-epoch fork current path
отвергается `teams.verified_epoch_fork`. Role replay и unsigned revision inflation
проверены на v2 и current paths; легитимное чтение после атаки сохраняется.
Account switch →identity.changed; реальные вкладки сериализуют durable IDB floor.
Encrypted offline snapshots переживают reload/ошибки, не становятся live правом.

Независимая защита требует криптографического доказательства revision от epoch,
invitation и role receipt; R08-02 ниже показывает, почему только epoch недостаточно.
Полный откат устройства/IDB и скомпрометированный same-origin JS не решены.

## R08-01 — receipt предыдущего приглашения выбран по совпавшему timestamp

**FAIL #59 → PASS #60**, availability/identity binding defect. На настоящем B
с genuine старым signed v1 role receipt QA временно делает его **неподписанный**
created_at равным accepted_at нового v2 consent — модель реальной секундной
точности DB. Подписанные contract/signature не меняются; timestamp затем
восстанавливается. Старый event с другим inviteId попадает в ответ, и клиент
правильно падает с `teams.untrusted_epoch_join_role` при штатном чтении после rejoin.

Причина: `TeamEpochInvitationController::member()` фильтровал события по
created_at>=accepted_at вместо immutable invitation identity. #60 выбирает
по **invite_id текущего принятого приглашения**. Новые настоящие role changes
по-прежнему возвращаются и проверяются. PHP-регрессия проверяет и отбрасывание
совпавшего старого receipt, и выдачу правильного нового. Ledger/signatures/CAS
не меняются, timestamp security gates не ослабляются.

## R08-02 — v2 floor игнорирует подписанную ревизию самого приглашения

**FAIL #59 → PASS #60**, нарушение заявленного highest verified revision.
Epoch3 подписан с revision4. После изменения роли B новый v2 invite C подписан
с revision5. #59 принимает согласованные HTTP member/history metadata revision4
при неизменных invitation5/signatures/DEK; сохраняет floor4, хотя owner-signed
invitation5 уже криптографически проверен. В negative evidence error=null.

#60 отвергает metadata ниже signed invitation revision и сохраняет максимум
**signed epoch / signed invitation / verified role receipt**. Неподписанные
внешние counters не повышают floor. Добавлены четыре WebCrypto unit-сценария:
persisted invitation floor, HTTP downgrade, unsigned inflation и дальнейший
signed role/replay. Целевой файл Vitest10/10, полный151/151. Проверки старого #57
и atomic joined+freshness transaction сохранены.

Продуктовый diff #60: два файла реализации и два regression-файла,
91 добавление / 4 удаления, без миграций и соседних функций.

## Приватность и границы утверждений

**PASS точечных private-content проверок:** random team name/description и реальные
Team DEK эпох3/4 (base64url/hex) отсутствуют в pg_dump и container logs. Все canaries
хранятся только в приватном chmod600 run fixture. В encrypted Team outbox/freshness
не найдены приватные name/description, account/team IDs и открытые protocol fields;
после reload ciphertext hash сохранён. Для этого проверяются реальные IDB rows,
не просто наличие слова ciphertext. Snapshot PG подтвердил нулевые implicit
photo/media/assignment grants для owner тестовой команды.

**Публичные технические UUID в backend ledgers/URL logs присутствуют по контракту
ts.md.** Буквальное отсутствие любых серверных идентификаторов не заявляется:
это противоречило бы согласованным authoritative ACL/stable identifiers. Сервис
не получает plaintext профиля/DEK. Metadata anonymity, все OS buffers/swap,
все recovery secrets и полный forensic scan не проверены.

## Исторический HTTP422 — отдельное исследование

Исходный private trace #55 сохранён. `media422.py` повторно проверил **точные**
request bytes: JSON/поля/UUID/P-256/envelope/signature lengths/каноничность верны,
mediaContractHash совпадает с реальной reservation, grant expiry не превышает
reserved media expiry. Экспортируются только booleans/hash, не payload.

```sh
python3 -B scripts/team-crypto-audit/media422.py \
  --trace <private-original-trace.zip> --runtime <private-original-api-copy>
```

**Exit0, PASS контролируемого воспроизведения validator:** те же байты при
server time на 3ms раньше client grant creation →422, на 3ms позже →валидны.
Проверен исходный `MediaGrantController::contract()` в network-none PHP, с
управляемым Carbon clock. Условное значение200 в probe означает только успешную
валидацию контракта, а не сымитированный HTTP успех или запись grant в БД.

Выявлена чувствительность точного 24h client deadline к server clock boundary.
Это поддерживает объяснение старого отказа временным верхним ограничением;
фактическое server millisecond время тогда не записано. **Исторический 422
не объявляется окончательно объяснённым или исправленным.** Новые media3/3
и Chromium19/19 не меняют этот вывод. Backend expiry limits не ослаблялись;
отдельного client/server time-authority исправления в #60 нет.

QA environment error сохранён: первая сборка PHP8.5 redundant DOM расширения
не нашла lexbor header. Официальный base уже содержит DOM/lexbor; исправленный
Dockerfile собирает только pdo_pgsql/zip. Отдельный baseline PHPUnit8.5 и полный
fixed gate реально выполнены; первый build FAIL остаётся в evidence.

## Решение и ограничения

| Область | Статус |
|---|---|
| Наследование #57 / перенос #54 / неизменность старых миграций | PASS |
| Signed exact pending v1/v2 union и competing consent/rotation | PASS |
| ECDH/current DEK/consent/rejoin/Lost ACK/epochs2–4 | PASS |
| v2/current freshness и offline storage на #60 | PASS |
| Исходный #59, R08-01/R08-02 | FAIL, исправлены отдельно #60 |
| Все обязательные local gates на #60 и exact CI | PASS |
| Исторический media422: доказанное окончательное устранение | NOT TESTED / OPEN |
| Native Safari, iPhone, Android, hardware permissions/background | NOT TESTED |
| Production migration locks/load и production HTTP concurrency | NOT TESTED |
| Полный device/cache rollback / независимый JS trust anchor | BLOCKED BY DESIGN |
| Полный forensic audit / aesthetics / performance baseline/RUM | NOT VERIFIED |

**Однозначный ответ:** исходную цепочку, заканчивающуюся #59, интегрировать
без R08 исправлений нельзя. Цепочка **#50→#51→#52→#53→#56→#57→#59→#60** прошла
проверенные P1 Teams acceptance/security gates и готова к техническому рассмотрению
интеграции владельцем с перечисленными ограничениями. **Самостоятельное слияние
исторического #54 не нужно** и дублировало бы уже перенесённую реализацию.
Main/merge/deploy не затронуты.

[Local evidence](evidence/P1-29C-INDEPENDENT-AUDIT-local.json) ·
[CI/refs evidence](evidence/P1-29C-INDEPENDENT-AUDIT-github.json) ·
[Reproduction](../../scripts/team-crypto-audit/README.md).
