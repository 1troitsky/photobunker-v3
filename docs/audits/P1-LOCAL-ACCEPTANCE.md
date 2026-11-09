# P1 local acceptance — 2026-11-09

**Основной A → B → A сценарий подтверждён в локальном Chromium с синтетической
камерой. Полная acceptance НЕ закрыта:** cold offline reload падает, Safari и
физические устройства не проверены, последняя корректировка нового recovery-теста
не запускалась. Это не owner acceptance и не разрешение на production.

## Область и воспроизведение

- Репозиторий: `1troitsky/photobunker-v3`.
- Неизменяемая база: `p1/04-assignment-e2ee-capture` @
  `e72c350d8926bcac17c515acef6eb1dc884c6206`.
- Рабочая ветка: `qa/p1-local-acceptance`.
- Изучены `AGENTS.md`, релевантные разделы `ts.md`, P0/P1-01/P1-02/P1-04,
  ADR-0001/0002, все три CI workflow, исходные тесты и код проверяемых сценариев.
- Изменения ограничены `scripts/local-acceptance/`, `tests/local-acceptance/`,
  `docs/audits/`. Продуктовый код, исходные E2E, `ts.md`, main и PR #11/#12
  не изменялись. Все 30 файлов, существовавших до подключения Git, сохранили SHA-256.

Одна команда из корня проекта:

```sh
python3 scripts/local-acceptance/run.py
```

Требования, изоляция, отдельные команды и формат артефактов описаны в
[README harness](../../scripts/local-acceptance/README.md). Порты 8000/5173/4173
должны быть свободны. Harness создаёт случайный Compose project, новые tmpfs
PostgreSQL/Garage, собственные credentials и копию API во временной папке.
Существующие контейнеры другого PhotoBunker на 8081/3901 не использовались и
не останавливались. Миграции и destructive lifecycle fixtures выполнялись только
на созданных синтетических данных, с исходными CI safety guards.

**Артефакты с командами, exit codes, длительностями и browser results:**

- [Полный прогон](P1-LOCAL-ACCEPTANCE-EVIDENCE.json), exit **1**.
- [Точечная recovery-диагностика](P1-LOCAL-ACCEPTANCE-RECOVERY-EVIDENCE.json), exit **1**.
- Локальные приватные оригиналы: `$TMPDIR/pb3-acceptance-3kivnfsv/` и
  `$TMPDIR/pb3-acceptance-ietam9zs/`, включая `summary.json`, JUnit, Playwright JSON,
  server logs и скриншоты. Пути в опубликованном JSON нормализованы как `$RUN_DIR`/`$REPO`.
- Raw traces и credentials не опубликованы: исходные E2E failure traces могут
  содержать синтетические Recovery Keys. Экспортёр использует только разрешённые
  поля метаданных, без request bodies, ошибок, медиа и credential files.

## Проверенные зависимости

| Компонент | Проверенная версия |
| --- | --- |
| Host | macOS 26.6.2 / 25G83, arm64 |
| Python | 3.9.6 |
| Node / pnpm | 22.23.3 / 10.20.0 |
| Docker Engine / Compose | 29.8.2 / 5.5.0, OrbStack |
| PHP | 8.4.27, отдельный собранный образ; существующие 8.4.26 отвергнуты |
| Composer / Laravel / PHPUnit | 2.10.3 / 13.39.0 / 12.5.42 |
| PostgreSQL / Garage | 18.6 / 2.5.0 |
| Vite / Vitest | 7.3.7 / 4.1.11 |
| Playwright / Chromium | 1.56.1 / 141.0.7390.37, headless |
| Установленный Safari driver | 26.6.2 (21624.5.1.11.3); browser session не создана |

PHP/DB/S3 image digests сохранены в приватном `image-digests.log`. Проверены
`php scripts/check-runtime.php`, frozen pnpm/Composer installs, strict Composer
validate и фактический Laravel boot. Host PHP/Composer не установлены; обхода
security floor через `--ignore-platform-reqs` нет. PHP 8.5 отдельно **NOT TESTED**.

## Результаты

