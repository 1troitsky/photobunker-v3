# P2 V-18 — Owner MediaFile assignment receipt pagination

**Draft, not merged or deployable.** Parent P2 V-17 #113 at exact `19eca3bddc015a067af34e528e0baf506371f9fb`; #111 remains the signed P2 photo submission parent. Matrix paused.

## Actual UX gap

The existing authenticated API `GET /assignments/v1/:id/media-submissions?after=<UUID>` has a 50-row cursor, but the owner UI previously requested ONLY the first page. The assignment photo goal may be 9999, and the server-side confirmed total may exceed 50, so the owner could see only the initial 50 receipt rows despite a correct server counter.

## Incremental behavior

- First load remains a fast 50-row server page.
- If the server returns a next cursor, show a real **«Загрузить ещё материалы»** button. Each click retrieves one further authenticated page, never anticipates or invents result rows. Counts remain server-authoritative rather than list-derived.
- Validate monotonic immutable UUID cursor ordering, maximum 50 rows, no duplicates, and that a non-null next cursor matches the page's last entry. Reject stale, repeated, reverse or malformed pages before appending.
- Each new page passes the exact independent contributor signature verification from #113; missing pin, changed key or invalid receipt remains explicitly unverified. Already verified receipts survive pagination and only new receipt proofs are added.
- After changing assignment or account the screen resets its cursor and the stale async response cannot update the new selection. No huge 9999-row eager loading, media DEK, public metadata or physical GC.
- Legacy P1 `photo_records` owner submission endpoint still returns up to 50 without a cursor. That is explicitly **out of scope**, not silently claimed fixed.

## Verification / status

- Vitest: 50-row first page, 51st item on next page; malformed/backwards/nonmonotonic/replayed/duplicate cursor cases refused.
- Needs exact-head Vue strict TypeScript/Vitest, Laravel tests, PostgreSQL18/Garage+Chromium user acceptance, specifically many contributor P2 photo submissions and offline/online/cursor refresh. `main` is unchanged; no native Safari/iOS/Android validation. No CI PASS claimed.
