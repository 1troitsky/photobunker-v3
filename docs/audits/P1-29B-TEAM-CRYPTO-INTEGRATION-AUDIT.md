# P1-29B — независимый интеграционный и криптографический аудит Teams

Дата: 2026-11-10. Продукт: **`03bcc0880521ebcc9145f134233d39be6a339c2c`**.
База: `main @ ee0cbe6836b5359e971319dfc8ae91ef695c7d42`.
QA: `qa/p1-29b-team-crypto-audit`, Draft поверх #53. Продуктовый код не изменён.

**Заключение: FAIL; интеграция и закрытие P1-29B заблокированы.** Основная
цепочка A → B → C и криптографические отказы работают в проверенном окружении,
но найдены два воспроизводимых дефекта: потеря возможности управлять составом
после автоматического отзыва pending-приглашения и принятие исторической эпохи
после уже проверенной новой. P1-29C нельзя считать следующим закрываемым gate,
пока эти проблемы не исправлены и независимо не перепроверены. Разработка
invitations v2 возможна отдельно; это не разрешение на merge.

## Область и источники

Прочитаны `AGENTS.md`, релевантные разделы `ts.md` (Local-First, identity/E2EE,
контакты/команды), `docs/status/CURRENT.md`, планы P1-27/28/29A/29B, клиентские
Team book/invites/epochs и key-directory, контроллеры Teams, миграции, PHP/Vitest
и Chromium-тесты. Независимые тесты используют настоящие модули приложения,
WebCrypto и HTTP; API, шифрование и серверный успех не подменяются. Перехват
ответов используется явно для потери ACK и моделирования злонамеренной доставки.
Подтверждение fingerprints в тесте программное между известными тестовыми
аккаунтами; человеческая проверка по независимому каналу не моделировалась.

PB2 и принятый UX остаются read-only evidence; код из них не переносился.
Изменения main, продуктовых PR, merge, deploy, production-ротация, сброс БД и
удаление пользовательских данных не выполнялись. Каждый запуск получил новый
Compose project, временные PostgreSQL/Garage и синтетические аккаунты. Удалялись
только созданные harness контейнеры, без `prune`, `down -v` и внешних хранилищ.

## Проверка цепочки

| PR | Родитель | Точный HEAD | Результат |
|---|---|---|---|
| #50 | main `ee0cbe6` | `157909c9b414f7d4ea8591b683b69913946a42c3` | PASS |
| #51 | #50 | `b45028d46b56c37173cafdc7bcd311b65c042e15` | PASS |
| #52 | #51 | `70d6a1e55b7fee8b56cece70f483fba5589346ef` | PASS |
| #53 | #52 | `03bcc0880521ebcc9145f134233d39be6a339c2c` | PASS ancestry; FAIL acceptance |

`python3 -B scripts/team-crypto-audit/analyze.py <product-worktree>` завершился
с exit **0**: все четыре base→head отношения подтверждены `merge-base
--is-ancestor`, в 55 коммитах нет повторных stable patch-id и conflict markers.
Сводный diff — 31 файл, 5122 добавления / 57 удалений; manifest SHA-256 включён
в evidence. Более ранние коммиты не потеряны. Аудит семантики обнаружил именно
несовместимость контракта автоматического revoke с проверкой roster (T29B-01),
поэтому корректная Git-история не означает готовую интеграцию.

При будущем разрешении владельца сохранять порядок #50 → #51 → #52 → #53
и отдельные исправления поверх #53. Не cherry-pick всей цепочки повторно.
#52 отдельно оставляет quarantine без возможности безопасного завершения rekey.
В этом аудите слияния не выполнялись.

