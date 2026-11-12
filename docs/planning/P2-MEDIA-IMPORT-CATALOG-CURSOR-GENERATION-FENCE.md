# P2 V-35 — MediaImportPanel cloud cursor and generation fence

**Status:** Draft, code written; exact-head CI pending. Parent [Draft #129](https://github.com/1troitsky/photobunker-v3/pull/129) @ `25052de8ba37704964675c947344a9feb1f03474`, **3/3 PASS** including PostgreSQL18/Garage/Chromium and 294 Vitest. All PR Draft, `main` untouched. Matrix paused.

## Why a separate MediaImportPanel gate?

Browser's top-level cloud P1/P2 index was hardened in V-34 (#129), but the *nested media import/operations panel* fetches `/media/v1` independently. Its `refresh()` trusted server JSON and its `more()` appended raw rows and nextCursor; a duplicated/stale/forged 50-row page could replace the visible catalog or append duplicate media. More importantly, requests had no per-call generation token: a slow older request completing after a more recent refresh (or reauthentication) could overwrite newer authorized rows despite a stable account.

## Scope

- Use the already tested `appendAuthenticatedCatalogPage()` to validate **both initial and continuing** P2 MediaFile authorized UUID pages: 50 max, ascending unique v4 UUID, no overlap/rollback, cursor must equal the last item of a complete nonfinal page, and proper terminal cursor. Never update `cloud` or `cursor` with malformed data. An error remains visible, and a later successfully verified refresh clears that warning.
- Add a **monotonic component catalog generation**. `refresh()`, `more()`, session updates and component teardown fence old asynchronous responses. Existing local encrypted file lists are refreshed independently and never removed due to a cloud-page failure. `more()` has its own paging busy state, avoiding interference with user media encryption/upload controls.
- A same-device session reauthentication retains typed private import metadata/GPS and already-owned ciphertext; switching accounts still clears the old account's volatile view. The server remains the authority for active personal file ACL and TTL. Signed manifests/AES-GCM authenticity are checked only on actual file reads; an authorized index is not cryptographic file provenance.
- No changes to E2EE key hierarchy, AES-GCM chunks, S3 names, personal original ownership, MediaFile manifests or server endpoints. No server-side plaintext search, archive GC, public cards, Matrix or billing.

## Acceptance proof

- Inherited Vitest V-34 `authenticated-catalog-page.test.ts` validates 50+2 for both P1 and P2, overlapping, duplicate, forged, short and repeated cursors.
- Extended actual Playwright A↔B: generate one real encrypted audio MediaFile, upload ciphertext and confirm Garage, restore account B by Recovery Key, verify private AES-GCM metadata-only search. Intercept B's *MediaImportPanel* list request and inject duplicate authorized ID; reject with visible error, retain exactly one previously authenticated cloud row; then remove injection and recover on normal refresh.
- Live-browser interleaving: delay an older first-list request, deliver a second successful authenticated list, release old stale empty page last; verified cloud row must remain one. Tests exercise real Vue client and API rather than directly setting in-memory session internals.
- Required exact-head PHP8.4/8.5, strict TypeScript/Vitest/build, security, PG18/Garage+Chromium CI; native Safari/iOS/Android and physical load test NOT TESTED.

No release, merge or operator-side destructive work.