Для `PASS` ниже есть реальная команда, exit 0 и артефакт в JSON. Сценарии,
которые не завершены или не запускались, не считаются пройденными.

| Проверка / команда | Результат | Проверяемое свидетельство |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `typecheck`, exit 0 |
| `pnpm test:web` | PASS | `vitest`, exit 0; 5 файлов, 15 тестов |
| `pnpm build` | PASS | `production-build`, exit 0; production JS 276.47 kB / gzip 91.97 kB |
| `composer validate --strict --no-check-publish`, PHP lint, plans | PASS | `composer-validate`, `php-lint`, `plan-registry`, exit 0 |
| `php artisan route:list` / isolated migrate / healthz / readyz | PASS | `routes`, `migrate`, `healthz`, `readyz`, exit 0 |
| `php vendor/bin/phpunit` | PASS | `phpunit`, exit 0; **27 тестов, 227 assertions**, SQLite без сети |
| Исходный `garage-postgres-smoke.php` | PASS | `garage-postgres-smoke`, exit 0; реальный SQL/S3 SHA-256 readback |
| Исходный `lifecycle-garage-smoke.php` | PASS | `lifecycle-garage-smoke`, exit 0; TTL, delete, tombstone, два late writes |
| Исходный Playwright config без изменения тестов | PASS | `product-e2e`, exit 0; **4/4**, без retries |
| A создаёт задание на 30 фото, B принимает после fingerprint, offline capture, sync, отдельный grant, A decrypt | PASS | Оба исходных P1-04 теста; второй через реальный Vue UI |
| C получает отказ; revoke блокирует будущие reads и submission visibility | PASS | Исходные P1-03/P1-04 E2E, 404/410; уже расшифрованная копия не отзывается |
| Recovery Key на новом профиле, online reload trusted device | PASS | Первый исходный E2E |
| Registration 503: loading/disabled, сохранённый operation ID, retry | PASS | `acceptance-e2e`: соответствующий тест passed |
| Logout завершён → новый аккаунт в том же профиле; чужая очередь недоступна и сохранена | PASS | `acceptance-e2e`: account switch passed |
| Camera denial → alert → retry; уход с камеры останавливает tracks | PASS | `acceptance-e2e`: camera denial passed; ошибка синтетическая |
| 320/375/390/768px, keyboard Enter, browser back, touch tap | PASS | `acceptance-e2e`: mobile test passed; горизонтального overflow не обнаружено |
| Новый полный lost-ACK / duplicate-count / cloud-decrypt тест | NOT TESTED до завершения | Исполнялся с FAIL harness; финальная поправка ожидания **NOT VERIFIED**, см. ниже |
| Cold offline document reload | **FAIL** | `acceptance-e2e`: cold reload failed; воспроизведено дважды |
| Native Safari | NOT TESTED | `safari`, exit **77**; Allow Remote Automation выключен |
| Физический iPhone / Android, системная галерея, GPS, фон/PWA | NOT TESTED | Устройства в этой сессии не использовались |
| Полный WCAG audit / финальная эстетика Fieldwork 5.0/Editor 2.2 | NOT VERIFIED | Нет полного сопоставления утверждённого UX; узкий P1 экран не финальный P2 UI |
| Защита Compose от caller env / read-only source mount | PASS | `python3 -B tests/local-acceptance/test_isolation.py`, exit 0, 1 реальный config-test |
| Cleanup собственного Compose project | PASS | `isolated-cleanup`, exit 0 в обоих опубликованных прогонах |

Полный browser-прогон дополнительных тестов дал **4 passed / 2 failed**.
Один failure — реальная cold-offline граница; второй — ожидания нового теста,
не доказанный продуктовый дефект. Итоговый полный прогон после последней правки
теста и подключения isolation contract **NOT VERIFIED**; зелёный aggregate не заявляется.

## Дефекты и блокеры

### LA-01 — P1 severity: cold offline reload не открывает приложение

1. Запустить harness, открыть `/settings` на `http://127.0.0.1:5173`.
2. Убедиться, что страница загрузилась.
3. Отключить сеть в Chromium context и выполнить настоящий document reload.
4. Ожидание: доступен локальный shell. Факт: heading/приложение отсутствуют,
   assertion не проходит за 3 секунды; локально доступная IndexedDB сама по себе
   не делает приложение открываемым без сети.

