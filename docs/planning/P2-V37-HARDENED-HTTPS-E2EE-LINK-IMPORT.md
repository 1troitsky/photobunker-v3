# P2 V-37 — explicit browser-only HTTPS URL to durable AES-GCM MediaFile import

**Status:** Draft, code written, exact-head CI pending. Parent [Draft #131](https://github.com/1troitsky/photobunker-v3/pull/131) @ `7a7c186f3d2527f5ec9199d67099c1d11b7042d0` (**3/3 PASS, 298/298 Vitest, 42/42 Chromium**). **No merge or deploy**; `main` unchanged and Matrix paused.

## Owner-accepted scope and exposure

Accepted Browser v3 UX, `1troitsky/photobunker-new` PR #56 @ `daca24a4a38c62473859b2b54b4999d50400c491`, `docs/ux/browser/README.md` §4: «По ссылке: прямая HTTPS-ссылка на файл. HTML делает запрос из браузера; источники с CORS, авторизацией или ссылкой на веб-страницу вместо файла могут быть недоступны». V-37 implements that narrow **direct browser** mode, not a server-proxy URL fetcher.

The external origin **learns the browser's network IP, the requested URL and request time**. No product anonymity, proxy masking or SSRF-perfect host validation can be promised. User sees this warning **before explicitly clicking** the fetch button; no automatic fetching, no background sync, no prefetch on typing.

## Security contract / failure closed

- Only absolute, syntactically unambiguous HTTPS URLs with valid **public-looking DNS hostnames**, normal HTTPS port 443, no embedded username/password, fragments or backslash, control/whitespace syntax; explicitly block IPv4/IPv6 literals and `localhost`, `.localhost`, `.local`, `.internal`, test/nonpublic suffixes, alternate ports. **DNS rebinding to private addresses cannot be independently ruled out by browser JavaScript; this is a known boundary, not SSRF-proof validation**. Browser PNA/CORS protections and response-origin contract remain necessary; server does not fetch arbitrary URLs.
- Browser `fetch` uses **GET / CORS / credentials:omit / redirect:error / referrerPolicy:no-referrer / cache:no-store**. No product cookies, authorization header, Recovery Key, AES-GCM DEK, account/device ID, signed grant, or referrer is sent. Strictly require `200`, same final response URL and no redirect/opaque response. CORS must be permitted by the source. Direct links requiring login, an HTTP redirect, page HTML, ZIP or `application/octet-stream` fail safely.
- Explicit MIME allowlist equal to current MediaFile image/video/audio types; MIME is a browser-readable HTTP response header, not independent magic-byte/file provenance. The accepted UX does not promise authenticity of third-party content. File extension is canonicalized from MIME, path-based safe stem is restricted to 120 characters; original URL query/fragment is **not** copied into the name.
- **32 MiB per HTTPS download** *operational memory cap* (not tariff/S3 entitlement): reject Content-Length above cap/invalid or less than 128 bytes, reject the *actual decoded stream* as soon as it crosses cap even with missing/dishonest header, and refuse mismatched reported lengths. Use `ReadableStream`, show progress and permit cancellation during download. No partial blob is queued on a failed stream or identity change.
- Downloaded plaintext bytes only live in transient browser memory until the existing `enqueueEncryptedMedia()` generates independent AES-GCM chunks, private encrypted filename/metadata, signed manifest and a **durable Local-First outbox row**. Source URL never joins the outbox operation or server API, localStorage, telemetry, Gallery or cloud metadata. The client-supplied category/tags/description/GPS and **destination folder snapshot** use the exact existing #131 encryption and encrypted workspace placement path. No OS gallery export/write.
- On link fetch or encryption error, show a concise non-echoed error (never include the original URL or token). Retain the typed link for retry, clear it after durable successful enqueue and on account switch/unmount. Other personal encrypted files and outbox are untouched; no cloud success is simulated.
- Input is explicitly online-only. Offline local files and imported media can still be viewed/queued independently. Actual S3/Garage upload still uses the **separate explicit "Отправить медиа"** action, real signature/ACK and quota.

## Verification

- Vitest: normal source with secret token in URL; no credential/cookie/referrer/redirect; filename excludes token; forbidden local/IP/credentials/ports/non-HTTPS; non-200/opaque/moved/HTML; bogus or missing/oversized content-length and endless decoded stream; stop on abort or account change; CORS/network errors do not echo secret.
- Chromium with real disposable Laravel13/PostgreSQL18/Garage: account creates encrypted virtual folder, directs a CORS-enabled HTTPS fixture to browser, sees no HTTP until explicit click, verifies only one original AES-GCM outbox + matching encrypted metadata/folder, no private URL/token in PB3 API, real Garage ACK, recovery on second device decrypts correct 8192-byte original. Separate test attempts `https://127.0.0.1/` and asserts browser makes **zero** requests and no media is created.
- **Not tested:** physical iOS Safari/Android, slow/mobile 32-MiB memory/energy, exotic HTTPS servers/COEP/Private Network Access, DNS rebinding. No server-side URL ingest, unknown-origin S3, proxies, link login, arbitrary Content-Disposition handling or external-provider retry orchestration.

No public anonymous shares, public tokens, Matrix, physical cleanup, billing changes or deployment.
