# PB3 · 2026-11-11 · P2 Matrix trust / real recovery checkpoint

**Фактический `main`:** `a8abcc55e73ea0a2d8be3a24052f814906b8bd1d`. **Общий предок Matrix-ветки и `main`:** `2c8ad9f6` (сравнение: 96 commits впереди и 1 документационный commit позади). Reconciliation перед merge НЕ выполнен. Все Matrix-изменения пока в **зависимой Draft-цепочке** #64 → #66 → #67 → #68 → #69 → #70 → #71 → #72 → #73. Не merge/deploy.

## Что доказано

1. Реальный `matrix-js-sdk@44.0.0` Rust Crypto + disposable Synapse v1.161, Alice→Bob `m.room.encrypted`, самостоятельная расшифровка у Bob, отсутствие текста на homeserver, idempotent повтор точного encrypted `txnId`, HTTP401 без bearer. Источник: #70; real CI.
2. PB3: root/device-signed Matrix `/whoami`, device-scoped AKEK-encrypted token vault, durable Lost ACK. Browser RustCrypto store шифруется отдельным HKDF(AKEK), Web Locks single writer, Shell не ждёт Matrix. Документы P2-02A/B.
3. Recovery: signed immutable AES-GCM escrow 32-byte Matrix 4S seed, независимый PB3 Recovery Key login раскрывает seed на втором PB3-устройстве *без* наличия нового Matrix access token. Новый SDK callback выдаёт seed **только после проверки текущего Matrix keyId и MAC**, без ротации. P2-02D1/D3.
4. Обмен контактами: PB3-root-signed PB3↔MXID card, owner-confirmed P1 safety fingerprint, local encrypted pin; отдельно SDK сверяет действительную cross-signing trust цепочку и устройство Ed25519 (все устройства проверены, локальный флаг verified недостаточен). RustCrypto шифрование ограничено `OnlySignedDevicesIsolationMode`. P2-02D2/D3.
5. Disposable Matrix key recovery: на реальном Synapse cross-signing root создан, серверный 4S и Megolm backup включены, вновь вошедшее независимое Matrix-устройство импортирует тот же исходный master root, получает старые Megolm sessions и отвергает неверный ключ. Усиленный сценарий останавливает оба предыдущих клиента и проверяет расшифровку конкретного старого события — исключая онлайн-госсип. [Реальный CI PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/42932785610) на `b8ee8dd17fef37ba73fc681b981bb7eb23772c6c`.

## Что НЕ подтверждено и остаётся обязательным

- Никаких реальных пользовательских Matrix-токенов в app flows: не готово key-only provisioning от PB3 Recovery Key, поставщик homeserver production и подтверждение владения Matrix Ed25519 независимо от PB3 подписи в accepted UI.
- Не проверен объединённый реальный браузерный путь PB3 Recovery Key → SSSS escrow Laravel → Matrix 4S → historical decrypt: отдельные браузерные/серверные/Matrix тесты НЕ заменяют эту интеграцию.
- Нет Matrix membership связанного с PB3 ACL, сквозного E2EE Outbox, offline/reconnect, idempotent delivery/read, E2EE media attachment, PIN/Panic Matrix credential revoke и физического Safari/iOS/Android QA.
- Пользовательский **Send остаётся disabled**. Ни один зелёный тест не означает production-ready Messenger.
- P2-02D3 тесты являются security gate, однако не заменяют независимый crypto/ACL audit перед первым merge длинной цепочки.

## Следующий контроль

Сохранить текущую Draft-цепочку и пройти проверку SHA CI текущего PR #73. Далее P2-02E — один вертикальный сценарий: PB3 Contact trust → Matrix verified devices → bound encrypted room → Local-First pending/outbox → real E2EE A→B ACK/sync, offline/reload. Перед разрешённым merge заново сверить DAG, миграции, фичефлаги и независимый QA.

**Расположение текущей общей карты:** `docs/status/CURRENT.md`; это единственный живой статус. Этот файл — исторический checkpoint без процентов и повторного дублирования карты.
