# Camera / Photo — Fieldwork 1.2 conformance and native retry (2026-11-16)

## Sources and ancestry
- Source UX: `docs/ux/camera/README.md`, `index.html`, `style.css`, `docs/ux/UI-SHELL-CONTRACT.md`; all **unchanged**.
- Product base: closed, **unmerged** integration PR #412 at `f4c7c91fe8100377c10d7af734c7ead90b217e7f` (against accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b`).
- Work: new independent branch `fix/camera-photo-fieldwork-12-20261116`, Issue #415; no source branch or main modifications.

## Concrete discrepancies in production Camera
1. Additional `#camera-mode` dropdown inside settings duplicated approved **Фото / Видео / Аудио** tabs; remove, preserve the tabs and their record-aware disabling.
2. Visible `#camera-photo-storage` exposed internal **P1/P2** protocol IDs and descriptions not present in approved UX; remove from production camera. Retain persisted preset compatibility and both encrypted pipelines until a separately accepted storage migration exists. **Do not rewrite existing encrypted captures**.
3. Additional **Включить/Отключить** button row beneath shutter changed the approved bottom trio and page height; remove. On denied camera/microphone start the user now invokes approved Settings → **Разрешить камеру** / **Разрешить микрофон**; temporary permission stream is stopped first, then a new native stream is requested only if account, device and media mode are unchanged and no live stream/start exists.

## Additional conformity and native safety work
- Restore **exact approved** assignment/list and settings/gear SVG icons above the two side-action labels with a vertical icon-plus-label layout, preserving the 124px control strip and one Header/Dock.
- Restore four 18px white viewfinder-corner guides as in the original Camera 1.2; render only on photo/video, not on the recorder, and never draw guides into the captured JPEG.
- Move successful encrypted capture status and failed camera errors into a single non-interactive toast **inside the fixed stage** (rather than appending extra rows below the controls); status messages never contain protocol names such as "P2 JPEG".
- Hardware stream may be ended by OS/permission revocation while Camera is idle: listen to `MediaStreamTrack.ended`, detach the existing video preview, disable shutter and require an explicit settings retry. Existing active recording already has its own fail-closed interrupted-recording handler; no change to that pipeline.
- Extend real Playwright coverage from offline photo→ciphertext queued→Garage sync to **Browser→File Viewer→valid decrypted JPEG**. Existing independent-context recovery and 404 outsider ACL are also covered by `tests/e2e/p1-identity-photo.spec.ts`.
- Native camera/iOS/Android acceptance remains untested by design, per owner instruction. Full remaining style parity and CI cannot be declared PASS without latest-head evidence.

## 2026-11-16 approved 1.2 exact-UI refinement
- Main Camera fills the Shell without invented horizontal margins or a second mode selector; four finder corner markers, inner white-ring shutter, native red recording/stop disc, centered GPS dot/pill and approved action icons remain positioned in the fixed stage/124px action row.
- Camera shows the approved white 250ms snapshot flash **only in viewfinder** after a JPEG is rendered. Actual encrypted photo pixels are never altered by this animation. Video shows a live recording timer+red dot over the finder. Dictaphone occupies the full stage (not a 4:3 image) with approved microphone emblem and nine bars.
- Blind Mode uses the accepted exact Russian copy, icon spacing, always-visible capture button and volume-key fallback note. Showing/hiding it does not restart a live stream.
- Settings sheet keeps the approved order **Пресеты камеры → Фото → Видео → Аудио → Геолокация → Разрешения устройства**. Grid/torch are inside Фото; all GPS controls inside Геолокация; two permission actions follow GPS. Labels, grab handles and X close controls match selected 1.2. Changing assignment/settings and opening GPS settings during active recording or JPEG sealing is blocked rather than editing an in-flight capture.
- JPEG maximum/high/medium/low use four actual bounded native-size tiers (1600/1280/960/640 pixels max side) plus respective JPEG quality coefficients. Never upscale sensors; signed metadata/GPS and E2EE persistence are unchanged.
- Assignment category choices derive from signed owner policy vocabulary (no synthetic category list), with validation of mandatory category, allowed categories, description minimum, GPS and required signed tags. Incomplete photo capture opens the approved assignment sheet *before* JPEG bytes are encoded; server/crypto validation remains authoritative.