Блокирует полную offline/PWA acceptance. Это **известная граница**, а не новая
регрессия: `injectRegister:false` и ADR-0001 намеренно откладывают SW activation
до решения независимого trust anchor. Тест выполнялся на Vite dev server;
самостоятельная production cold-offline browser проверка **NOT VERIFIED**.
Продуктовый код не исправлялся. Потеря ciphertext этим сценарием не доказана.
После двух воспроизведений локальный цикл остановлен.

### LA-02 — P2 harness: финальный шаг нового recovery-теста не подтверждён

Точечный тест подтвердил сохранение account/photo/operation IDs, обоих AES-GCM
ciphertext blobs и SHA-256 после upload 503 и online reload. Затем сервер успешно
финализировал фото, ответ был намеренно оборван через `route.abort`, локальная
строка восстановилась в `synced` без потери bytes. Полная проверка остановилась
на чтении cloud list: получен HTML вместо ожидаемого JSON.

Snapshot показывает, что `synced` уже отображается из IndexedDB, пока кнопка
sync ещё disabled. Вероятная причина последнего сбоя — запрос до окончания
session resume/sync. Исправлены ожидание завершения sync и явный JSON Accept;
**последняя правка не запускалась** после остановки повторного локального цикла
диагностики async-ожиданий. Поэтому server duplicate count и cloud decrypt именно
после этой fault injection остаются **NOT VERIFIED**. Исходный happy-path decrypt,
идемпотентность в PHPUnit и сохранность локальных bytes подтверждены отдельно.
Не классифицировать этот FAIL как обнаруженную потерю данных или обход E2EE.

### Браузерные ограничения

Native `safaridriver` вернул `session not created`: требуется Allow Remote
Automation в Safari Settings. Настройка не изменялась, WebKit не выдавался за
Safari. Это ограничение окружения, не продуктовый дефект. Физические iPhone и
Android не тестировались; их camera permissions, eviction, background resume,
системная галерея и PWA cold start остаются обязательной ручной приёмкой.

P0 дефектов в выполненных сценариях не подтверждено. Независимый crypto/security
аудит, реальный out-of-band fingerprint exchange, полноценная XSS защита,
storage eviction, S3 outage в browser flow и длительный background suspend
не проверены этим прогоном.

## Performance: сопоставимые лабораторные наблюдения

Один production bundle, URL `/settings` через preview:4173, Chromium headless,
390×844, по 5 warm navigations до и после browser checks. Продуктовый код между
замерами не менялся. Raw samples находятся в JSON attachments/export.

| Медиана, мс | До | После |
| --- | --- | --- |
| responseEnd | 1.1 | 1.4 |
| DOMContentLoaded | 7.9 | 7.8 |
| loadEventEnd | 8.5 | 8.2 |

Это Navigation Timing в локальной лаборатории, **не Lighthouse и не RUM**.
Нет установленного budget/порога; улучшение/регрессия не заявляется. FCP во многих
samples ещё отсутствовал при чтении, поэтому выводов о FCP/LCP/CLS/INP нет.

## Воспроизводимость и границы достоверности

Первый PHPUnit-запуск внутри Compose унаследовал APP_URL/DB settings HTTP-сервера
и дал 17 failures/403. Harness исправлен: PHPUnit работает в отдельном контейнере
`--network none` без Compose env, ровно с исходным `phpunit.xml`. В полном
следующем прогоне получены 27/27, 227 assertions. Этот ранний harness failure
не является продуктовым дефектом.

Синтетическая камера проверяет браузерный pipeline, но не hardware permission
dialog и не отсутствие файла в реальной системной галерее. Fingerprint checkbox
в E2E представляет действие оператора и не доказывает независимую PKI.
Revocation прекращает последующие серверные выдачи и не стирает уже полученную
расшифрованную копию. Очередь сохраняет ciphertext; проверка не обещает защиту
от скомпрометированного same-origin JS или физического доступа к unlocked device.
