# PB3 — контрольная точка: P0/P1-интеграционный стек перенесён в main

**Дата:** 2026-11-10. **Зафиксированный SHA:** `ee0cbe6836b5359e971319dfc8ae91ef695c7d42`.

## Результат

Локальный агент объединил проверенный стек через PR #48 (защита rollback) → PR #46 (совмещение Contacts P1-26 и assignment-scoped grants v2) → `main`. Изменения параллельной PR #45 вошли в #46 один раз; не требуется отдельный merge #45. На финальном `main` устранена гонка загрузки инструкций камеры и добавлены шесть регрессионных тестов.

## Принятый уровень доказательств, не релизная приёмка

- `main` exact SHA `ee0cbe6836b5359e971319dfc8ae91ef695c7d42`: GitHub Actions **3/3 PASS**.
- PHP8.4 и PHP8.5: **82 tests / 1383 assertions** каждая; Vitest **116/116**, TS/build PASS, Chromium E2E **17/17**, PostgreSQL18/Garage2.5 PASS.
- Независимый [аудит через PR #47](https://github.com/1troitsky/photobunker-v3/pull/47) относился к **предынтеграционному scope #46**; при merge/фиксе final `main` перепроверен полным CI. Это не новая независимая криптографическая приёмка изменённого `main`.
- Deploy не выполнялся. Native iOS/Safari/Android, trusted cold offline, production migration locks/load и полноценный downgrade остаются не проверены.

## Следующее

Перейти к People & Teams с настоящими server-authoritative ACL/roles, не выдавая медиа-грантов автоматически. Разработку вести в Draft PR от текущего `main` с версионированными E2EE-протоколами. Актуальная карта: [`docs/status/CURRENT.md`](../CURRENT.md).
