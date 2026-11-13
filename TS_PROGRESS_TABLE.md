# PB3 — единая таблица прогресса

**Актуализировано: 13.11.2026.** Отдельно учитываем: реализовано → проверено на точном SHA → интегрировано в `main` → принято владельцем → готово к релизу. Проценты не используются. Источники — [AGENTS.md](AGENTS.md), [ts.md](ts.md), [global QA](docs/audits/PB3-GLOBAL-INTEGRATION-20261113.md), [PR #293](https://github.com/1troitsky/photobunker-v3/pull/293) и [Draft PR #292](https://github.com/1troitsky/photobunker-v3/pull/292).

**Подтверждённый `main`: `6565a0fe852882ea5fc26e493df81affed687eee`** — обычный merge PR #293, история сохранена; **post-merge CI 4/4 workflows, 7/7 jobs PASS**. Старое упоминание `main@da7327b8` описывало состояние *до* merge и больше не актуально. Исходный интеграционный HEAD #293: `4521f7b9c954df5af2356311115f425673796d8e`, до merge имел 5/5 workflows, 8/8 jobs PASS, включая 84/84 Chromium; в него входили #63 clock-margin и Symfony security patches. Инвентаризация 198 PR / 189 тогда открытых — исторический срез до #293, а не текущий счётчик PR.

**Независимая ветка сообщений (не в `main`):** Draft [#292](https://github.com/1troitsky/photobunker-v3/pull/292), `p2/291-messages-local-drafts-integration`, **HEAD `5f6aef8a19798e1da01c5cd4ae0029cc03581d60`**, база `main@6565a0fe`. Полный exact-head CI **4/4 workflows, 6/6 jobs PASS**; PHP 8.4/8.5 **245/245** на каждой, Vitest **455/455**, Chromium **86/86**, PostgreSQL/Garage и quota races **5/5**, TS/build, Security, UX, Composer audit PASS. Два прежних Dock FAIL (83/85 на старом HEAD) исправлены на новом HEAD без выключения тестов. Issue [#291](https://github.com/1troitsky/photobunker-v3/issues/291) имеет GitHub label `review`. Слияние #292 **не разрешено и не выполнялось**.

| Подсистема | В `main` после #293: проверенное | В Draft / остаётся / проверка на реальных устройствах |
|---|---|---|
| Интеграция / CI | #293 в `main@6565a0fe`; post-merge 4/4 workflows, 7/7 jobs PASS; сохранена история | Открытые старые stacked PR не равны независимым задачам; без массовых merges |
| Identity / Recovery / E2EE | Registration, Recovery Key A→B, ciphertext/readback, ACL negatives, тёплый offline | Полная ротация Recovery Key / remote revoke не приняты; cold offline bootstrap BLOCKED |
| Camera / GPS | Выбран GPS #263; negatives #258, consent revoke, JPEG и AV regression | iOS/Android/GNSS и физические сенсоры NOT TESTED; текущий AV cap 175s против требований 300s/3000s |
| Browser / Viewer / редакторы | E2EE media, большой каталог, page-2, JPEG editor/маски, WAV trim, Safe ACL и навигация | MP4 export, полная codec/mobile проверка не приняты; signed MediaFile cursor #254 остаётся `backlog`, требуется утверждённый protocol contract |
| Assignments / Contacts / Teams | Подписанные политики, grants/revoke, многоаккаунтный ACL, 5/5 PG quota races | Финальная owner UX acceptance и native permissions NOT TESTED |
| StorageManager / Garage | Реальный outage/restart, worker retries, Lost ACK, SHA readback, tombstones, непустой upgrade | BYO-S3 / replicas / failover и production GC не приняты |
| Billing / quotas / retention | 5 immutable планов, подписанный admission, paid/downgrade и clock-margin #63, synthetic+real PG tests | Реальные платежи NOT TESTED; #203 — `backlog` до завершения grace/Unlimited/backup-aware retention contract |
| Messages / Matrix | Реальной Matrix-доставки в `main` нет | В Draft #292: обычный Inbox /messages, fullscreen conversation overlay, AES-GCM AKEK Local-First encrypted drafts, 2-account E2E; 86/86 Chromium. Отправка/доставка/Matrix/E2EE chat/receipts/SAS/QR/Panic остаются BLOCKED |
| Settings / Dock / Profile | Settings/Appearance/поиск/Dock, desktop/mobile viewport E2E | В #292 opt-in шестая кнопка Messages, 320px geometry, Save/reload и реальный маршрут; физический телефон NOT TESTED; финальный Profile не принят |
| Notifications / Help | Isolated inbox / Help contracts и unit/UX artifacts | Реальный Notifications delivery/push и готовый Help route не подтверждены |
| Backup / Panic / DMS | Есть admission/cooldown primitives | Recovery Vault, restore, Emergency PIN, DMS, signed remote wipe BLOCKED |
| Admin / Analytics / Events | Изолированные RBAC/MFA, metadata-only telemetry/events contracts | Production MFA/UI/audit ingestion полностью не приняты |
| PWA / release security | Unsigned integrity tests, Composer audit после patch=0, security checks PASS | Independent signing trust anchor, signed activation, cold offline shell BLOCKED; native Safari NOT TESTED |

## Что делать дальше

1. **Не сливать Draft #292** и не изменять `main` без отдельного согласия владельца.
2. Для следующей функциональной задачи сверить `AGENTS.md`, `ts.md`, *текущие* open Issues и PR/changed files, выбрать свободную задачу со статусом `ready` либо документально разрешёнными зависимостями, оформить CLAIM и реализовать отдельным Draft PR с exact-head тестами.
3. **Не трактовать `backlog` как запрет на всю разработку:** #254 и #203 имеют конкретные нерешённые контракты; их нельзя тихо объявлять реализованными или принятыми. Matrix остаётся отдельной работой, не подключать автоматически.
4. Для всех оставшихся тестов указывать PASS / FAIL / NOT TESTED / BLOCKED и точный SHA; не приравнивать CI к релизу.

**Дисциплина:** `main` без запроса владельца не менять, merge/deploy не выполнять. Изменение этого документа внесено только в Draft #292 и **пока не содержится в `main`**.
