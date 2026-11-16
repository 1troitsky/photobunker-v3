# Дополнение после исходного snapshot: Issue #415

После первого закрытия всех 129 исходных Issues, в 08:04:30 UTC создана [Issue #415](https://github.com/1troitsky/photobunker-v3/issues/415). Сохранена и закрыта с `state_reason=not_planned` по решению владельца; требования перенесены сюда без заявления о выполнении. Итоговый реестр: **130 Issues**, 0 открытых на 2026-11-16T08:08:29.999091+00:00.

**Статус:** TRANSFERRED_UNRESOLVED. **Приёмка нового HEAD:** NOT TESTED.

Новая Camera-ветка `fix/camera-photo-fieldwork-12-20261116` зафиксирована на `ec3670a1970e9be55c815aed6920b760c8c3ad30` и сохранена в отдельном защитном ref и проверенном приватном bundle. Она не интегрирована и не подменяет исходный анализ #412. 289 первоначальных веток сохранены; две новые remote branches — audit и Camera — перечислены в closure proof.

## Сохранённые требования Issue, а не команды для данного аудита

Scope / exclusive CLAIM for Camera photo on fix/camera-photo-fieldwork-12-20261116, based on archived integration PR #412 exact f4c7c91fe8100377c10d7af734c7ead90b217e7f, accepted source docs/ux/camera/{README.md,index.html,style.css} and docs/ux/UI-SHELL-CONTRACT.md.

Phase 1: remove production-only P1/P2 media destination selector, duplicate mode selector and extra enable/disable controls from the approved Camera main composition; retain encrypted P1/P2 preset compatibility internally (no destructive migration). Provide an actual user-visible device permission retry via the approved "Разрешить камеру/микрофон" actions. Add regression tests for UI and deny→retry; preserve production camera, E2EE outbox, signed assignment, GPS, blind mode and video/audio.

Full phase acceptance: compare all Camera 1.2 approved states and styles; prove real photo capture→encrypted local outbox→Browser/Viewer→Garage readback with authentic account/session and strict negative ACL/TTL; TS/Vitest/PHP/security + real PG18/Garage/Chromium exact-head CI. Physical Safari/iOS/Android is OWNER LATER and must be marked NOT TESTED, never PASS.

Rules: no docs/ux changes, no false test mocks, no main merge/deploy, no destructive actions; keep Draft until verified. Note PR #412 is closed unmerged, so this is a stacked candidate and not main functionality.

Полная структурированная запись и exit0 bundle verify: [JSON](post-snapshot-issues.json).
