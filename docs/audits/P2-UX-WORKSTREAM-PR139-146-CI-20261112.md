# PB3 — журнал функциональных PR и проверки UX-интеграции (12 ноября 2026)

**Назначение:** один проверяемый документ для владельца и обоих параллельных потоков разработки. Это не разрешение на merge. Состояния и коммиты зафиксированы на 2026-11-12, более поздние PR проверять заново. Исходники: GitHub PR/diffs, GitHub Actions и журналы двух browser jobs. **Не выдавать независимые успешные CI отдельных PR за общий успешный CI их объединённого стека.**

## 1. Что делают PR #139, #140, #141 и #143

| PR | Проверенный HEAD | На самом деле сделано | Верификация этого HEAD |
|---|---|---|---|
| [#139 — V-41](https://github.com/1troitsky/photobunker-v3/pull/139) | `82c8b1e2568f89d8bfe5e68decba91956f49afa1` | Реальный фиксированный Viewer 1.0 для фото/видео/аудио: геометрия сцены, локальные sheets «Информация» и «Редактировать», Back к Browser, без подмены E2EE. **Не** полный File Viewer 1.0 | [Build/PHP PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43147489397), [Security PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43147489394), [PG18/Garage/Chromium 48/48 PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43147489357) |
| [#140 — V-42](https://github.com/1troitsky/photobunker-v3/pull/140) | `17b0e47887cc91f2d361a815ba02e81077de2cce` | Viewer стрелки/свайпы используют replace, не накапливают историю; Back возвращает в папку/фильтр Browser | [Build/PHP PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43147497019), [Security PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43147496871), [PG18/Garage/Chromium 48/48 PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43147496735) |
| [#141 — V-43](https://github.com/1troitsky/photobunker-v3/pull/141) | `2e40c7097ac0fcad477302b56df1f59a1541369d` | Один общий Shell Header для Viewer: избранное/копирование/скачивание/удаление; **настоящая операция только у Download**, остальные три заблокированы до проверки контрактов; plaintext/ключи не попадают в Shell | [Build/PHP PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43148641343), [Security PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43148641440), [PG18/Garage/Chromium 48/48 PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43148641354). Для PHP8.4 использовался отдельный повтор упавшего теста, итог PASS |
| [#143 — V-44](https://github.com/1troitsky/photobunker-v3/pull/143) | `7efbe1dbe1d0a64d82041695eb6ae8d200ca796b` | **Только документация**: аудит существующего E2EE сохранения JPEG/WAV/стоп-кадра, недостающих Photo Editor 3.2 / AV Editor 1.1, требований и параллельного владения файлами. **Не новый код редактора** | [Security PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43150078296), [Build/PHP PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43150078451), [PG18/Garage/Chromium PASS](https://github.com/1troitsky/photobunker-v3/actions/runs/43150078280); это тесты **унаследованного продукта**, не реализации новых UX из #143 |

**Исходные документы:**
- [V-41 Viewer сцена](../planning/P2-V41-FILE-VIEWER-FIXED-SCENE.md);
- [V-42 история](../planning/P2-V42-VIEWER-REPLACE-HISTORY.md);
- [V-43 Header](../planning/P2-V43-VIEWER-SHARED-SHELL-ACTIONS.md);
- [V-44 preflight редактора](../planning/P2-V44-EDITOR-INTEGRATION-PREFLIGHT.md).

**Важно о ссылках:** эти четыре технических файла находятся в **продуктовом стеке PR #139–#143**, унаследованном веткой #146. Исходные UX-копии и визуальная карта `docs/ux-integration/` живут в отдельном Draft #138; их нельзя автоматически считать частью продуктового HEAD.

## 2. Незакрытое расхождение #139 / #140

| Параметр | Значение |
|---|---|
| Актуальный #139 | `82c8b1e2568f89d8bfe5e68decba91956f49afa1` |
| Коммит #139, от которого начат #140 | `13286fc272ad4fe9dfc9e0a869847fb3be948715` |
| #140 HEAD | `17b0e47887cc91f2d361a815ba02e81077de2cce` |
| Проверенный GitHub merge-base | `13286fc272ad4fe9dfc9e0a869847fb3be948715` |
| GitHub compare: #139-current → #140 | **DIVERGED: ahead 5, behind 2** |

**Пересечение:** `apps/web/src/views/FileViewerView.vue` и `tests/e2e/p2-browser-safe-recipient.spec.ts`. Два более поздних коммита #139 **не входят** автоматически в #140 и его потомков #141/#143/#144/#145. Даже если Git разрешит текстовый merge, поведенческая совместимость нуждается в проверке.

**Перед любым merge в main:** владелец продуктового стека обязан выбрать одну актуальную ветку, интегрировать отсутствующие коррекции #139 в потомка (не подменяя проверенную навигацию), просмотреть итоговый diff и получить новый совместный зелёный CI. **НЕ** сливать пачку PR по отдельности только потому, что у каждого был PASS.

## 3. Прогон #146 — реальный Settings hub (честный результат)

**PR:** [#146](https://github.com/1troitsky/photobunker-v3/pull/146), интеграция Settings Fieldwork; база #145 `d62c4cae599b5e3c3de300f808242566f3ee124a`. Точный проверенный HEAD **`fbb233678e71a31121c3b7ced9e3f93da09f61a3`**.

**Содержимое PR:** `AccountView.vue` показывает группы настроек только для авторизованной сессии; `/contacts` — единственная реально подключённая страница через меню; Key-Only регистрация, восстановление/Recovery Key и выход **не изменены**. Неизвестные пункты помечены «Позже», без фальшивых ссылок. Добавлен Vitest на маршруты и Playwright с настоящим созданием аккаунта → переходом в контакты → возвратом → выходом. В `tests/playwright.config.ts` сознательно добавлена маска `p2-settings-*.spec.ts`, иначе **первоначальный прогон на `4c77a1cf` вообще не включал новый тест** (его прежние 50/50 нельзя считать UX acceptance).

### CI с реальным тестом — 2 попытки, один HEAD

| Проверка | Результат / evidence |
|---|---|
| PHP8.4/8.5 + Vue TypeScript/build + Vitest | **PASS** · [43157162886](https://github.com/1troitsky/photobunker-v3/actions/runs/43157162886) |
| Security floor | **PASS** · [43157162898](https://github.com/1troitsky/photobunker-v3/actions/runs/43157162898) |
| PostgreSQL18/Garage/Chromium, первая попытка | **FAIL, 50 PASS / 1 FAIL** · [43157162890](https://github.com/1troitsky/photobunker-v3/actions/runs/43157162890), job `130979657809`. Прежний Browser/Viewer test: Playwright `getByRole('status')` совпал с **двумя** элементами (`file-viewer-wait`), ожидался текст «Ранее проверенные файлы и курсоры сохранены.»; строгий селектор не уникален. |
| Повтор **только упавшего** job | **FAIL, 50 PASS / 1 FAIL** · тот же [run 43157162890](https://github.com/1troitsky/photobunker-v3/actions/runs/43157162890), job `130981334123`. Упал уже **другой** ранее существующий `tests/e2e/p1-assignment-media.spec.ts` (строка ~557): `getByTestId('camera-recording-status')` не появился в сценарии видео/аудио. |
| Новый Settings E2E | **ВКЛЮЧЁН В ПРОГОН** после изменения маски; не фигурирует в обоих списках отказов. Требуется полный совместный PASS перед merge. |

**Интерпретация:** два разных отказа на неизменённых Viewer/Camera путях указывают на возможную нестабильность общей тестовой среды/асинхронного состояния, но **не доказывают**, что функциональность исправна. Нельзя молча списать на «флейки» или править security/assertion в UX-PR без расследования. Финальный статус #146 — **Draft / BLOCKED, CI 2/3 PASS**, а не «почти готово». Для устранения: продуктовый QA отдельно воспроизводит Viewer и Camera, проверяет реальный DOM/подписанные данные/переходы, исправляет первопричину либо тестовую синхронизацию и повторно прогоняет полный Chromium.

**Никаких merge, реальных ACL/TTL или E2EE backend-изменений, удаления данных, публикации или переключения `main` в #146 не было.**

## 4. Разделение параллельных веток на момент проверки

- **PRODUCT:** #139→#140→#141→#143→#144→#145, затем #147 (от #145) и [#148](https://github.com/1troitsky/photobunker-v3/pull/148) (от #147). #147: приватные Info metadata через отдельную зашифрованную копию, **51/51 E2E PASS**; #148: JPEG aspect/rotation, **52/52 E2E PASS**, оба CI 3/3. Счётчики **индивидуальны**, не распространять на #146.
- **UX:** #135→#138 — импорт исходных утверждённых HTML и карта всех `docs/_uiux/*.html` без изменения runtime. Изолированный UX Review #142 закрыт; это не рабочий инструмент.
- **UX INTEGRATION:** #146 ответвлён от #145; меняет `AccountView.vue`, новую `ui/fieldwork/`, `tests/playwright.config.ts`, новый тест и документ. #147/#148 меняют `FileViewerView.vue`, `styles.css`, специфичные media helpers/E2E. **Пересекающихся изменённых продуктовых файлов между #146 и #147/#148 нет**, но ветки имеют **разную базу**. Объединение требует нового проверенного integration-HEAD.

### Обязательный preflight следующего UX PR

1. Проверить свежие открытые PR и их `Files changed` перед реализацией.
2. Не копировать целиком `docs/ux/` из #138 поверх текущего product HEAD. Только утверждённые правила/проверенные компоненты.
3. Не менять `FileViewerView.vue`, `styles.css`, Browser/Editor, криптографию, outbox, API или E2E этих функций из UX ветки.
4. Работать отдельным узким Draft; **не объявлять** готовность до полной проверки на актуальном объединённом HEAD.
5. Зафиксировать в PR какие UX-файлы/экраны реализованы, какие заглушки остаются и ссылки на реальные CI; не выдумывать статусы ACCEPTED.

## 5. Статус на 12.11.2026

- **Документация PR #139/#140/#141/#143:** сверена с их конкретными коммитами и GitHub Actions. **Нет разрешения на merge.**
- **Новый UX hub #146:** код интегрирован **в Draft-ветку**, не в `main`. Базовые unit/type/build/security PASS; полный Chromium FAIL в двух попытках по разным прежним тестам.
- **Безопасный следующий UX scope:** утверждённый Appearance/Dock 1.3 как *отдельный* модуль, без имитации PIN, платежей, профилей и мессенджера; подключать его к общему Shell лишь после проверки product file ownership и тестирования.