Точные три workflow #53 независимо прочитаны через GitHub API: [foundation](https://github.com/1troitsky/photobunker-v3/actions/runs/42826191583),
[security](https://github.com/1troitsky/photobunker-v3/actions/runs/42826192284),
[PostgreSQL/Garage/Chromium](https://github.com/1troitsky/photobunker-v3/actions/runs/42826191884)
— `completed/success`, attempt 1, HEAD совпадает. Это отдельное CI evidence;
локальные красные результаты им не заменяются.

## Фактические команды и результаты

Первый запуск: `python3 -B scripts/team-crypto-audit/run.py --source-root
/private/tmp/pb3-team-audit-product`, общий exit **1**.
Артефакт: `pb3-acceptance-qh4b93oa`.

| Команда / сценарий | Exit | Результат |
|---|---:|---|
| `pnpm install --frozen-lockfile` | 0 | PASS |
| `pnpm typecheck` | 0 | PASS |
| `pnpm test:web` | 0 | PASS — 131 тест / 26 файлов |
| `pnpm build` | 0 | PASS; предупреждение Vite о bundle >500 kB сохранено |
| `php /source/scripts/check-runtime.php` в Docker | 0 | PASS — PHP 8.4.27 |
| `composer install`, `composer validate --strict --no-check-publish` | 0 | PASS — locked Laravel 13.39.0 |
| `php vendor/bin/phpunit --log-junit /app/phpunit-junit.xml`, network none | 0 | PASS — 100 тестов / 1681 assertions, SQLite unit/feature |
| PHP lint, plan registry, route list | 0 | PASS |
| `php artisan migrate --force` на новой PostgreSQL | 0 | PASS |
| `php tests/integration/garage-postgres-smoke.php` | 0 | PASS — реальная БД/S3 ciphertext roundtrip |
| `php tests/integration/lifecycle-garage-smoke.php` | 0 | PASS — штатный synthetic lifecycle smoke |
| `pnpm exec playwright test --config tests/playwright.config.ts` | 1 | FAIL — 17/19, оба Teams E2E PASS |
| Независимый audit до появления test source | 1 | FAIL QA harness — `No tests found`; не продукт |

Два независимых прогона в новых fixtures:

1. `.../run.py --source-root <product> --focused`, exit **1**,
   `pb3-acceptance-_aejwgoz`: 24/26 независимых инвариантов PASS, 2 FAIL.
2. `.../run.py --source-root <product> --focused --diagnose-media`, exit **1**,
   `pb3-acceptance-93o6w9y4`: 25/28 инвариантов PASS, 3 FAIL
   (два относятся к одной причине T29B-01). Старые media-сценарии **3/3 PASS**,
   отдельная команда exit **0**.

Фактический браузер — Chromium **141.0.7390.37**, Playwright **1.56.1**, macOS
**26.6.2**, Node **22.23.3**, pnpm **10.20.0**, PostgreSQL **18.6**, Garage **2.5.0**.
PHP 8.5 локально не запускался; его зелёный результат есть только в точном CI.
Нет автоматических retries. После второго подтверждения каждой Teams-причины
локальный цикл остановлен. Исходные красные результаты сохранены.

## Матрица независимых сценариев

Для каждой строки ниже исполняемый сценарий —
`pnpm exec playwright test --config tests/team-crypto-audit/playwright.config.ts`
в runner с настоящим API/PG. Общий exit **1** из-за перечисленных дефектов;
отдельные результаты и фактические значения находятся в `audit-proof` evidence.
`PASS` означает выполненную проверку конкретного инварианта, а не зелёный suite.

| Сценарий | Статус | Фактическое доказательство |
|---|---|---|
| A создаёт; B/C принимают подписанные invites; D остаётся pending | PASS | C расшифровывает v1; B читает новую подписанную роль |
| Смена B viewer→contributor | PASS | Клиент проверяет owner receipt, показывает contributor |
| Две операции removal одной ревизии | PASS | Конкурирующие HTTP-запросы: 201 и 409; один PHP worker, не доказательство одновременных PG tx |
| Исключение B / quarantine | PASS | B получает 404, C 409; D получает только inviteId/teamId/state |
| Поддельная подпись / другой domain | PASS | 401 / 401 |
| Пропущенный C / включённый исключённый B | PASS | 409 / 409 |
| Неверная роль / directory digest / revision / previous hash | PASS | 409 для каждого |
| Дублированный recipient | PASS | 422 |
| Негативные записи не поднимают epoch | PASS | Owner status остаётся 1 до корректного commit |
| Encrypted outbox до HTTP | PASS | Нет имени, описания, account/team IDs, privateEnvelope; только ciphertext/indexes |
| Сбой до доставки | PASS | Ошибка сети; неизменный hash локального ciphertext |
| Сервер commit, потеря ACK, reload | PASS | Commit 201; прежний ciphertext hash до/после reload |
| Точная повторная отправка | PASS | Два идентичных body; replay 200/unchanged=true; epoch 2 |
| Свежесть DEK / owner wrap / AEAD context | PASS | Новый 32-byte ключ отличается; старый ключ и изменённый AAD не расшифровывают; owner decrypt успешен |
| C получает и расшифровывает epoch 2; B не получает ключ | PASS | Реальное ECDH/AES-GCM чтение C, B 404 |
| D не принимает старый invite после rekey | PASS | Конфликт сохраняется в outbox; member endpoint D 404 |
| Изменённый ответ epoch / owner directory | PASS | `teams.untrusted_member_epoch` / `share.unsigned_directory` |
| Смена аккаунта во время HTTP | PASS | `identity.changed`, чужой joined cache не публикуется |
| Локальный verified cache переживает отказы | PASS | Один расшифровываемый локальный snapshot сохраняется |
| Roster и следующее исключение после pending sweep | **FAIL** | T29B-01, `teams.roster_acl_mismatch` |
| Возврат с проверенной epoch 2 на историческую epoch 1 | **FAIL** | T29B-02, `accepted-old-epoch` |
| Защита от destructive migration downgrade | PASS в PHP feature tests | `TeamKeyEpochTest` и membership tests; PG/production rollback отдельно NOT TESTED |
| Plaintext canaries в БД/логах | PASS, ограниченный scan | Оба focused запуска: pg_dump и container logs без приватных name/description canaries |
| Автоматический media/assignment доступ от Team membership | PASS в PHP tests / review | Tests проверяют отсутствие grants; отдельный полный hostile-server ACL audit не выполнен |

## T29B-01 — автоматический revoke pending invite ломает дальнейшее управление

**FAIL, приоритет высокий для завершения этой вертикали.** Подтверждено дважды
на неизменном SHA. Проблема согласования контракта backend/frontend, не harness.

Воспроизведение:

1. A приглашает B и C; оба принимают. A приглашает D, D не принимает.
2. A меняет роль B, исключает B и выполняет корректную ротацию на C.
3. `TeamKeyEpochController::rotate()` атомарно переводит все pending v1 invites
   в `revoked`, сохранив исходные подписанные invites, но не создаёт для D
   подписанное membership remove event.
4. `listOwnerTeamRoster()` выводит `signedRevoked` только из membership history
   и требует `(item.state==='revoked')===signedRevoked`. Для D это false.
5. Вызов возвращает `teams.roster_acl_mismatch`. Следующий
   `queueTeamMembershipChange(...C,'remove',null)` завершается той же ошибкой
   до создания операции. Управление командой через штатный клиент блокируется.

Ссылки на продукт: [`rotate()`](https://github.com/1troitsky/photobunker-v3/blob/03bcc0880521ebcc9145f134233d39be6a339c2c/apps/api/app/Http/Controllers/TeamKeyEpochController.php),
[`listOwnerTeamRoster()` / `queueTeamMembershipChange()`](https://github.com/1troitsky/photobunker-v3/blob/03bcc0880521ebcc9145f134233d39be6a339c2c/apps/web/src/features/people/application/team-invitations.ts).

Не ослаблять проверку до доверия любому `revoked` флагу. Исправление должно
дать проверяемое подписанное доказательство, что конкретный pending invite
погашен конкретной ротацией, либо включить согласованные signed revoke events
в атомарный контракт. Сохранить root/epoch chain, согласие, revision CAS и
подписи. Нужна регрессия с pending survivor, последующим удалением C и следующей
ротацией. Продуктовый patch в этом QA PR отсутствует; оформлять отдельно поверх #53.

## T29B-02 — клиент принимает историческую эпоху после уже проверенной новой

**FAIL, security freshness/rollback; приоритет средний.** Подтверждено дважды.
Это не взлом AES, не выдача нового DEK исключённому B и не обход серверного 404.

Воспроизведение:

1. C принимает настоящий invite и получает корректно подписанный `/member`
   ответ epoch 1. QA сохраняет этот ответ только в памяти.
2. A исключает B, публикует epoch 2; C успешно проверяет цепочку и расшифровывает
   новую эпоху через `openAnyJoinedTeam()`.
3. Перехватить только доставку ответов C: вернуть `{teamId,keyEpoch:1}` на
   `/epoch/member`, а на `/member` — сохранённый подлинный исторический ответ.
   Подписи не меняются и не подделываются.
4. `openAnyJoinedTeam()` сразу переходит в `openJoinedTeam()` при keyEpoch=1.
   Персистентного максимума уже проверенной эпохи/revision/hash нет. Возвращается
   успешный `JoinedTeam` с `verifiedOnline:true`, старый snapshot снова сохраняется.

Ссылки: [`openAnyJoinedTeam()`](https://github.com/1troitsky/photobunker-v3/blob/03bcc0880521ebcc9145f134233d39be6a339c2c/apps/web/src/features/people/application/team-epochs.ts),
[`JoinedTeam` / cache](https://github.com/1troitsky/photobunker-v3/blob/03bcc0880521ebcc9145f134233d39be6a339c2c/apps/web/src/features/people/application/team-invitations.ts).

Модель угроз: злонамеренный/откаченный origin или воспроизведение корректных
исторических API данных в сохранённом клиентском приложении. Обычный сетевой
наблюдатель без нарушения HTTPS не получает такой возможности. Проверка цепочки
подтверждает происхождение и внутреннюю согласованность, но не свежесть.

Минимальное исправление для возвращающегося устройства: AEAD-защищённый
account/team-scoped максимум verified epoch + contract hash + membership revision,
атомарное продвижение и запрет downgrade во всех v1/v2 входах. Проверять также
same-epoch fork и сброс минимальной ревизии; не уничтожать encrypted offline data.
Это не защищает от полного отката устройства/его cache. Для такого обещания
нужна отдельно определённая модель независимого monotonic/freshness anchor;
изменяемый JS того же origin и self-verifying SW ею не являются.

## Оценка криптографии и границы доверия

В просмотренном коде Team DEK генерируется WebCrypto CSPRNG независимо от AKEK;
AES-256-GCM использует отдельные 96-bit IV и 128-bit tag. AKEK служит owner/local
wrapping key. Для каждого активного получателя создаётся отдельная ephemeral
P-256 ECDH пара, shared secret проходит HKDF-SHA256 с random salt, затем ключ
защищает DEK через AES-GCM. Контекст связывает team, owner, from/to epoch,
recipient account, роль, directory digest, membership revision и previous hash.
Корректность направлений wrap/decrypt и отказ неправильного key/AAD реально
проверены; статистическая оценка энтропии и математическое доказательство не делались.

Owner P-256 signatures domain-separated; canonical JSON, размеры и recipient
ordering ограничены. Backend сверяет всех и только active non-owner recipients,
их роли и актуальные directory digests, держит team row lock, проверяет epoch,
previous hash/revision CAS, пишет ledger/grants и снимает quarantine в одной tx.
Exact replay использует operationId и неизменные contract/signature. Клиент
проверяет pinned owner/directory и историю, но T29B-02 ограничивает anti-replay claim.

Нельзя стирать старые знания B удалённо. Старые root/ledger и previously decrypted
content остаются историей; после rekey сервер не предоставляет B новый envelope,
а старый DEK не открывает новую версию профиля. Роли Teams не означают ACL ко всем
фото, заданиям или сообщениям. Новые v1 invites после epoch 1 запрещены до P1-29C.

Plaintext scan ограничен случайными приватными именем/описанием в реальных
pg_dump и логах и проверкой структуры encrypted epoch IndexedDB. Это не полный
forensic scan browser memory/OS swap, всех recovery secrets, всех HTTP bodies
или production storage. Секреты, raw traces и canaries в репозиторий не экспортированы.

## Старые media E2E и ошибки окружения

В полном прогоне упали **два** существующих теста; ни один продуктовый файл из
них/их домена в Teams diff не менялся:

- `p1-assignment-media.spec.ts:174`: прямой fetch roster после navigation получил
  **401 text/html**, после чего `res.json()` упал на `<!DOCTYPE`. Из private trace
  извлечены только времена: login proof начался `16:11:15.005Z`, длился 55.567 ms;
  GET начался `16:11:15.013Z`. Тест не дождался завершения online hydration.
  `Accept: application/json` дал бы JSON ошибку, но сам по себе не исправил бы 401.
  Это подтверждённая гонка проверки readiness в данном E2E; отсутствие продуктовых
  проблем session concurrency из неё не следует.
- `p1-media.spec.ts:220`: реальный POST `/media-shares/v1/grants` получил **422**,
  затем локальный grant не был `sent` (`grant.not_confirmed`). Точная причина
  не установлена; отвергать её как «безвредную» нельзя.

Один диагностический повтор точных старых тестов с добавленным пассивным
transport logging прошёл **3/3** за ~28.4 s. Изменён только импорт Playwright
fixture для наблюдения; запросы, ожидания, таймауты и assertions не изменены.
Это доказывает прерывистость локального результата, а не исправление.
Ранее описанные в #52 «2/3 sent после 30 s» здесь не воспроизвелись и **не
отождествляются** с нынешними 401/422. Для интеграции нужна отдельная стабилизация
readiness и диагностика отказов grant/submission с сохранением первого сбоя.

Первая независимая команда `No tests found` вызвана преждевременным запуском
до создания файла. Final runner проверяет наличие source до provision. Сбой
Python `py_compile` из-за запрета записи в системный cache проверялся отдельно
через in-memory `compile()`; это ограничение sandbox, не продуктовый дефект.

## Не проверено и блокировки

| Область | Статус |
|---|---|
| Native Safari, iPhone, Android, реальные camera/permissions/background | NOT TESTED |
| Production migration load/locks и online rollback под конкурентными writers | NOT TESTED |
| Реально перекрывающиеся PostgreSQL tx / directory rotation race | NOT TESTED; проверены HTTP CAS и статическая locking-модель |
| Новые invites/consent после epoch 1 | BLOCKED — контракт P1-29C ещё отсутствует |
| Trusted cold offline bootstrap / independent JS trust anchor | BLOCKED BY DESIGN; SW не включался |
| Полный откат device/cache, новый device monotonic freshness | NOT TESTED / требуется архитектурное решение |
| Полный независимый специализированный crypto review | NOT TESTED |
| Эстетика/полная UX parity, accessibility/mobile hardware | NOT VERIFIED; продуктовый UI не менялся |
| Performance before/after и RUM | NOT VERIFIED; baseline/порог не выдумывались |

## Артефакты и решение

- [Sanitized local evidence](evidence/P1-29B-TEAM-CRYPTO-AUDIT-local.json): реальные
  commands/exit codes, версии, исходные failures, per-invariant proofs, privacy
  booleans, ancestry/source manifest. Все три запуска сохранены отдельно.
- [GitHub metadata](evidence/P1-29B-TEAM-CRYPTO-AUDIT-github.json): точные PR bases,
  heads и CI conclusions. [Reproduction](../../scripts/team-crypto-audit/README.md).
- QA sources не содержат продуктовых изменений. Перед сдачей проверяются чистота
  immutable product, неизменность main/product PR heads и 38 локальных файлов
  пользователя по предварительному SHA-256 manifest.

Решение: **не интегрировать этот SHA и не объявлять P1-29B принятым**.
Исправить T29B-01/T29B-02 отдельным Draft поверх #53, сохранив security checks;
повторить соответствующие независимые сценарии и обязательные gates, отдельно
разобрать media failures. После этого можно закрывать P1-29B и проверять P1-29C
с epoch-scoped invitation/acceptance и защитой от повторного использования старых grants.
