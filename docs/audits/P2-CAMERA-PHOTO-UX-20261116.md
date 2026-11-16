# Camera / Photo — Fieldwork 1.2 conformance and native retry (2026-11-16)

## Sources and ancestry
- Source UX: `docs/ux/camera/README.md`, `index.html`, `style.css`, `docs/ux/UI-SHELL-CONTRACT.md`; all **unchanged**.
- Product base: closed, **unmerged** integration PR #412 at `f4c7c91fe8100377c10d7af734c7ead90b217e7f` (against accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b`).
- Work: new independent branch `fix/camera-photo-fieldwork-12-20261116`, Issue #415; no source branch or main modifications.

## Concrete discrepancies in production Camera
1. Additional `#camera-mode` dropdown inside settings duplicated approved **Фото / Видео / Аудио** tabs; remove, preserve the tabs and their record-aware disabling.
2. Visible `#camera-photo-storage` exposed internal **P1/P2** protocol IDs and descriptions not present in approved UX; remove from production camera. Retain persisted preset compatibility and both encrypted pipelines until a separately accepted storage migration exists. **Do not rewrite existing encrypted captures**.
3. Additional **Включить/Отключить** button row beneath shutter changed the approved bottom trio and page height; remove. On denied camera/microphone start the user now invokes approved Settings → **Разрешить камеру** / **Разрешить микрофон**; temporary permission stream is stopped first, then a new native stream is requested only if account, device and media mode are unchanged and no live stream/start exists.

## Invariants preserved
- Exactly one shared Shell; header has only camera flip/torch/blind, mode tabs and GPS/shutter/actions retain position. No new UI flow or new labels beyond approved permissions.
- Existing `captureEncrypted` / `enqueueEncryptedMedia`, MediaRecorder ciphertext outbox, signed assignment policy, GPS consent rechecks and caller identity assertions are unchanged. No OS gallery write.
- Device permission success is a preflight, not a permanent authorization: new stream can still fail and its real error remains visible. Rejected permission does not silently retry.
- Existing device/session scope guards and late stream release remain in place; no change to security backend, account state or production keys.

## Test changes and truthful scope
- Unit: Camera 1.2 mode tab interaction, encrypted preset destination retained without exposing P1/P2, cross-session and GPS negative scenarios, denied permission → explicit preflight → release temporary track → restart genuine stream, leaving the view releases stream.
- Real Playwright: approved Camera-only control census, permission entry in Settings and denial/retry from Settings; active stream release via actual Shell navigation.
- At time of writing, these are **test definitions**, not a claimed PASS. CI status must be verified against exact PR HEAD; inherited #412 Chromium sharding had 2/6 failed, so any new aggregate success must not be inferred.
- Physical iOS Safari/Android permission, camera, geolocation and OS gallery acceptance is explicitly **NOT TESTED / OWNER LATER**.
- This conformance patch alone does **not** certify every Camera capability, the P1→P2 storage migration, all photo sync retries, or the full photo → Browser → Viewer → real Garage round trip. Maintain Draft and do not mark the photo workflow fully accepted without real end-to-end proof.
