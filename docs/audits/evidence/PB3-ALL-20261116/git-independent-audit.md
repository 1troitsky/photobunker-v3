# Независимый Git-аудит PB3 · 16.11.2026

**Вывод:** в main не обнаружена доказанная потеря файлов или рассмотренных критичных merge-fix. **PR #412 не объединяет все полезные изменения donor candidate:** отсутствуют logout-fence из #403, отдельная негативная QA и документация #292. Закрытие PR/Issues не означает реализацию или приёмку.

## Зафиксированные состояния

- Main local/origin tracking: **`8ed66c438d090efd218efa80b027f0b2f854db4b`**, 1555 commits. Аудитор не менял refs, main, исходники продукта или GitHub.
- Старый snapshot: **284 PR / 288 веток / 3024 reachable commit**. Сохранённые граф, scopes/categories и blob comparisons воспроизведены по Git-объектам.
- Свежий snapshot `raw/prs-pages.json` / `raw/branches-pages.json`: **285 PR / 289 веток / 3381 reachable commit**. Все 289 `refs/audit/20261116/branch/**` совпадают с snapshot SHA. PR states относятся к snapshot до последующих закрытий родителем.
- Исходный isolated candidate: **`edfaaee947940e4fe07fe8713565118dd39a4295`**, 1668 commits, 171 PR HEAD ancestor.
- [PR #412](https://github.com/1troitsky/photobunker-v3/pull/412): **`f4c7c91fe8100377c10d7af734c7ead90b217e7f`**, 1975 commits, 162 PR HEAD ancestors. Размер истории не доказывает полноту интеграции.
- Позднее сохранённый donor: **`783b6a7757b804d06d15426de2457f94e37ca741`**, потомок edfaaee9. Изменённые 15 paths и сравнение с #412 записаны в JSON; новая runtime-приёмка **NOT VERIFIED**, старые runtime counts ему не перенесены.

## Main: 15 merge resolutions

Для **13 двухродительских merge** пересчитаны merge-base, incoming-only/concurrent paths. Ни один incoming-only path не потерян и не изменён при merge: mode/type/blob результата равны incoming source. Два octopus merge воспроизведены точным наложением blobs в памяти без записи Git-объектов. Все **739** исторически изменявшихся paths `apps/`, `docs/`, `scripts/` присутствуют в main. Это не исключает произвольные semantic regressions на уровне строк.

| Commit | Независимый содержательный вывод |
| --- | --- |
| `349567c831c9920a31659d3de9c8d12c5cdef544` | Result tree = first parent. Incoming #101 sameSession fix уже присутствовал: epoch + accountId + deviceId + device + pkg; тот же guard есть в main. Photo-text E2E blob одинаков у родителей. Потеря #101 не подтверждается. |
| `031268fcef916bf05e69c23226a702325775aefb` | 165 incoming-only paths точны. Sole test conflict сохраняет более конкретный `.file-viewer-feedback [role="status"]` из product parent; forged-page delivery, 50/50 index и audio assertions сохранены. |
| `c99fe952303dabf0c73306a61ce2905ba374e9ba` | 31 UX + 133 docs/source/guard paths точны, overlap 0. Full tree = PRODUCT first parent + overlays. Оба late #139 fix присутствуют в evolved PRODUCT: editor Ctrl/Cmd+Z и открытие `viewer-action-edit` перед Safe journey. |
| `516b8a3ff558eadd552a4f231f697f4dbbc5ca36` | Все 23 AV + 6 mixed Assignments + 5 QA paths точны, overlap 0. Единственный extra поверх exact overlay — собственный `P2-AV-ASSIGNMENTS-PREMAIN-20261114-CHAT-L.md`. |
| `f4bce2e1ab3e5ad72ec1d7e8c8f4d7517e286faa` | Add/add progress conflict сохраняет актуальную таблицу first parent от 13.11 вместо устаревших процентов от 11.11. First-parent tree сохранён целиком. |
| `29e3ecace7bb7b890dc27d7fe652fe9f18ca9a78` | Archive/audio tests совпадают у родителей; crop test сохраняет upstream bootstrap и добавляет настоящий grayscale/export pixel assertion. |
| `9841f5d000501cbe34a4c5ac1e7af5694fc607f1`, `befb8ea4443c629bba9b9bb1443fd510e1b8f920` | Extra changes ограничены собственными audit/gaps документами; incoming-only code сохранён. Оба security-patch paths befb parents совпадают. |
| Остальные 8 merge | Incoming-only blobs точны; полный SHA/parent/path inventory в `main_merge_reviews` JSON. |

Старый merge PR #290 `9160cbf17…` вне main, но его HEAD **f4bce2e1ab3e** включён через #293 `4521f7b9c954df5af2356311115f425673796d8e` → `6565a0fe852882ea5fc26e493df81affed687eee`. Это не потерянная интеграция. Поздний #336 идёт через `b24f93990ef3cac9eb10e2e86e6fb562611dfb05` → main8ed66c43.

## Конкретные расхождения #412

**edfaaee9 и #412 — sibling**, merge-base `d7ccec973a58510d065fae18de3e8cc8991fbd86`; между ними 189 changed files, +16176/−3221. Donor783b6a77 также не ancestor #412. Полные source/paths comparisons с обоими donor SHA сохранены в JSON.

**Security integration gap:** #412 `session.ts` не включает #403 `logout-fence.ts`, storage-event listener, synchronous fence checks в requireSession/admission/resume после key-unseal. Logout сохраняет прежнюю последовательность `await markSignedOut(...)` перед сбросом activeSession. Это конкретно отсутствующий защитный код; exploit/runtime behavior **NOT VERIFIED**. Воспроизводится `git diff edfaaee9 f4c7c91 -- apps/web/src/features/identity/application/session.ts`.

**Документация отсутствует:** `docs/audits/P2-291-MESSAGES-LOCAL-DRAFTS-INTEGRATION-20261113.md` отсутствует в #412, хотя source #292 **`034deb1140d17e62eaf136606fac714dc747e414`** — ancestor #412. Это прямой контрпример выводу «ancestor значит содержимое сохранено».

Старые #401 `recovery-key-export.ts` paths отсутствуют, но #412 реализует альтернативный `ui/fieldwork/recovery-key-save.ts` с picker/share и явным unsupported state. Отсутствие старого пути само по себе не доказывает потерю функции; полная semantic equivalence **NOT VERIFIED**.

В #412 отсутствуют 20 paths из edfaaee9, включая четыре отдельных spec: logout durability #403, persistent-storage anti-forensics #380, recovered-cloud video clip #377, прежний Recovery export #401. Также отсутствуют точные grant TTL cutoff tests #389/#394 и audit/session-bootstrap документы #409/#411. Все 20 paths перечислены в `pr412_vs_candidate.missing_candidate_paths` JSON; donor783 comparison расположен отдельно.

## #412 CI: шесть шардов и границы покрытия

[Workflow на точном SHA](https://github.com/1troitsky/photobunker-v3/blob/f4c7c91fe8100377c10d7af734c7ead90b217e7f/.github/workflows/p0-02-storage.yml#L14): lines14–20 — matrix1..6, fail-fast:false, timeout25; line178 — `--shard=${{ matrix.shard }}/6 --reporter=list`, без grep/retry/маскирования exit; lines190–201 — aggregate always/needs gate требует success. Каждая matrix job имеет собственные disposable PG18/Garage services. Все **11 run-блоков** проверены `bash -n` через stdin: каждый **exit0**, команды не исполнялись. Полная YAML schema **NOT VERIFIED**.

[tests/playwright.config.ts:9](https://github.com/1troitsky/photobunker-v3/blob/f4c7c91fe8100377c10d7af734c7ead90b217e7f/tests/playwright.config.ts#L9) пропускает 93 spec files, но исключает три новых UX spec, по одному literal test в каждом:

- `tests/e2e/p2-camera-fieldwork-ux.spec.ts`
- `tests/e2e/p2-camera-presets-ux.spec.ts`
- `tests/e2e/p2-contacts-team-profile-ux.spec.ts`

Во включённых specs не найдены test/describe.skip, fixme, only; все исходные main spec paths сохранены в #412. Четыре отдельных donor QA spec вообще отсутствуют в #412; их нельзя засчитать как выполненные в shards. Статический literal registration count = **134**, а не фактический discovery count. Заявленные 135 actual tests, реальное распределение и execution **NOT VERIFIED**; parametrization может менять число. Sharding механически fail-closed, но описание «весь suite» не учитывает три файла вне allowlist. Родитель отдельно получает exact-head GitHub CI; аудитор повторные CI/runtime-тесты не запускал.

## Неинтегрированный scope и границы старого script

Для старого 267-open snapshot подтверждены **133 ancestor / 14 byte-identical / 16 evolved / 104 different**. Это история и bytes, не продуктовая приёмка. 104 different/16 evolved нельзя переименовывать в «доказанно потерянные функции».

Для старых 284 PR в edfaaee9 отсутствовали **454 unique contributed paths**. При добавлении #412 в полный inventory появляются новые source paths: свежая матрица285 PR даёт **525 отсутствующих в edfaaee9**, **464 отсутствующих в #412**. Полный `path → PR` индекс отдельно для main/edfaaee9/#412 сохранён в JSON. Отсутствие может означать невключённый preflight, заменённую реализацию или старую QA, а не удаление из main.

Значимые остающиеся семейства: Matrix binding/RustCrypto/escrow/trust/outbox/revoke (#68–#81/#133/#261), PIN/Panic/DMS/remote-wipe (#308/#355), Vault/restore (#332/#357), Public Card backend consent/publication (#352; часть client paths #412 уже включает), administration/telemetry (#354/#350), BYO/placement/replication/failover/purge (#356/#359/#361/#363/#364), device evidence/branding/legal/Matrix BYO (#375), release trust (#348/#300), federation/SDK/large-account QA (#379/#383/#391/#384), separate notification transport/event inbox (#296/#407). Названия исходных PR содержат preflight/internal-only/blocked; копирование файлов само по себе не завершает функцию.

`reconcile.py` зависит от четырёх абсолютных `/private/tmp` inputs; старый summary.local_main `da7327b8` — историческое наблюдение. Текущие local/origin main =8ed66c43. Artifact writer диагностировал ложные несовпадения Git quotePath для четырёх кириллических `docs/_local-tasks` paths; диагностический цикл остановлен, диагностика сохранена в JSON. Финальная документация использует NUL-separated paths. Это не потеря Git-данных.

## Канонические sources и проверяемость

**117 `docs/ux/**` файлов побайтно равны PB2 `daca24a4a38c62473859b2b54b4999d50400c491` одновременно в main, edfaaee9 и #412**, включая mode/type/blob. Это provenance эталонов; visual integration/устройства не проверены. JSON хранит SHA256 входных snapshot/script файлов и полный inventory285 PR/289веток.

Read-only `git rev-list`, `git diff --name-only -z`, `git ls-tree -rz`, `git show`, `git log --full-history -m -z` и final artifact writer завершились **exit0**. Все сохранённые comparison booleans true; команды/результаты в `verification` JSON. Детерминированный reproducer доступен без LLM:

```sh
python3 -c "import json; exec(json.load(open('.local-delivery/audit-all-20261116/git-independent-audit.json'))['reproduction_script'])"
```

`git diff --check main edfaaee9` → **exit2**: trailing whitespace/EOF в audit Markdown и NotificationSettingsView; exact stdout и отдельный результат #412 сохранены в JSON. Аудитор их не исправлял. В edfaaee9 App.vue comment ошибочно называет Messages unavailable при включённом source route.

**NOT VERIFIED:** runtime/DB/API/browser/current CI, произвольная semantic equivalence evolved файлов, production crypto/privacy/security, эстетика/физические iOS/Android, Camera/GPS/PWA/push, performance/RUM, полная P1–P4 приёмка, runtime donor783. Main не менялся; merge/deploy/destructive actions не выполнялись. Предсуществующие unstaged удаления docs/status корневой workspace не означают удаления из main.

## Точная source matrix выбранных PR

В edfaaee9 сохранены все 11 указанных source HEAD, missing scoped contributed paths =0. Byte-different Shell/Storage/Recovery файлы эволюционировали; таблица не объявляет их потерянными автоматически.

| PR | Source SHA | Scoped paths | edfaaee9 exact / missing | HEAD ancestor #412 | #412 exact / missing |
| --- | --- | ---: | ---: | --- | ---: |
| #292 | `034deb1140d17e62eaf136606fac714dc747e414` | 13 | 7 / 0 | да | 2 / 1 |
| #377 | `3b6d857470e68a5dded5e1c1c1abcc79703ec875` | 2 | 2 / 0 | нет | 0 / 2 |
| #380 | `ccf75055f20560465f5e2f58dfc30ed0e6ed86ba` | 2 | 2 / 0 | нет | 0 / 2 |
| #389 | `371ba3aa54b07a3d635ee588ff06152eb6ef8dd1` | 2 | 2 / 0 | нет | 0 / 2 |
| #394 | `619235290ed28d367d2195f7afea95a510fca1a8` | 2 | 2 / 0 | нет | 0 / 2 |
| #398 | `463969c56bc6313a7a4d3ec5cb0ae935051f27e9` | 79 | 67 / 0 | да | 51 / 0 |
| #399 | `bb391828f34ad4bcf4bc7fd9dfe7b17aa8f7e1be` | 83 | 74 / 0 | да | 59 / 0 |
| #401 | `53ea2283d608823901380c82fedcbdb54e7ffe9d` | 80 | 72 / 0 | нет | 53 / 4 |
| #403 | `f56e42ec3224bdd995f75c26abd47220469bda55` | 5 | 5 / 0 | нет | 0 / 4 |
| #409 | `b711fde7b56ec3616f4fa96d52d9df76df7f977d` | 2 | 2 / 0 | нет | 0 / 1 |
| #411 | `3aac0ac71a982d14086f064ebce63c00ead6b231` | 18 | 17 / 0 | нет | 12 / 2 |
