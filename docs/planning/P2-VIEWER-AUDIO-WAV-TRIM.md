# P2 File Viewer — bounded local audio trim to WAV

**Status:** Draft, release acceptance pending exact-head Chromium/PG18/Garage CI and independent native Safari/device QA.

**UX reference:** approved `docs/_uiux/browser_video_audio_editor_fieldwork_1_1.html` — audio editor «Обрезка», «Создать WAV-фрагмент», explicit download and separate Browser save. This is a focused user journey, not the complete media editor.

## Workflow
1. Open an already authenticated and client-decrypted audio file from the existing signed P1 media paths in File Viewer. Browser decodes only this owner-accessible Blob, never an unauthenticated external URL.
2. Select start/end on two controls; range must be finite, at least 50ms and no more than 10min. Explicit «Создать WAV-фрагмент» creates local 16-bit PCM RIFF/WAVE (mono/stereo) via native WebAudio decoding and bounded PCM processing.
3. WAV bytes initially exist **only in volatile memory**. A playback element lets the owner inspect the result; no auto upload, OS downloads, plaintext IndexedDB, telemetry or server-provided conversion.
4. Explicit «Сохранить зашифрованно в Browser» enqueues a **separate personal** `audio/wav` MediaFile using the existing account AES-GCM, signed manifest and durable encrypted outbox. Show the local-success status; cloud ACK is independent. No automatic inheritance of original E2EE grants, assignment provenance, GPS or TTL. The original file remains immutable.
5. Explicit «Скачать WAV на устройство» shows a warning before user-initiated plaintext export. No OS media library integration is claimed.
6. On navigation, logout, account/device change or range adjustment, revoke the preview URL and invalidate all previous asynchronous results.

## Limits and security
- Local WebAudio decode is bounded to **32 MiB source**, **24 million decoded samples total**, 1–2 channels, 8–96kHz, output up to existing MediaFile max 128MiB. Oversize, unsupported codec, range, sample rate, multi-channel decode or invalid PCM fail closed; no fallback plaintext web service.
- WAVE fmt = 16-bit PCM little-endian; finite audio clipped to [-1,1] before quantization; NaN becomes 0. Header byte sizes and frame interleaving verified in unit tests.
- Runtime WebAudio decode uses `AudioContext` / compatible WebKit implementation and closes the context after success or failure. The exported filename is sanitized and includes millisecond bounds.
- Warm-offline playback/edit of already loaded media tested; cold-offline PWA bootstrap is not claimed. iOS audio codec support, Safari memory limits, OS filesystem behavior and physical devices remain unverified.

## Verification
- Vitest: signed samples, RIFF/WAVE header, stereo order, invalid ranges, decoded size/channel limits, filename sanitization.
- Chromium + real PostgreSQL18/Garage: generate a genuine 2-second PCM WAV and encrypt it offline, open/re-decode in Viewer, select 0.2–0.7s, verify preview does NOT enqueue or download, explicitly save encrypted derivative, decrypt and inspect WAV header/duration, verify original immutability and lack of inherited private grant fields, confirmed independent download, logout URL revocation.

**Not in scope:** destructive in-place trim, audio denoising/effects, waveform rendering, assignment-derived retention policy, 3rd-party codecs, native Safari acceptance or full video trimming.
