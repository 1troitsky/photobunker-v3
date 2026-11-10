# P1-29B — закрытие замечаний независимого аудита

**Аудит:** [PR #55](https://github.com/1troitsky/photobunker-v3/pull/55), источник [P1-29B-TEAM-CRYPTO-INTEGRATION-AUDIT.md](https://github.com/1troitsky/photobunker-v3/blob/qa/p1-29b-team-crypto-audit/docs/audits/P1-29B-TEAM-CRYPTO-INTEGRATION-AUDIT.md). Аудированный продуктовый HEAD: `03bcc0880521ebcc9145f134233d39be6a339c2c`. Результат **FAIL**, два воспроизводимых дефекта T29B-01/T29B-02. Исправления — [Draft PR #56](https://github.com/1troitsky/photobunker-v3/pull/56), отдельная ветка поверх #53. QA-only PR #55 и его исходные красные evidence не изменяются.

## T29B-01 — подписанная отмена ожиданий при ротации

**Было:** сервер атомарно отзывал все pending v1 invitations, но проверка owner roster имела основание отзыва только в `team_membership_events_v1`. Принцип fail-closed блокировал последующее управление командой.

**Стало:** владелец включает в канонический P-256 signed `pb3.team-key-epoch.v1` полный **сортированный, уникальный** массив `retiredPendingInviteIds` (0–500 UUID). Сервер **под тем же Team row lock и в той же PostgreSQL-транзакции** сверяет подписанный набор с точным набором текущих pending invitations до вставки эпохи/отзыва. Несоответствие → 409, повтор UUID/несортированный/невалидный → 422. В старую epoch-цепочку нельзя незаметно добавить событие: хэш каждого контракта прикреплён к предыдущей подписанной эпохе. Клиент владельца, встретив `revoked` без owner-signed membership removal, принимает его **только** при совпадении invite UUID с доказанным полным signed epoch history и при отсутствии принятого signed consent. Одного флага `state=revoked` недостаточно.

Сценарий: A/B/C + pending D; A исключает B и ротирует на C; D отзывается при signed epoch2; A читает roster, затем исключает C и ротирует epoch3. Нет автоматической выдачи file/media/assignment grants. Lost ACK повторяет прежний полный signed contract.

**Совместимость:** формат signed epoch v1 расширен обязательным полем до merge (в `main` ещё не существует). Старые тестовые заготовки/QA harness, вручную создающие signed epoch v1, должны включать это поле и проверить конфликт при несовпадении, **не ослабляя** assertions. Существующие реальные signed epochs не переписываются. Stacked P1-29C #54 содержит отдельную v2 таблицу invitations; перед будущим merge понадобится отдельное согласование подписанного pending sweep для v2, без устаревших ECDH envelopes.

## T29B-02 — локальный anti-rollback уже проверенной эпохи

**Было:** после получения genuine epoch2 клиент мог получить повтор genuine signed epoch1 от malicious/rolled-back origin и записать `verifiedOnline=true` на старом снимке.

**Стало:** в Dexie `pb3-encrypted-team-members-v1` добавлен (upgrade v2, без удаления старых записей) приватный object store `freshness`. В hashed account+team keyed записи AES-256-GCM под AKEK, с AEAD AAD account/row scope, сохраняются: ownerAccountId, teamId, максимальная проверенная `keyEpoch`, `contractHash`, `membershipRevision`. Файл/индексы не содержат открытого идентификатора команды, роли или epoch/contractHash. Перед дешифрованием уже известной старой эпохи проверяется сохранённый минимум. После **успешной криптографической проверки/дешифрования**, обновление `freshness` и encrypted `joined` snapshot происходит в **одной read-write IndexedDB транзакции**. Между конкурентными вкладками не допускается понижение epoch, same-epoch fork или снижение membershipRevision. Старый офлайн-снимок при отказе не удаляется. Same-account replay реально проверяется после reload/двух запросов.

**Границы защиты:** это локальная защита повторного ответа *на устройстве с сохранённым IndexedDB/AKЕK*, а не универсальный anti-rollback при полном откате storage/device или замене недоверенного JS того же origin. Независимый monotonic/freshness trust anchor остаётся отдельной архитектурной задачей. Вкладка другого аккаунта не получает приватную отметку первого.

## Критерии повторной приёмки

- PHPUnit: подписанный exact retirement, неподписанная/ошибочная/дублирующая подмена и Lost ACK; неверный набор не меняет состояние БД.
- Vitest: AEAD ciphertext, rollback 2→1, same-epoch fork, revision rollback, concurrent tab writes, account isolation.
- Chromium с реальными PostgreSQL/Garage: pending D, epoch2, owner roster, next C removal, epoch3; hostile origin возвращает подлинный старый v1 response после принятого epoch2, клиент отвергает и сохраняет новый snapshot.
- Проверить строгое PHP 8.4/8.5, TypeScript/build, полный Chromium; зафиксировать точный SHA и оригинальные красные результаты.
- Независимый QA **снова** запускает воспроизводящие проверки PR #55 против исправленного HEAD; отдельная проверка нестабильных старых media E2E; native Safari/iOS/Android, production locks и холодный trusted offline — по-прежнему непроверенные.
- **Никакого merge/deploy до независимого PASS**. PR #54 нельзя считать принятым от наличия реализации v2 или зелёного CI.
