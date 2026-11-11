# P2 File Viewer — video stop-frame to separate E2EE personal JPEG

**Status:** Draft code, acceptance gated by exact-head CI and independent native device tests.
**Reference:** approved `docs/_uiux/browser_video_audio_editor_fieldwork_1_1.html` video «Стоп-кадр» and `ts.md` P2 Browser/Viewer scope. This is not the whole video editor (trim/audio remain separate).

## Real user journey
1. Open authenticated/decrypted video in the File Viewer from the existing verified Local-First or Garage media path. Seek to the chosen moment with the native player.
2. **Создать стоп-кадр** takes only the CURRENT decoded video frame, bounds output to 4096px per axis and at most 16MP, converts in-browser to JPEG. Before user chooses a destination, the JPEG is **transient only**, held in memory via object URL. Not written to IndexedDB, OS gallery, S3 or network.
3. **Сохранить зашифрованно в Browser** explicitly creates a new JPEG MediaFile using existing client AES-GCM chunk encryption, key wrapping, signed immutable manifest and device-local durable outbox. Background sync remains independently acknowledged by server; app never claims cloud success from local success.
4. **Скачать JPEG на устройство** is a separate, confirmed action warning the user about plaintext outside the encrypted app. Saving in Browser never triggers an OS download.
5. Original video, its grants, assignment evidence, GPS and expiry remain unchanged; new JPEG is an independent **personal file** (no inherited assignment, grants, GPS, original TTL). Current MediaFile default TTL is 13 days; do not pretend derivative inherits origin retention.
6. Closing Viewer, navigating to another file, logging out or changing the session revokes temporary JPEG object URLs and invalidates asynchronous capture. Wrong-source video, absent frame, bad dimensions or encoding failure must fail closed.

## Security / acceptance criteria
- Capture is from the current verified blob URL only; no remote video URL or external conversion service. Never copy decrypted private metadata to plaintext URL/query.
- Names sanitized, bounded and time-stamped; optional metadata is not inherited. Independent grant creation must require later owner action, not implied by originating video.
- Unit: output pixel and time bounds, malformed dimensions, private filename sanitization.
- Real Chromium+PostgreSQL18+Garage: produce a REAL decodable WebM locally, encrypt it while warm offline, open it, capture JPEG after decode, verify no automatic download or new media before explicit save, decrypt generated image using the account key, check JPEG magic bytes and original immutability, explicit separate download, logout URL revocation.
- Safari/iOS video codecs, canvas frame access and OS share sheet are **NOT TESTED** by Chromium CI; native device review still required.

## Separate work
Video trimming, audio trimming/WAV, photo safe-area/editor and user-controlled derived retention are independent later flows; this PR does not imply those are implemented.
