# P2 File Viewer — non-destructive photo crop + quarter rotation

**Status:** Draft P2, exact-head CI and native-device review still required. This implements one approved photo editing operation, **not** the complete Photo Editor 3.2.

## User journey
1. Open locally decrypted photo in File Viewer via the existing authenticated Camera photo or MediaFile protocol. The original object URL, image metadata and E2EE keys stay inside the current device.
2. Adjust left/top/width/height bounds on percentage sliders (minimum 10% each) and choose a 0/90/180/270° rotation. Preview a **new** JPEG image in volatile client memory using the current decoded image element. Output bounded to max 4096px per axis and max 16MP.
3. **Save encrypted in Browser** creates an independent personal `image/jpeg` MediaFile using existing account AES-GCM/signatures and offline-first durable ciphertext outbox. It never mutates the original or inherits its assignment/grants, GPS, original lifetime, or share scope. Local save and cloud ACK remain separate statuses.
4. **Download JPEG** requires a separate confirmation warning about plaintext outside protected storage; no automatic OS gallery write.
5. Changing crop bounds, navigating, logout or switching cryptographic root revokes temporary preview URLs and invalidates pending rendering. Invalid crop percentages, unknown source, decoder or canvas errors fail closed.

## Limits and verification
- This is **cropping + quarter-turn rotation**, not privacy-safe masking, text drawing, shape edits, undos, safe version publish, or original replacement. Do not claim that cropping alone conceals sensitive pixels outside the exported frame unless explicitly reviewed.
- Pure tests for crop math, bounds, rotation geometry, no upscaling, 4096px/16MP caps and sanitized private filenames.
- Real Chromium/PG18/Garage: generate genuine 200×100 JPEG with visible split-color test image on device, encrypt while warm offline, verify authenticated Viewer, select 10/10/50/60 crop and 90° rotation, preview real 60×100 JPEG without an automatic upload or OS download; explicitly queue AES-GCM MediaFile derivative, decrypt and validate JPEG/dimensions/metadata isolation; separately confirm OS download and logout revocation.
- Native Safari/iOS, extreme dimensions, original policy/TTL handling, full Photo Editor 3.2 and owner acceptance remain separate gates.
