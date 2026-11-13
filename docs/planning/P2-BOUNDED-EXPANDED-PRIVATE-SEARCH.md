# P2 V-33 — opt-in bounded private search across additional cloud catalog pages

**Status:** Draft, code written; exact-head CI pending. Parent #127 @ `0a99ce1892a0e71adc1adfe2472cb447ab64ec64` (**3/3 workflow PASS, 285/285 Vitest, 41/41 Chromium**). `main` unchanged, Matrix paused, no public card/guest access or physical GC. This is a narrow additive change to the accepted Browser search behavior, not a new plaintext index.

## Actual gap

Browser private search from Draft #93 checks at most **200 of the rows already loaded in the active tab/folder**. Selecting «Все папки» from #94 does not fetch further server pages. For an account with 201+ loaded files or a cloud-only file on page 2+, a successful search could be silently misleading unless the user noticed the partial-coverage counter. All file names, descriptions, categories, GPS and tags must remain E2EE.

## Chosen safe, non-default behavior

- **Default remains 200 currently loaded rows**, unchanged. A user may explicitly click «Проверить больше файлов (до 1000)» for a valid (2–160 normalized character) private query, authenticated online session, and active Browser tab.
- Only the previously existing, account-authenticated **`GET /photos/v1` and `GET /media/v1` opaque indexes** are fetched. There is no search-string, folder path, decrypted metadata, filename, tag, GPS or raw file data in the request URL or POST body. Each protocol fetch is capped at **10 pages × 50 = 500 opaque records**, with strict increasing UUID cursor, full-page continuation, no repeated/rollback IDs, and a hard stop.
- The authenticated index rows remain ephemeral Vue state, not a plaintext search index. Previously loaded larger indexes are **not erased** by the bounded scan. Old local media originals, encrypted outbox and unsynced uploads remain untouched. Per-file metadata is still independently decrypted and verified only in the browser by the original `searchPrivateMetadata()` code; no file data chunks are fetched to search filename/category/description/tags.
- For **at most 1000 currently loaded eligible** P1/P2 rows, the private search runs sequential AES-GCM metadata-only batches of **200** (and max three parallel reads inside each batch). Search query, match IDs, private text and progress remain volatile. Existing account/session and query-epoch cancellation applies within and between batches. No decrypted metadata or user search terms are written to IndexedDB, localStorage, URLs, telemetry or backend.
- The UI explicitly distinguishes «Все папки (загруженные файлы)» from the **whole account**; an incomplete 10-page cloud enumeration or file count over 1000 is reported as incomplete, not falsely "not found". It does not search additional cloud pages indefinitely, decrypt unselected media content, index other accounts, or permit public guest grants. Archives continue through their **separate authorized index**; this is not a full archived-item search.
- Changing query, account, tab, component, or refreshing aborts an in-flight expansion before any new result is published. A failed page/cursor must not partially publish extra cloud rows. The user can still use the existing manual «Загрузить ещё» index controls, and search never changes virtual folder placement or file ACL/TTL.

## Evidence / acceptance

- Vitest: strict 50+2 opaque index page continuation; 500 bound with truthful `complete=false`, replayed/forged/duplicate/rollback and truncated cursors, session cancellation, file #205 private metadata match, no plaintext query provided to mock cloud metadata fetch, 200-per-batch progress and cross-batch cancel/1000 bound.
- Chromium: existing real two-device Recovery Key and encrypted cloud-only audio search; explicit expanded-index action, unchanged AES-GCM match and no private query in *any* `/media/v1` or `/photos/v1` HTTP request.
- Required exact-head PHP 8.4.27+/8.5.12+, strict TypeScript/Vitest/build, Security, PostgreSQL 18/Garage/Chromium. Not native Safari/iOS/Android, not product-owner acceptance, not performance-tested at 1000 remote metadata decryptions and **not** a complete account-wide index or search.
- Remaining future work: UX/performance/energy acceptance for streaming all server pages, user-visible manual cancellation/virtualized result navigation, private archived cloud search, and optional encrypted client-side search index with safe invalidation after revoke/recovery/key rotation. None is claimed implemented here.

No merge, deployment, physical deletion, public tokens, Matrix work or key migration.
