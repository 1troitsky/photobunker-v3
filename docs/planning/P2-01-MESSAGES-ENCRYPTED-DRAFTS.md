# P2-01 — Messages 1.1 in PB3: encrypted drafts + accepted overlay

**Дата:** 2026-11-11. **База:** `main @ 2c8ad9f6f18da9e87797d8df2cc0d6c3cf4eb7a6`.
**Реализация:** [Draft PR #64](https://github.com/1troitsky/photobunker-v3/pull/64) (не слит).
**Нормативный scope:** `ts.md` §16, §22/§P2. Источник UX: [PB2 owner-accepted Fieldwork Messages 1.1](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/messages/README.md). Исторический HTML/JS не переносить без пересмотра security, он содержит фиктивные данные.

## Что реально работает в P2-01

- Шестой пункт Dock и рабочий `/messages` внутри Fieldwork Shell. Основной список не размонтируется при открытии; диалог — **полноэкранный modal overlay**, не отдельная route/page, на mobile и desktop. Экран переписки `#101210`; будущие bubbles обязаны использовать входящие `#272927`, исходящие `#315640`, вертикальный gap ~19px. Enter/Escape/focus/reduced-motion обрабатывать на уровне приложения.
- «Написать» выбирает только реально подтверждённого локального контакта с актуальным pinned fingerprint, без поддельных Matrix-пользователей или комнат. В списке отображаются только действительные **локальные черновики**. Фильтры unread/teams честно пустые до реализации Matrix.
- Текст черновика **никогда не уходит в сеть**. Отдельный IndexedDB `pb3-encrypted-messages-drafts-v1` с SHA-256 hashed ownerScope + account/peer row key; record AKEK AES-256-GCM + IV и authenticated AAD, проверка peer fingerprint при чтении, ограничение 4096 символов, независимая локальная очередь записей для последовательной правки, сброс decrypted state на lock/account/key revision change. Для стёртого черновика удалить indexed ciphertext, не выдавать это за удаление Matrix-сообщений.
- Отправка, вложения, криптографический статус устройств, badges и доставленность **отключены и честно обозначены как не подключённые**. На сервере нет новых Matrix-related credentials/ACL и даже Matrix homeserver не выбран. Ни одна кнопка не создаёт видимость успешной отправки.
- Нет Matrix access token в localStorage, IndexedDB drafts или Laravel. Протокол Team membership НЕ предоставляет автоматически Matrix room membership, даже при наличии verified Team DEK.

## Задача следующего вертикального этапа: P2-02 Matrix E2EE transport

Не повторять абстрактный «макет»: строить реальный путь **owner A → verified contact B → Matrix room → E2EE send/sync → recipient B decrypt → reload/offline/retry**. Особенности:

1. Выбрать Matrix homeserver/dev-login policy и `MatrixMessagingAdapter` versioned transport. Для браузера использовать поддерживаемый `matrix-js-sdk` с **Rust Crypto WASM** и сохранённым encrypted crypto store; старые `initCrypto`/Chatify/ручные самодельные Megolm/Olm исключить. Pin SDK и lockfile одновременно; сверить актуальные API перед кодом. Документация SDK: https://matrix-org.github.io/matrix-js-sdk/ .
2. Отдельный Matrix login/binding должен быть криптографически привязан к реальному PB3 key-only account/device и подтверждённому peer/Team ACL, а не к строке alias. Токен и Matrix key material шифровать на устройстве; обойтись без второго независимого пароля восстановления для владельца. Восстановление device crypto по PB3 Recovery Key требует отдельного проверенного конверта и cross-signing/key backup.
3. До отправки требовать `m.room.encryption` и проверенные устройства; stop/fail-closed при downgrade криптосостояния и после изменения pinned identity. Никогда не позволять UI изменить `sent` по click без Matrix ACK. `txnId` сохранять до POST, дублировать при Lost ACK, после sync выполнять дедупликацию, управлять offline outbox и read receipts.
4. Rust crypto **не потокобезопасен для двух MatrixClient на одном IndexedDB**: выделить single-owner lifecycle / вкладочную блокировку и корректный logout/Panic wipe. Matrix outage не блокирует Camera/Identity/Assignments/Browser, их процесс запуска остаётся независимым. Matrix server account и токен должны быть проверены по scope, нет silent cross-account reuse.
5. Room list, message timeline, threads, drafts и attachments не смешивать с чистыми прототипами. Для team room реальные Matrix member events/ACL отдельно от подписанного Team snapshot; запрещать неявную выдачу media DEK и EXIF/GPS через attachment.
6. Реальный end-to-end gate: 2 аккаунта/устройства, 1:1 + team room, text/media, ciphertext evidence, reload/close/open, offline/reconnect, edit/redact, member revoke and key rotation, recovery on new device. Non-production targets/keys; sanitized evidence без access tokens/keys.

**Следующий этап P2-03:** применение принятых UX для настоящих Matrix room list/timeline (без фиктивных unread), диалогов, доставленных сообщений, типов вложений и матрицы разрешений. Рабочий настоящий transport — условие включения кнопки «Отправить».

## Проверка P2-01

- Vitest: IndexedDB ciphertext без plaintext/body/account/peer/fingerprint, account segregation, signed-peer scope, key-change fail-closed, serial edits/delete, tamper rejection.
- Chromium E2E: настоящие два PB3 аккаунта, один independently fingerprint-confirmed контакт, открытый fullscreen modal, кнопки отправки disabled, текст сохраняется в AES-GCM store, reload/offline/online, другой аккаунт не видит черновик, Escape возвращает фокус, пустой draft удаляется.
- CI: PHP 8.4/8.5, TypeScript/build, Vitest, PostgreSQL18/Garage2.5 и полный Chromium. На exact HEAD PR результаты фиксировать после завершения Actions.
- **NOT TESTED / не завершено P2-01:** Matrix E2EE/send/sync/crypto backup, native iOS/Android, clipboard/screenshot mitigation, Safari IME/focus on-device, 2+ concurrent clients, production Matrix server and Unlimited+ homeserver entitlement. Не объявлять Messenger завершённым.

## Важные правила

Отдельный Draft PR от актуального main; **не изменять main и не выполнять deploy**, если owner не поручил это явно. Локального агента привлекать только к действительно блокирующему решению или разрешённой интеграции; рутинные проверки не превращать в новый независимый аудит.
