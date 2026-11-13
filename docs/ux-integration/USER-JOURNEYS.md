# User journeys & acceptance checks — PB3 UX graph

This is a **test plan**, NOT a PASS report. Design baselines: PB2 PR #56 imported to PB3 #135. Runtime observations are pinned to PB3 Draft #134; other open PRs are not implicitly included. Tests must use genuine local encrypted state, ACL, backend operations and confirmed server state where the journey requires them.

## Review process

For each journey, verify in sequence: **(1)** correct accepted screen/version, **(2)** selected action and destination, **(3)** data/object continuity, **(4)** Back/overlay/scroll/draft, **(5)** account, permissions, TTL and identity changes, **(6)** offline/retry/restore, **(7)** mobile/desktop. Capture the exact commit, browser/device and evidence. Demo fixture interaction counts only as `prototype behavior`; screenshots count as visual review, never E2EE/authorization proof.

| ID | Journey / steps | Critical assertions & negative tests | Edges | Current status |
|---|---|---|---|---|
| J-01 | Fresh user: S01 Welcome → create anonymous key → S02 Loader → Shell; recovery on another device | No email/password, key must be saved, no false network success, local state retained; test offline reload & stale/revoked account | N-01, N-02 | NOT END-TO-END VERIFIED |
| J-02 | Existing user with configured PIN: S02 → S03 → Shell or S04 → S01 on confirmed failure | PIN 4–8, correct normal/emergency distinction; network timeout does not falsely claim account deletion, no Shell on error | N-03, N-04, N-37 | NOT END-TO-END VERIFIED |
| J-03 | Create assignment S05 → S06 (four tabs) → choose participant from Contacts/Teams → return → save; go S11 to capture | Same assignment ID and signed policy/role, correct media types and schedule, no discarded draft; revoked/unauthorized members denied | N-06, N-07, N-10–N-12 | PARTIAL RUNTIME; UX NOT VERIFIED |
| J-04 | Assignment S05 → scoped Browser S07 → select file S08 → Back to exact folder | Scope only this assignment; same file, filter/sort/scroll, keyboard Back/active Dock tap, no unauthorized neighbor navigation | N-08, N-15–N-17 | PARTIAL RUNTIME; UX NOT VERIFIED |
| J-05 | Capture S11 photo with GPS/requirements → local ciphertext/outbox → close/reopen offline → sync → S07 → S08 | No OS gallery, no plaintext exfiltration, queued ≠ server confirmed; verified attachment in correct assignment, expiry controls all states | N-07, N-14, N-15 | PARTIAL RUNTIME; UX NOT VERIFIED |
| J-06 | Viewer S08 photo → S09 Photo Editor → add text/shapes, Undo/Redo → Save/Cancel → same Viewer/photo | Correct version/derivative; layers editable, unsaved guard, safe flat image; cannot download original if disallowed, Back context unchanged | N-18, N-20, N-17 | PARTIAL INLINE UI; UX NOT VERIFIED |
| J-07 | Viewer S08 video/audio → S10 trim/still/WAV → Save to S07 and reopen result | No fake demo IndexedDB; new encrypted file and correct MIME/time/size, original intact; stop playback on navigation | N-19, N-20, N-16 | PARTIAL INLINE UI; UX NOT VERIFIED |
| J-08 | File Viewer S08 → Public Card in-app preview → close → same file | Preview stays inside app in controlled layer; reflects assignment ceiling and file rules; **does not** create public URL | N-13, N-21, N-22 | TARGET UX; NOT VERIFIED |
| J-09 | Explicitly publish safe derivative → external S20 (no login) → share link → revoke/expire | Only permitted fields, safe asset, TTL, no original/EXIF/GPS without consent; external user denied after revoke; no stale CDN leak | N-23, N-24, N-25 | OPEN protocol; NOT IMPLEMENTED/VERIFIED |
| J-10 | Browser S07 one file vs multiple/whole assignment Share intent | Stop before writing until recipient, ACL, keys, scope, TTL & revocation decision is approved; never treat multi-file collection as single-card grant | N-26 | OPEN; DO NOT IMPLEMENT |
| J-11 | Contacts & Teams S12 → contact card → S13 Profile; add/block/unblock and return | Privacy-aware @username/#UserID (not UUID), exact contact/team rules, list tabs intact, blocked user not selectable | N-28, N-33 | PARTIAL RUNTIME; UX NOT VERIFIED |
| J-12 | Profile S13 → Write to S22 → fullscreen conversation → Back | Only real selected recipient; disabled WIP until integrated; room E2EE trust; inbox list preserved; external entry return behavior **OPEN** | N-29, N-42, N-43 | WIP + BETA; NOT VERIFIED |
| J-13 | Contact or Team S12 → individual/team S22 room → attach actual Browser file → recipient opens in Viewer | Device/key/room trust, team membership, encryption, local queued retry, restricted attachment scopes/TTL; no fake demo media item | N-30, N-32, N-44, N-45 | TARGET UX; MATRIX PAUSED |
| J-14 | App Appearance S14 choose Dock 3, 4, 5, 6 items → reorder, cancel/save → navigate and reload | Mandatory Profile at arbitrary position, no dup, accessible on 320px, active-tap Back **one level**, no lost section state | N-05, N-35 | TARGET UX; NOT VERIFIED |
| J-15 | Settings/Profile S13 → search `язык`, `language`, `dock` → S14 exact control | Scroll/focus **to control** not parent root; preserve search/Back; no duplicated Shell/settings values | N-34, N-36 | TARGET UX; NOT VERIFIED |
| J-16 | Notification S17 → open target (assignment, file, team, message) → Back | Type-safe destination, fresh ACL/TTL check, unread state; push contains no private filename/GPS/message text | N-39, N-46 | TARGET UX; NOT VERIFIED |
| J-17 | Data & Storage S16 → queue, backups and Browser archive S07 → restore/clean | Verified counters and limits; return to exact folder; no backup resurrection of expired/deleted media, correct GC/offline/error states | N-27, N-38, N-48 | TARGET/PARTIAL; NOT VERIFIED |
| J-18 | S18 plan selection → S19 Checkout → pending → confirmed or failed → S18 | Server-issued pricing/entitlements; no stale prototype prices; quote/payment idempotency; browser click cannot mark payment successful | N-36, N-40, N-41 | TARGET UX; NOT VERIFIED |
| J-19 | Security S15 → PIN/Recovery Key/emergency state → S03 or S04 | Local versus remote wipe distinguished; failed network no false destruction; secure device revoke and E2EE trust | N-37, N-04 | TARGET UX; NOT VERIFIED |
| J-20 | S13 Settings → S21 Help/FAQ/Legal → return | User-facing content not claim more security than verified; Terms/Privacy draft clearly tracked; no fake support send | N-36, N-47 | TARGET UX; TEXT DRAFT |
| J-21 | Media S07 → Viewer S08 mixed photo/video/audio → fullscreen, next, previous, Back | Stable layout; playback stops, pointercancel and Escape work, no 100-entry history, layout stable phone/desktop | N-15, N-16, N-17 | PARTIAL RUNTIME; UX NOT VERIFIED |
| J-22 | S12 Team → member menu, settings and linked assignment; remove participant, attempt stale actions | Correct role owner protections, no silent assignment deletion, epoch/membership recheck, disabled blocked controls | N-31, N-33 | PARTIAL RUNTIME; UX NOT VERIFIED |

