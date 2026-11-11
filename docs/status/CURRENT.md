# PB3 — актуальный прогресс и интеграционный checkpoint

## Актуальный checkpoint · P2 Matrix Messenger · 11 ноября 2026

**Подтверждённый `main`:** `a8abcc55e73ea0a2d8be3a24052f814906b8bd1d` (Teams интегрирован через #62; старый раздел P1 ниже сохранён как историческое свидетельство, а не как инструкция повторного merge).

**Разработка Matrix остаётся НЕ В MAIN и НЕ ПРИНЯТА в production.** Текущая зависимая Draft-цепочка от `main`: #64 → #66 → #67 → #68 → #69 → #70 → #71 → #72 → **[#73](https://github.com/1troitsky/photobunker-v3/pull/73)**. Эти PR нужно интегрировать только после отдельного согласования и проверки фактического dependency graph; прямой merge вершины без учёта баз запрещён.

| Matrix-подмодуль | Фактически реализовано | Проверено / статус |
|---|---|---|
| Messages 1.1 | Полноэкранный overlay поверх Fieldwork, AKEK-зашифрованные локальные черновики, защита закрытия при ошибке записи | #64/#66 Draft; Chromium |
| Matrix key-only binding | Подписи PB3 аккаунта + устройства, server-pinned HTTPS Matrix whoami, не сохраняем access token в Laravel; локальный sealed token / Lost ACK | #68 Draft; PHP+Vitest |
| RustCrypto | `matrix-js-sdk@44.0.0`, зашифрованный Rust IndexedDB, Web Locks single-writer, fail-closed `OnlySignedDevicesIsolationMode` | #69/#73 Draft; Vitest + две вкладки Chromium |
| Протокол E2EE | Два disposable Matrix-аккаунта, настоящий Synapse Megolm ciphertext → реальная расшифровка у получателя, повтор txnId и приватность без токена | #70 Draft; CI real Synapse PASS |
| PB3 Recovery Key → Matrix 4S | Root-signed immutable AKEK-sealed seed escrow, новый PB3-сеанс восстанавливает seed до Matrix-токена; SDK проверяет текущие Matrix key ID и MAC перед выдачей ключа | #71/#73 Draft; PHP+Vitest; единый production-путь ещё не E2E |
| Identity/Contact trust | Подписанные PB3↔MXID карточки, отдельное подтверждение safety number, зашифрованный pin; fail-closed Matrix cross-signing/Ed25519/all-devices check, без ложной авторизации отправки | #72/#73 Draft; Vitest |
| Действительная 4S/key backup | Disposable Synapse v1.161 + RustCrypto 44: исходный cross-signing root восстановлен на новом устройстве, импорт Megolm-сессий, неверный 4S отклоняется; усиленный тест проверяет исходный ciphertext на новом устройстве без живого gossip | #73 Draft; real-Synapse тест (результат точного HEAD сверять с CI) |

**Границы готовности:** пользовательская отправка **выключена**; нет production key-only Matrix provisioning/настроенного homeserver, полного доверенного SAS/QR, cross-device verified membership/ACL, Local-First outbox/ACK для реальной переписки, вложений, Panic/revoke и единого браузерного E2E `PB3 Recovery Key → server Matrix 4S → decrypt`. Native Safari/iPhone/Android — **не проверены**. Процент готовности Messenger **не оценён**, пока нет подтверждённого перечня всех сквозных критериев. Зелёный CI ≠ принятие владельцем.

**Доказательства:** [План P2-02D3](../planning/P2-02D3-MATRIX-VERIFIED-DEVICES.md), [Draft #73](https://github.com/1troitsky/photobunker-v3/pull/73); [реальный Synapse CI с историческим E2EE restore](https://github.com/1troitsky/photobunker-v3/actions/runs/42932785610) — PASS на `b8ee8dd17fef37ba73fc681b981bb7eb23772c6c`. Итоговый SHA после документирования требует собственной проверки CI.

**Следующее:** сначала сохранить текущую длинную Draft-цепочку без merge, провести P2-02D независимую проверку безопасности интеграции, затем P2-02E — принятый Messages UI → реальная проверка Matrix peer device/room ACL → зашифрованный durable outbox и передача E2EE текста/вложения на двух независимых устройствах. Перед первым merge требуется согласованный порядок и отдельное разрешение.

---

## Исторический checkpoint Teams (до merge #62; НЕ текущая инструкция)

**Дата:** 2026-11-11. **Source of truth:** `AGENTS.md`, `ts.md`, Github commits/PR/CI.

## Интеграционный рубеж Teams: P1-27 → P1-29C

**База до интеграции:** `main @ ee0cbe6836b5359e971319dfc8ae91ef695c7d42`.
**Проверенная кандидатная версия:** `54f984162451e44e49d374ba5c08cb3a2b7a0536`, [продуктовый Draft #60](https://github.com/1troitsky/photobunker-v3/pull/60).
**Единый PR для технической интеграции:** [Draft #62](https://github.com/1troitsky/photobunker-v3/pull/62) (эта ветка; до подтверждённого merge `main` не считать обновлённым).

**Включить ровно один раз:** #50 → #51 → #52 → #53 → #56 → #57 → #59 → #60. Старый #54 — несовместимый исторический источник v2, **не сливать**. QA-only PR #55/#58/#61 — независимые исходные проверки и evidence; их код не смешивать с продуктовой цепочкой автоматически.

| Компонент | Проверенный результат на #60 |
|---|---|
| Teams owner / encrypted local state | P1-27 — подписанный Team DEK; локальный шифрованный outbox |
| Signed invites / explicit consent | P1-28/P1-29C — v1/v2, pinning/ECDH/AAД, повторное приглашение в новой эпохе |
| Authoritative roles / removals / quarantine | P1-29A — owner-signed membership receipt, server ACL |
| Team DEK rotation / signed pending retirement | P1-29B/P1-29C — fresh DEK + signed epochs, exact union pending v1+v2 under row lock |
| Freshness / rollback and role receipt | #57/#60 — AEAD sealed monotonic floor и signed revision, invite-id scoped role receipts |

**Независимый аудит:** [#61](https://github.com/1troitsky/photobunker-v3/pull/61), [полный отчёт](../audits/P1-29C-INDEPENDENT-INTEGRATION-AUDIT.md). Исходный #59 **FAIL 72/74**, исправленный #60 **PASS 74/74**. PHPUnit PHP8.4 и 8.5 **109/109, 1807 assertions**, Vitest **151/151**, Chromium **19/19**, реальные PG18/Garage2.5, CI **3/3 PASS на точном #60 SHA**. Отчёт отдельно фиксирует реальные параллельные PG row-lock waiters, signed retirement v1/v2, rollback/fork/role replay и отсутствие неявных media/assignment grants.

**После любого интеграционного документационного коммита:** повторить CI на точном HEAD интеграционного PR; локальный QA 74/74 относится к **неизменённому продуктовому коду** от #60, не переименовывать его в QA нового коммита.

## Ограничения, не блокирующие дальнейшую разработку

- Исторический media-grant **HTTP422 — OPEN**: воспроизведена чувствительность к точной границе client/server clock (±3 мс), но нет доказательства фактической причины исторического отказа. Требует отдельного точечного исправления time-authority, без широкого повторного аудита Teams.
- Native Safari/iPhone/Android, реальные background PWA ограничения и production migration locks/load — **NOT TESTED**.
- Полный device/IndexedDB rollback, compromise same-origin JS и независимый trust anchor — **BLOCKED BY DESIGN / не решено**.
- Server не читает Team DEK и зашифрованный профиль. Публичные технические UUID серверных ledgers допустимы по `ts.md`. Team membership **не** выдаёт автоматически права на чужие фото, задания, медиа, сообщения.
- Уже полученный ранее plaintext у исключённого участника невозможно отозвать криптографически.

## Продуктовая дорожная карта — фактически, без искусственных процентов

| Модуль | Текущий статус |
|---|---|
| Identity / Recovery / E2EE / Local-First | Основные P0/P1 сценарии в `main`; физические устройства и release gates впереди |
| Camera / Photo / Video / Audio / GPS | Browser-style реализации и регрессии есть; native не подтверждён |
| Assignments / encrypted media / retention | Базовые signed grants реализованы, media422 OPEN |
| Contacts / Teams | Contacts в `main`; полный Teams стек в кандидате интеграции #62 (не говорить «в main» до merge) |
| Browser / viewer / редакторы | Полный утверждённый UX и production editor не подтверждены |
| Matrix Messenger | Следующий отдельный обязательный крупный блок |
| Security & Privacy / backups / emergency | Требуются полноценные runtime сценарии и восстановление |
| Storage Manager / BYO S3 / replica | Garage-путь есть; BYO/replica и backup впереди |
| Billing / tariffs / Admin / Analytics | Дальнейшие обязательные этапы |
| Native PWA / deployment | Физические устройства и release security gates впереди |

**Следующая критическая операция:** интегрировать одну проверенную продуктовую голову #60 через #62 в `main`, при совпадении ожидаемой базы и PASS CI на точном интеграционном коммите. Без нового security-аудита. **Затем:** разрабатывать дальше от нового `main`; исторический media422 исправить отдельной узкой задачей самостоятельно, локального агента на это не расходовать.
