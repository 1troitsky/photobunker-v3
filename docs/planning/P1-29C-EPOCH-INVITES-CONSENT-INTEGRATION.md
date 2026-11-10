# P1-29C — v2 Epoch-Scoped Team Invitations / Consent / Freshness

Дата: 2026-11-10. Репозиторий: `1troitsky/photobunker-v3`.
**Продуктовая интеграция:** [Draft #59](https://github.com/1troitsky/photobunker-v3/pull/59), **база** independently audited [#57](https://github.com/1troitsky/photobunker-v3/pull/57) @ `65f0c1a27a342ebfe5044ee1af7bb8cad27738ed`. Исторический [#54](https://github.com/1troitsky/photobunker-v3/pull/54) — код-первоначальный источник, НЕ самостоятельная ветка для merge. Аудит P1-29B: [#58](https://github.com/1troitsky/photobunker-v3/pull/58).

## Протокол и граница доверия

- Owner создаёт `pb3.team-invite.v2\n`: ECDH P-256 ephemeral + HKDF + AES-256-GCM под **текущий** Team DEK, привязанный к immutable root hash, signed key epoch hash, текущим membershipRevision, invite/operation IDs, target account, pinned recipient key digest, role, expiry и `fileAccess:none`. Приватное имя команды и DEK не передаются открыто.
- Recipient должен подтвердить fingerprint владельца и текущую directory key, локально расшифровать envelope и создать отдельный `pb3.team-accept.v2\n` со своим ключом. Server CAS под team lock проверяет принятие только в текущей эпохе и ревизии, допускает exact Lost ACK replay, но не повторную подпись другого operation.
- Владелец/участники имеют отдельные v1/v2 исторические ledgers. Переход к новой эпохе автоматически делает исторические pending ECDH envelopes недоступными; server inbox отдаёт только key-free revoked/suspended/superseded notices. Текущая выдача DEK требует live ACL + pinned owner + строго проверенную signed epoch chain.
- Новая ротация содержит один **обязательный** `retiredPendingInviteIds`, который подписывает **отсортированное точное объединение pending v1 и v2 IDs** (max 500, без дублей). Сервер проверяет его против обеих таблиц в одной PostgreSQL-транзакции под тем же Team row lock, затем отзывает соответствующие строки. Никаких unsigned v2 sweep. Владелец принимает `revoked` без отдельного signed remove только при доказанном членстве invite ID в полной owner-signed chain.
- Любой новый verified member view (прямой v2 invite, v1 survivor и current-epoch member) проходит early floor check owner/epoch/hash. После успешного signed chain, ECDH и расшифровки записывается `keyEpoch / signed contractHash / verified membershipRevision` вместе с private joined view **в одной Dexie read-write транзакции**, AES-GCM под AKEK и hashed row scope. Неподписанная HTTP `membershipRevision` не повышает durable floor. Downgrade / same-epoch fork / revision rollback должны падать, не уничтожая зашифрованный offline snapshot.
- P1-29C не выдаёт новых file/photo/media/assignment grants при Team membership. Старый plaintext/DEK у исключённых участников физически не удаляется; recovery на новом устройстве и полный device/cache rollback требуют отдельного trusted anchor.

## Сценарии, которые нельзя обходить

1. Owner A, members B/C, pending D v1; B revoked → epoch2 signed retirement D → C still decrypts; next exclusion C → epoch3; offline cache не потерян.
2. B снова получает **v2** invite epoch3, подписывает consent, расшифровывает текущий профиль. Owner меняет роль B, B повторно читает signed current epoch без ложного revision rollback.
3. A создаёт D pending v2, исключает B, публикует epoch4 с D ID в подписанном retirement union; owner roster остаётся управляемым, D не получает прошлый ECDH, accepted/revoked evidence сохраняются.
4. Отсутствующий/лишний/чужой/дублированный ID pending v2 → 409/422 до commit; unsigned changes → 401; forged role/key/consent/hash/revision → fail closed. Конкурирующий consent/rotation должен линейно сериализоваться.
5. Genuine historical epoch1/epoch2 response после verified newer epoch, signed role replay/fork и неподписанная inflation → отклонение без перезаписи durable floor; полная перезагрузка и две вкладки.
6. Lost ACK / reload / exact signed bytes replay для invitation, consent, mutation и epoch rotation; журнал и local outbox не должны содержать plaintext; старые migration guards не удаляют signed ledgers.

## Проверки и незакрытые границы

Обязательны PHP 8.4/8.5, PostgreSQL18/Garage2.5 smoke, Vitest/strict TypeScript/build, Chromium E2E, отдельный **независимый security/integration QA** и отчет в `docs/audits/`. Все результаты указывать с точным HEAD.

**Не завершено автоматически:** нативный Safari/iPhone/Android; production migration locks, overlapping PG tx; независимый anti-rollback trust anchor; полный forensic scan; точная причина исторического intermittently failed media grants HTTP 422. Продуктовый PR остаётся Draft до QA PASS; main, merge и deploy не изменяются.