## Required environment matrix

| Dimension | Minimum coverage |
|---|---|
| Devices | Chromium desktop, Android Chrome and iPhone Safari/PWA on physical devices for final acceptance; other platform claims explicitly NOT TESTED |
| Viewport | 320px, narrow phone, wider phone, tablet and desktop |
| Network | Online, interrupted request, offline after warm bootstrap, reload, retry, stale data; cold offline bootstrap is separately assessed, not presumed supported |
| Actors | Owner A, contributor/contact B, unknown public visitor C, revoked/blocked actor D; multiple devices for key recovery |
| Media | Photo, video, audio, vertical/horizontal, large record, safe derivative, original denied |
| Security | No grant, reduced scope, expired TTL, revoked, wrong team/role, changed key, stale authorization, duplicate request |
| Navigation | Touch/keyboard/Escape, pathbar Back, browser Back, Dock active-tap, modal/overlay Close, unsaved draft |
| Persistence | Encrypted local cache & outbox, successful cloud ACK, server reauth, new device, deletion/GC |

**Do not** mark a journey PASS unless the corresponding product route, real service and permission checks were exercised. If visual acceptance fails despite tests passing, keep UX gate FAIL; if product E2E fails despite matching screenshots, keep integration gate FAIL. 

## Minimal review evidence record template

```text
Journey: J-__
Edges: N-__
PB3 commit / PR:
Source UX: screen S__ / file + version:
Viewport and device:
Runtime: IMPLEMENTED | PARTIAL | NOT IMPLEMENTED
UI visual: PASS | FAIL | NOT TESTED
Interaction/Back: PASS | FAIL | NOT TESTED
ACL/E2EE/TTL: PASS | FAIL | BLOCKED | NOT TESTED
Offline/reload/retry: PASS | FAIL | NOT TESTED
Evidence links (test, screenshot/video, CI):
Known deviations / owner decision:
```

Full security and product launch gates remain in [PB3 requirements](../../ts.md) §25; this document supplements them with screen-to-screen traceability.
