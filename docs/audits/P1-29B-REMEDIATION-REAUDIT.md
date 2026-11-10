# P1-29B — повторный независимый аудит исправлений, задание 07

Дата: 2026-11-10. Проверенный #56: **`41fa666b3cc54d351ce0d916fecf6e44973c97a5`**.
Отдельное исправление: [Draft PR #57](https://github.com/1troitsky/photobunker-v3/pull/57),
**`65f0c1a27a342ebfe5044ee1af7bb8cad27738ed`**, строго поверх #56.

**Заключение:** исходные **T29B-01/T29B-02 закрыты**. На точном #56 обнаружены
новые R07-01/R07-02, поэтому его результат — **FAIL**. На отдельном исправленном
коммите #57 обязательные локальные gates и **45/45 независимых проверок — PASS**.
Эту исправленную цепочку можно передавать на техническое рассмотрение интеграции
P1-29B в проверенном объёме. Это не merge, не owner acceptance и не production
security certification. Незавершённый #54 остаётся **BLOCKED** до согласования
протокола и повторной проверки после переноса исправлений.

## Источники, изоляция и сохранение исходного аудита

Прочитаны `AGENTS.md`, релевантные §§4.6, 5, 15.1 `ts.md`, актуальный
`docs/status/CURRENT.md`, исходный отчёт #55 и
`docs/audits/P1-29B-AUDIT-REMEDIATION-PLAN.md`, изменённые контроллеры,
клиентские Team epochs/invitations/freshness, тесты и код #54.

[Исходный QA PR #55](https://github.com/1troitsky/photobunker-v3/pull/55) и его
[FAIL/evidence](https://github.com/1troitsky/photobunker-v3/blob/7f653a590ab4a0b44a1e576ee4e5ea9ad07183bc/docs/audits/evidence/P1-29B-TEAM-CRYPTO-AUDIT-local.json)
сохранены на `7f653a590ab4a0b44a1e576ee4e5ea9ad07183bc` без изменений.
Новые QA, неизменяемый продукт #56, отдельное исправление и read-only #54
находились в разных worktree. Ветка исправления не включает QA-коммиты.

Два новых полных запуска создали отдельные random Compose projects с synthetic
аккаунтами и tmpfs PostgreSQL/Garage. Ни существующие контейнеры, ни main,
продуктовые PR #50–56, production keys/data не менялись. Merge/deploy и
destructive resets не выполнялись. Все 38 первоначальных локальных файлов
пользователя сверяются по SHA-256. Service Worker не включался.

## Команды и результаты

Исходный запуск на точном #56:

```sh
python3 -B scripts/team-crypto-audit/run.py \
  --source-root /private/tmp/pb3-r07-product --diagnose-media
```

Общий exit **1**, private run `pb3-acceptance-hvoodmzb`.

Исправленный коммит #57:

```sh
python3 -B scripts/team-crypto-audit/run.py \
  --source-root /private/tmp/pb3-r07-fix \
  --target-ref 65f0c1a27a342ebfe5044ee1af7bb8cad27738ed --diagnose-media
```

Общий exit **0**, private run `pb3-acceptance-1t2uqh68`. Оба запуска сохранены
отдельно в [sanitized evidence](evidence/P1-29B-REAUDIT-local.json): реальные
commands, exit codes, версии, статусы каждого теста и каждого инварианта.

| Проверка | #56 | #57 |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS, exit 0 | PASS, exit 0 |
| PHP security floor | PASS, 8.4.27 | PASS, 8.4.27 |
| Composer install/validate, lint, routes, plans | PASS, exit 0 | PASS, exit 0 |
| `php vendor/bin/phpunit --log-junit /app/phpunit-junit.xml`, network none | PASS, 101 / 1696 assertions | PASS, 101 / 1696 assertions |
| `pnpm test:web` | PASS, 137 tests | PASS, 143 tests / 28 files |
| `pnpm typecheck`, `pnpm build` | PASS, exit 0 | PASS, exit 0 |
| Real PostgreSQL migrate / Garage SQL/S3 smoke / lifecycle smoke | PASS, exit 0 | PASS, exit 0 |
| Полный неизменённый Chromium product suite | PASS, 19/19 | PASS, 19/19, включая readiness patch |
| Дополнительный запуск старых media tests | FAIL, 2/3 | PASS, 3/3 |
| Независимый Teams security journey | FAIL, 43/45 инвариантов | PASS, 45/45 |
| pg_dump / container-log private canary scan | PASS | PASS |
| Чистота pinned product source после запуска | PASS | PASS |

Реальное окружение: macOS 26.6.2, Node 22.23.3, pnpm 10.20.0, PHP 8.4.27,
locked Laravel 13.39.0, PostgreSQL 18.6, Garage 2.5.0, Chromium 141.0.7390.37,
Playwright 1.56.1. Unit/feature PHP используют SQLite; интеграция и браузер —
настоящие PostgreSQL/Garage. PHP 8.5 локально NOT TESTED; результаты CI отдельно.

На точном #56 GitHub API подтвердил **3/3 success**, attempt 1:
[foundation](https://github.com/1troitsky/photobunker-v3/actions/runs/42859562949),
[security](https://github.com/1troitsky/photobunker-v3/actions/runs/42859563141),
[SQL/S3/Chromium](https://github.com/1troitsky/photobunker-v3/actions/runs/42859563053).
CI не выявлял R07-01/R07-02: старые проверки не повторяли live v1 read после
role update и не проверяли источник durable membershipRevision.

CI #57: [foundation](https://github.com/1troitsky/photobunker-v3/actions/runs/42875110690)
и [security](https://github.com/1troitsky/photobunker-v3/actions/runs/42875110951),
[storage/browser](https://github.com/1troitsky/photobunker-v3/actions/runs/42875110675)
— **3/3 PASS**, attempt 1, точный SHA совпадает. Состояние независимо прочитано
через GitHub API и сохранено в [GitHub evidence](evidence/P1-29B-REAUDIT-github-and-compatibility.json).

## Приёмка T29B-01: signed retirement и следующий rekey

**PASS на #56 и #57**, при настоящих подписи/WebCrypto/HTTP/PG:

- A приглашает B и C; они подписывают consent; D остаётся pending.
- После смены роли B и исключения B все member key reads quarantined:
  B 404, C 409, D получает key-free suspension notice.
- В queued signed epoch2 содержится ровно ID ожидающего D, а не accepted B/C.
  Owner local ciphertext создаётся до HTTP.
- Отсутствующее обязательное поле → 422, пропуск D → 409, дубликат → 422,
  заменённый ID → 409, лишний ID → 409, изменённые байты с прежней подписью → 401.
  Ошибочные запросы не продвигают epoch. Исходные проверки recipient/role/digest/
  root/revision/signature не ослаблены и тоже выполнены.
- Server-committed Lost ACK: 201 до обрыва, неизменный IDB ciphertext hash после
  full reload, byte-for-byte replay → 200/unchanged=true.
- C расшифровывает epoch2, B получает 404, старый DEK не открывает новую версию,
  owner самостоятельно проверяет signed retirement при чтении roster.
- A снова управляет составом, исключает C и завершает epoch3: recipients=0,
  retiredPendingInviteIds=[], quarantine=false; C получает 404.

Это исправляет исходное расхождение unsigned pending sweep / signed roster.
Ключи или данные исключённых участников не удаляются магически; старые знания
невозможно отозвать. Автоматического photo/media/assignment доступа не появляется.

## Приёмка T29B-02: durable encrypted freshness

**PASS на #56 и #57** в модели сохранившегося device/IndexedDB:

- C реально проверяет цепочку и ECDH/AES-GCM decrypt epoch2. `freshness` —
  ciphertext под AKEK с hashed account/team indexes, без открытых name,
  description, account/team IDs, epoch, contract hash и membership revision.
- Full page reload сохраняет тот же hash encrypted freshness/joined rows.
- Доставка genuine исторических epoch1 `/member` и `{keyEpoch:1}` после reload
  отклоняется **именно `teams.verified_epoch_rollback`**, snapshot не заменяется.
- Genuine owner-signed same-epoch fork с другим operationId/hash отклоняется
  `teams.verified_epoch_fork`; подпись не подделывается.
- Сниженная membership revision отвергается; offline snapshot остаётся читаемым
  как локальный, без live entitlement.
- Две настоящие вкладки одного browser profile конкурентно пишут разные
  watermark fixtures. Реальный IDB сохраняет большую epoch, старая отклоняется.
  Это тест атомарности хранилища; synthetic stamps не выдаются за проверку
  криптографии несуществующей серверной эпохи.
- Account switch во время HTTP → `identity.changed`; чужой joined snapshot
  не публикуется. Исходные tampered epoch/owner-directory отказы сохранены.

Полный device/cache rollback и скомпрометированный JS origin не решены.
Независимый trust/freshness anchor не подменяется same-origin self-verification.

## R07-01 — ложный rollback при повторном v1 чтении после смены роли

**FAIL на #56 → PASS в #57.** После подписанной смены viewer→contributor
первое чтение сохраняет membershipRevision=2. При следующем
`openAnyJoinedTeam()` ветка epoch1 подставляла revision=1 до проверки текущего
role receipt. Получался `teams.verified_revision_rollback` при нормальном чтении.

Исправлено в `team-epochs.ts` / `team-invitations.ts`: ранняя проверка использует
только известные epoch/hash; не выдумывает membershipRevision. Проверка owner,
epoch rollback и same-epoch hash fork остаётся ранней. Definitive atomic IDB
commit всегда сравнивает полную уже подтверждённую revision. Снижение роли
путём replay старого signed receipt по-прежнему отвергается.

## R07-02 — неподписанная ревизия отравляет durable floor

**FAIL на #56 → PASS в #57.** На C, уже подтвердившем signed epoch2/revision3,
QA меняет **только** внешнюю HTTP membershipRevision в `/epoch/member` и
`/epoch/history` на 1000000. Signed epoch, recipient envelope, profile и owner
signatures неизменны. #56 принимает профиль и записывает 1000000 в encrypted
floor; следующий настоящий ответ revision3 блокируется как rollback.

Модель угроз совпадает с исходной защитой от rolled-back/malicious API delivery;
обычный наблюдатель HTTPS такую подмену выполнить не может. Нового DEK для B
это не раскрывает, но доступ честного клиента блокируется сохранённым state.

В #57 durable revision берётся только из owner-signed epoch contract и проверенного
role receipt. Высокий live HTTP counter может участвовать в согласованности
ответов, но не становится криптографическим свидетельством. Metadata ниже
revision подписанной эпохи отклоняется. Signed revision rollback всё ещё
останавливается внутри той же IDB-транзакции, snapshot не удаляется.

Шесть новых unit-регрессий с реальными подписью/decrypt:
повторное чтение роли v1; старый role receipt v1; unsigned inflation; signed
role revision4 после epoch2 и его replay; metadata ниже signed revision;
epoch1 replay даже с более новым role receipt. Целевой Vitest — **6/6**, exit 0.
Всё исправление: 2 клиентских файла, 1 новый unit-файл и узкий media E2E readiness
patch. Серверные timestamp-проверки, security floor и signed retirement не менялись.

Уже отравленные прежним Draft-кодом watermarks автоматически не сбрасываются:
их удаление уничтожило бы anti-rollback evidence. Прогон #57 проверяет новое
корректное состояние; восстановление старого отравленного IDB отдельно NOT TESTED.

## Media 401/422 и QA harness

На #56 отдельный запуск `p1-assignment-media.spec.ts:174` снова упал при JSON
разборе HTML, хотя полный suite того же SHA прошёл 19/19. Это не выдаётся за
безвредный сбой. Из исходного #55 уже есть transport evidence: direct roster GET
стартовал до завершения login proof и получил 401.

В #57 **тест**, перед серверной проверкой owner roster после navigation, ждёт
`requireSession().online===true` и запрашивает JSON/no-store. Он по-прежнему
проверяет HTTP 200 и настоящий список участников; timeout не расширяется,
успех не подменяется. Это устраняет конкретную readiness-причину, не доказывая
отсутствия всех возможных session races в продукте.

Обнаружен и исправлен дефект старого QA инструментирования: `.replace()` ожидал
пробелы в `import { test, expect }`, тогда как исходники используют
`import {test,expect}`. Замены не было; предыдущие «instrumented» прогоны
фактически были запусками оригинальных тестов. Их results остаются подлинными,
но transport instrumentation нельзя считать выполненным. Новый regex обязан
совпасть ровно один раз. На #57 wrapper действительно записал **274** технических
response events, **0** HTTP 401/422; media 3/3 и полный Chromium 19/19 PASS.

**Исторический 422 не объявляется исправленным.** В этих двух новых запусках
grant POST 422 не воспроизвёлся. В исходном #55 реальный 422 сохранён; точный
predicate rejection не установлен. Временная разница часов/24h expiry — только
непроверенная гипотеза. Backend expiry/security проверки не ослаблялись.
Детерминированный repro исходного 422 — **NOT TESTED / OPEN**.

Первый offline pnpm install не нашёл tarball (`ERR_PNPM_NO_OFFLINE_TARBALL`,
exit 1); обычный frozen install затем прошёл. Это environment failure, не продукт.
Никаких retries-until-green; два полных запуска сравнивают разные продуктовые
SHA с конкретным изменением, исходный FAIL сохраняется.

## Совместимость незавершённого P1-29C #54

Проверен read-only HEAD **`4a4340871ffff2aa553e630373383484fcf401ab`** на базе
старого #53. **BLOCKED**, merge/runtime PASS не заявляется.

```sh
git merge-tree --write-tree --messages \
  41fa666b3cc54d351ce0d916fecf6e44973c97a5 \
  4a4340871ffff2aa553e630373383484fcf401ab
```

Exit **1**, конфликты: `TeamKeyEpochController.php` и `team-epochs.ts`.
Созданы только временные Git objects; refs/index/ветки не объединялись.

Помимо текстовых конфликтов есть контрактные несовместимости:

1. #54 автоматически отзывает pending `team_invites_v2` при ротации, но ни
   signed epoch shape, ни exact retirement set #56 не включают v2 IDs. Простое
   сохранение SQL sweep возвращает неподписанное ACL-событие исходного T29B-01.
2. Frontend queue #54 собирает v2 survivors, но signed pending retirement из
   #56 формируется только по v1 roster. Требуется точный подписанный v2 набор,
   проверяемый под тем же team lock и атомарно погашаемый. Нельзя просто
   разрешить arbitrary `revoked` флаг.
3. Новые #54 member-read пути вызывают `cacheVerifiedJoinedTeam(joined,id)` без
   третьего аргумента verified epoch stamp. Нужен перенос anti-rollback на
   каждый v2/current-member вход, с подписанным источником revision из #57.
4. В #54 fixtures/strict parser используют старую signed epoch форму без
   обязательных retirements. Старые root/epoch contracts нельзя переписывать
   для прохождения новых assertions.

Для продолжения #54: перенести на исправленную цепочку; согласовать типизированное
подписанное доказательство v1/v2 pending retirement, точные bounded sets и
одинаковый lock/CAS; обновить client verification и все signed fixtures; проверить
v2 pending → next epoch → no stale envelope/accept, Lost ACK, concurrent consent,
второй rekey, role/remove, fresh re-invite и неизменность исторического ledger.
Затем полный integration/security аудит. В #54 в этом задании правок нет.

## Ограничения и итоговое решение

| Область | Статус |
|---|---|
| T29B-01 exact signed retirement / epoch3 | PASS |
| T29B-02 persisted epoch floor / genuine replay / fork / tabs | PASS |
| Новые R07-01/R07-02 на #56 | FAIL; исправлены отдельно в #57 |
| Обязательные локальные gates на #57 | PASS |
| Исторический media 422: детерминированная причина | NOT TESTED / OPEN |
| #54 совместно с новой цепочкой | BLOCKED |
| Native Safari/iPhone/Android, hardware camera/permissions/background | NOT TESTED |
| Production migration load/locks, действительно одновременные PG tx | NOT TESTED |
| PHP8.5 локально, полное forensic исследование памяти/OS/storage | NOT TESTED |
| Trusted cold offline / независимый JS freshness anchor | BLOCKED BY DESIGN |
| Полный device/cache rollback, recovery уже отравленного старого floor | NOT TESTED |
| Визуальная эстетика / mobile UX parity / performance before-after / RUM | NOT VERIFIED; продуктовый UI не менялся |

Plaintext scan ограничен приватными случайными team name/description canaries в
реальных pg_dump и container logs, плюс проверками формата encrypted IDB.
Секреты, canaries, IDs аккаунтов, raw E2E traces и credentials в public evidence
не экспортируются. Команды/exit codes/hashes и технические boolean proofs доступны
в [local evidence](evidence/P1-29B-REAUDIT-local.json),
[CI/compatibility evidence](evidence/P1-29B-REAUDIT-github-and-compatibility.json),
[reproduction instructions](../../scripts/team-crypto-audit/README.md).

**Решение:** не интегрировать один #56. Рассматривать #50→#51→#52→#53→#56→#57
в проверенном P1-29B объёме, с сохранением перечисленных ограничений и отдельным
решением владельца о merge. P1-29C можно продолжать после переноса исправлений;
текущий #54 не совместим и не готов к интеграции. Main и deploy не затронуты.