## Sealed preset hardware settings and compatibility
- Confirmed an actual accepted 1.2 functional gap: old encrypted camera presets persisted photo/video/audio resolution and some UI values but omitted optical zoom, hardware torch intent and GPS tracking preference.
- Extended `CameraPresetSettings` with bounded `photoZoom` (1×–3×), `torchEnabled` and `gpsTrackingEnabled`. Decoder accepts exactly the original ten-property version-1 shape or the new thirteen-property shape. Old ciphertext and its AES-GCM AAD are **not rewritten during read**; old values default to 1×/off/off, and the next explicitly saved preset uses the normal encrypted revision transition. Unknown/partial/malformed shapes fail closed.
- Native hardware applies zoom and torch **only when its live track explicitly reports support and constraints succeed**; unsupported hardware never receives invented success. User edits of real zoom/torch update the saved preference; cryptographic identity switching immediately clears preferences, not merely their on-screen values.
- GPS preference remains separately encrypted but is **not** an OS permission grant. Restoring a preset or reloading a device must not trigger `getCurrentPosition` or install a watcher. The user must choose «Определить координаты» or explicitly enable tracking and grant permission again; the approved settings panel explains the required action.
- Added validation, AES-GCM legacy-row read/no-rewrite, upgraded ciphertext save and native zoom/torch/no-background-GPS regression tests. **Actual test PASS is pending current-head CI.**
- The accepted conditional «Ракурс» field is only meaningful if a signed owner policy provides allowed angles; the current verified assignment policy schema has categories and mandatory tags but **no signed angles list**. The implementation does not invent an unverified list. This is a remaining policy/API acceptance gap, not an accepted full feature.

## Dedicated acceptance CI — no inheritance from older heads
- All three owner-selected Camera paths are in scope: Camera 1.2 app, real native camera lifecycle and encrypted media readback. Both previously excluded `p2-camera-fieldwork-ux.spec.ts` and `p2-camera-presets-ux.spec.ts` were added to default `tests/playwright.config.ts` discovery (confirmed passing in old isolated shard4 at `8ec399dd`).
- New dedicated `.github/workflows/p2-camera-acceptance.yml` runs eight existing Camera test **files** through real Chromium with genuine Laravel 13, PostgreSQL 18 and Garage 2.5. Only media-device hardware is simulated by Chromium; no bypass of encrypted backend, session, receipt or ACL. Full six-shard suite and its security gates remain unchanged; this does not substitute for its aggregate result.
- **Latest exact-head result PENDING** until GitHub Actions executes; do not propagate the historical `8ec399dd` PASS to later code.
- Physical iOS/Android/real-camera hardware compatibility remains **NOT TESTED / OWNER LATER**.

## Invariants preserved
- Exactly one shared Shell; header has only camera flip/torch/blind, mode tabs and GPS/shutter/actions retain position. No new UI flow or new labels beyond approved permissions.
- Existing `captureEncrypted` / `enqueueEncryptedMedia`, MediaRecorder ciphertext outbox, signed assignment policy, GPS consent rechecks and caller identity assertions are unchanged. No OS gallery write.
- Device permission success is a preflight, not a permanent authorization: new stream can still fail and its real error remains visible. Rejected permission does not silently retry.
- Existing device/session scope guards and late stream release remain in place; no change to security backend, account state or production keys.

## Test changes and truthful scope
- Unit: Camera 1.2 mode tab interaction, encrypted preset destination retained without exposing P1/P2, cross-session and GPS negative scenarios, denied permission → explicit preflight → release temporary track → restart genuine stream, leaving the view releases stream.
- Real Playwright: approved Camera-only control census, permission entry in Settings and denial/retry from Settings; active stream release via actual Shell navigation.
- These are **test definitions** on the current integration branch; only completed exact-head CI is evidence of a PASS. CI status must be verified against exact PR HEAD; inherited #412 Chromium sharding had 2/6 failed, so any new aggregate success must not be inferred.
- Physical iOS Safari/Android permission, camera, geolocation and OS gallery acceptance is explicitly **NOT TESTED / OWNER LATER**.
- This conformance patch alone does **not** certify every Camera capability, the P1→P2 storage migration, all photo sync retries, or the full photo → Browser → Viewer → real Garage round trip. Maintain Draft and do not mark the photo workflow fully accepted without real end-to-end proof.
