# PB3 — актуальная карта прогресса

> **P1-29B — независимый QA PASS в проверенном объёме.** Первоначальные дефекты зафиксированы в QA [#55](https://github.com/1troitsky/photobunker-v3/pull/55); исправления [#56](https://github.com/1troitsky/photobunker-v3/pull/56) и [#57](https://github.com/1troitsky/photobunker-v3/pull/57) повторно проверены независимым [#58](https://github.com/1troitsky/photobunker-v3/pull/58): **45/45 независимых инвариантов, 19/19 Chromium, CI 3/3** на #57 `65f0c1a`. Не означает автоматически merge или production security certification.

> **P1-29C — новая интегрированная ветка [Draft PR #59](https://github.com/1troitsky/photobunker-v3/pull/59)** поверх исправленного #57, с перенесённым v2 протоколом из исторического #54. Старый #54 не сливать как отдельный готовый PR. Подписанный epoch теперь содержит exact pending union v1/v2. Новый код требует независимого QA; **main не изменён; merge/deploy нет**.

**Обновлено:** 2026-11-10 · **актуальный блок:** P1-29C — epoch-scoped v2 invitations / consent / roster / freshness поверх независимо проверенного P1-29B.

> Source of truth: `AGENTS.md`, `ts.md`, текущий GitHub `main`/PR/CI. Прошлую карту P1-26 сохранили в [архиве](history/2026-11-10-P1-26-pre-merge-snapshot.md), чтобы её устаревшие формулировки не считались текущим статусом.

## Интегрированная база

- `main @ ee0cbe6836b5359e971319dfc8ae91ef695c7d42` — после независимого аудита и объединения ранее проверенного P1 до интеграции Teams.
- В рамках текущего блока `main` не менялся. **Merge и deploy не выполнялись.** Компоненты Teams пока доступны в **stacked Draft PRs**, а не в `main`.

## Текущая цепочка Teams

| Этап | PR / HEAD | Подтверждённое состояние |
|---|---|---|
| P1-27 — Teams owner, подписанный Team DEK и Local-First | [#50](https://github.com/1troitsky/photobunker-v3/pull/50) · `157909c9` | CI 3/3 PASS, Chromium 18/18 |
| P1-28 — подтверждённые приглашения, согласие, recipient ECDH | [#51](https://github.com/1troitsky/photobunker-v3/pull/51) · `b45028d` | CI 3/3 PASS, Chromium 19/19 |
| P1-29A — подписанные роли, исключение, запрет выдачи старого DEK | [#52](https://github.com/1troitsky/photobunker-v3/pull/52) · `70d6a1e` | CI 3/3 PASS после повторного Chromium 19/19; первоначальный сбой старого media E2E сохранён |
| P1-29B — новый Team DEK и signed epoch | [#53](https://github.com/1troitsky/photobunker-v3/pull/53) + [#56](https://github.com/1troitsky/photobunker-v3/pull/56) + [#57](https://github.com/1troitsky/photobunker-v3/pull/57) | **Независимый QA PASS** на #57: 45/45, 19/19 Chromium, 3/3 CI (в пределах проверенной модели) |
| P1-29B — QA evidence / исходные FAIL | [#55](https://github.com/1troitsky/photobunker-v3/pull/55) + [#58](https://github.com/1troitsky/photobunker-v3/pull/58) | Исходные ошибки сохранены; новые R07-01/02 исправлены в #57 |
| P1-29C — подписанные v2 invites/consent/rotations | [#59](https://github.com/1troitsky/photobunker-v3/pull/59) | Продуктовый Draft поверх #57; PostgreSQL/Garage/Chromium 19/19, PHPUnit 108/108, Vitest 147/147 на промежуточном HEAD; требуется независимый QA |
| P1-29C — старый несовместимый Draft | [#54](https://github.com/1troitsky/photobunker-v3/pull/54) | Только исторический источник, **не сливать отдельно**, функциональность перенесена в #59 |

### Реализовано в P1-29B

Новый случайный Team DEK, новая AEAD-шифротекстовая версия профиля, отдельный ECDH-envelope каждому **активному** участнику, проверка текущей подписанной ревизии/ключа/списка участников, атомарный PostgreSQL commit, подписанная цепочка эпох, encrypted outbox и Lost ACK replay. На стороне UI — подтверждение ротации, quarantine warning и чтение новой версии оставшимся участником. Полные инварианты: [P1-29B](../planning/P1-29B-TEAM-DEK-EPOCH-ROTATION.md).

### Не готово / ограничения

- P1-29B прошёл независимый QA **с исправлениями #57**, но ещё не интегрирован в main.
- P1-29C #59 реализует подписанные v2 invitations после epoch 1; точная единая owner-signed отмена pending v1+v2 при новом rekey, согласие получателя, повторное вступление исключённого участника, encrypted outbox и защищённую freshness-отметку на всех новых путях чтения. Автоматический CI не заменяет независимый security QA.
- Исторический HTTP 422 выдачи media grant: исходный intermittent FAIL сохранён, точная причина **OPEN**.
- Командное членство не предоставляет автоматически права на чужие задания, медиа, сообщения.
- Уже расшифрованное исключённым участником содержимое нельзя криптографически «забрать назад».
- Native iPhone/Safari/Android — NOT TESTED. Production миграции/locks — NOT TESTED. Trusted cold offline — BLOCKED BY DESIGN.

## Продуктовые модули — без искусственных процентов

| Модуль | Фактический статус |
|---|---|
| Identity / Recovery / E2EE / Local-First | Основные P0/P1 сценарии в `main`; дальнейший аудит и устройства нужны |
| Фото / видео / аудио, камера / GPS | Production-style browser/E2E контракты реализованы; physical/native не проверены |
| Задания / E2EE grants / retention | Базовые подписанные сценарии интегрированы, остаются расширения |
| Контакты / Teams | Контакты в `main`; Teams в #50–#59 Draft. P1-29B независимо проверен на #57; P1-29C в #59 CI подтверждён, QA ещё требуется |
| Browser / File viewer / редактор | Полный approved UX и производственный редактор не подтверждены |
| Matrix Messenger | Отдельный обязательный последующий блок |
| Security & Privacy / backups / Emergency | Целевая спецификация, полный безопасный runtime pipeline не подтверждён |
| Storage Manager / BYO S3 / backup replica | Garage E2EE-путь есть; BYO/replica/backup ещё впереди |
| Billing / Plans / Analytics / Administration | Дальнейшие обязательные фазы, не объявлять готовыми |
| Native PWA, deployment | Проверка физических устройств и release security gates впереди |

**Следующее:** независимо проверить P1-29C #59 (pending-v2 signed retirement, Lost ACK, genuine rollback, role/revoke/reinvite/epoch4, privacy), отдельно исследовать исторический media 422. После успешного полного QA — техническая интеграция стека #50→#53→#56→#57→#59 без повторного слияния исторического #54; main/deploy только по процедуре владельца.
