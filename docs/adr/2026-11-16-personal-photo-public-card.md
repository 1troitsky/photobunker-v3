# Personal-photo Public Card v1

Owner instruction, 2026-11-16: deliver real photo capture/browser/viewer, Public Card, Welcome/Loader and PIN, then integrate verified code into main. This document defines the narrow JPEG publication implemented for that instruction; it does not activate the other OPEN scopes in ts.md §18.

## Explicit publication and independent safe bytes

Only a currently owned, active, unexpired personal JPEG/photo source is eligible. Assignment captures, contributor submissions, active editorial associations and existing preview-policy v1 records saying publication disabled are refused. Neither an accepted assignment nor a recipient grant is publication authority. Assignment-wide/bundle/multiple-file/video/audio publication remains disabled.

The owner explicitly opens the publication dialog, reviews a newly decoded, Canvas-flattened JPEG, and acknowledges the exact prepared bytes. JPEG marker validation rejects EXIF/XMP/ICC/comment/trailing content. Visible sensitive pixels require human review. No private metadata is copied by default: the public title is generic; a caption is separately entered for publication. GPS, source filename, tags, author/team and timestamps are not projected.

The separate safe JPEG and caption are encrypted under a fresh random 256-bit AES-GCM key, never under a media original DEK. The AAD binds the card ID, source contract hash, TTL and download permission. A signed account-key grant additionally binds source kind/ID, ciphertext digest/size, dimensions, IV, token hash and encrypted owner capability. Transport is same-origin, authenticated, CSRF/Origin protected for owner mutations. There is no anonymous original/media-object endpoint.

The public address is `/p/<random-256-bit-token>#key=<independent-256-bit-key>`. Only SHA-256(token) is stored for lookup. The fragment is never sent in HTTP. The server/Garage receive ciphertext, not the public decryption key, plaintext JPEG, caption or private account keys. An account-AKEK-encrypted capability envelope, with separate AAD `pb3.public-card.v1\nowner-capability\n<id>`, lets another genuine Recovery Key device recover/manage the link. It does not disclose the account AKEK to the server or visitor.

## TTL, ACL, retries and denial

Link TTL is at most 24 hours and never exceeds the source TTL. The UI offers one or 24 hours, capped by source retention. Each public read checks current account, source ownership/hash/state, assignment restrictions, archive state, link state and TTL; the server rechecks after Garage I/O. The client validates the signature/digest/AEAD/JPEG and clears on expiry, denial, route change or unmount. No-store, no-referrer and no original key/export apply.

Reserve and payload upload retry the same signed ID/bytes; a lost ACK cannot issue a second logical publication. An encrypted durable browser outbox exists before upload. Revoke is account-signed and idempotent; a revoked ID cannot be re-reserved or reactivated by a late upload. A client only reports publication or revocation after the corresponding real server response. Ciphertext that remains physically stored still counts toward quota; logical revocation does not invent physical GC confirmation. Existing default-OFF destructive lifecycle gates remain in force.

Download is off by default and explicit owner opt-in enables only the reviewed JPEG download action. View-only is not DRM: a visitor can retain displayed pixels, and already acquired bytes/keys cannot be remotely erased. The public reader neither opens a saved device package nor asks for the owner's PIN. No third-party maps/analytics, Matrix connection, payment settlement or unsigned Service Worker are added.

## Acceptance boundary

PHP signature/TTL/replay/ACL/ciphertext negatives, real Chromium photo→Garage→anonymous read/reload/revoke, and independent Recovery Key owner management are mandatory. Unit fixtures are distinct from live Garage/browser acceptance. Native Safari/iOS/Android, full Public Card assignment projections, physical timed cleanup and a trusted signed offline bootstrap require their own evidence; none is inferred from this JPEG slice.
