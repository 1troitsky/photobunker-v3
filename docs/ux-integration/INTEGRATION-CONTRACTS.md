# PB3 UI integration contracts — v0 mapping baseline

**Nature:** reviewed integration design and verification obligations, **not** an assertion these contracts are already implemented. These contracts express or refine the behavior of [PB3 ts.md](../../ts.md), the [PB2 approved shell](../ux/UI-SHELL-CONTRACT.md) and the per-screen README files imported in #135. A component may implement the contract differently internally as long as observable semantics are preserved.

## C-01 — single App Shell / responsive hierarchy

- One Header (64px target), status controller, content scroll surface, and configurable bottom Dock (82px + safe area); screens **must not ship cloned independent Header/Dock** from standalone HTML.
- Dock default: Assignments / Browser / Camera / Contacts / Profile & Settings; user choice 3–6 from seven items, one mandatory movable Profile/Settings, no duplicates; save/cancel restores persisted state. Active-tap Back one level within the active section.
- Exceptions with **no authenticated Shell**: Welcome/Loader/PIN/Authorization Error and *external* Public Card. A Messages conversation overlays Shell entirely on mobile/desktop; its inbox remains under Shell.
- Overlays and pathbar are shared primitives: focus capture/return, Escape/Back, pointercancel, reduced-motion, keyboard/safe-area responsiveness.
- **Sources:** [Shell](../ux/UI-SHELL-CONTRACT.md), [Appearance 1.3](../ux/app-appearance/README.md), [Messages Beta](../ux/messages/README.md). **Edges:** N-05, N-35, N-42, N-43.

## C-02 — navigation intent, restore, no accidental data loss

A navigation intent should carry `originSection`, `returnTarget`, stable object IDs, route-specific selection, and only non-secret **display-independent** context. For Browser additionally preserve folder scope, active assignment filter, search mode/query (according to local encryption policy), sorting, media order and scroll anchor; for editors: selected media, draft, active tab and unsaved-change guard. For Messages preserve inbox scroll and draft while opening/closing overlay.

- Technical UUID/path is not a user-facing NAME-ID or #UserID. Do not encode secret metadata in publicly shareable URL params, telemetry or external history.
- Opening adjacent Viewer items must not append one browser-history entry per arrow/swipe; explicit user Back honors layer precedence and returns to the originating scope.
- Runtime on Draft #134 has `/browser/file/:protocol/:id` and `/assignments/:assignmentId/edit`; a **route is not evidence** of complete navigation persistence.
- **Sources:** [Viewer](../ux/browser/viewer/README.md), [Editor](../ux/browser/editor/README.md), [Shell](../ux/UI-SHELL-CONTRACT.md). **Edges:** N-06, N-15–N-20, N-34, N-43.

## C-03 — stable file identity / mixed-media catalog

A selected media reference needs **opaque ID, protocol/media kind, media version or revision, owning account/workspace scope, and verified effective access**. A visible NAME-ID is a display identifier, not an access token.

- The same selected media flows Browser → Viewer → correct Editor → Viewer/Browser. Mixed photo/video/audio neighbor list is scoped and ordered; switching items stops old playback.
- A derivative/stop-frame creates a **new identity and verified encrypted record**, not fake insertion into a demo array; immutable versions/revision lineage must be preserved where required. A "save to Browser" action is not complete before encrypted outbox + eventual server confirmation.
- NEVER reuse demo IndexedDB `fieldwork-file-editor-browser-v1` as PB3's storage truth; preserve source's TTL, role restrictions, category/tag policy and safe/original distinction.
- **Sources:** [Browser](../ux/browser/README.md), [Viewer](../ux/browser/viewer/README.md), [Video/Audio Editor](../ux/browser/media-editor/README.md), [Photo Editor](../ux/browser/editor/README.md). **Edges:** N-14–N-20, N-48.

## C-04 — Local-First / offline operation state

- Local UI and available **encrypted** data open without HTTP and without losing outbox/drafts when refreshed. Status must distinguish `locally saved`, `queued`, `uploading`, `cloud confirmed`, `published`, `expired/revoked`, and `failed`.
- On retry/reload, do not double-create files, assignments, messages or grants. Server status is never simulated. Changes of account/device/key terminate stale decrypt/promise results.
- On auth/policy uncertainty, **fail closed** for authorization: offline availability of a ciphertext does not grant access to missing/expired/revoked content.
- **Sources:** [PB3](../../ts.md) §§1, 20, 25; [Browser](../ux/browser/README.md); [Messages Beta](../ux/messages/README.md). **Edges:** N-14–N-17, N-38, N-43, N-45.

## C-05 — assignment scoping, membership and capture

- Assignment ID, its signed current policy revision, role, allowed types, schedule, requirements (category, GPS, metadata), participant grants and retention must be verified at **capture AND submission**; no relying solely on toggles rendered during creation.
- Assignment Editor Media **2.2** tabs are **Основное / Файлы / Участники / Правила**. This replaces old editor tab naming; detail page remains an unapproved UX.
- Camera receives an explicit assignment context and preserves private instructions only for authorized participants. Media appears in the correct assignment-scope Browser after local encryption and eventual verified sync.
- Selecting members in editor derives from real Contacts/Teams with consent, not a synthetic array or accidental team membership.
- **Sources:** [Assignments 5](../ux/assignments/v5/README.md), [Editor 2.2](../ux/assignments/editor/README.md), [Camera](../ux/camera/README.md), [Contacts/Teams](../ux/contacts-teams/README.md). **Edges:** N-06–N-14, N-31.

## C-06 — Public Card: three independent permissions

1. **Assignment ceiling** defines the *maximum* fields the author may later publish. It does not publish.
2. **Per-file policy** narrows that ceiling. A preview checkbox does not publish.
3. **Public grant/token** must be explicitly created and validated at request time against effective media scopes, account/assignment/file ACL, TTL and revocation.

The effective permission is the intersection of the above plus current retention and media-safe policy; never widen any of them. Public Card serves a **separate safe flattened asset** without leaked EXIF, original or unapproved GPS. Full/restricted/viewOnly/expired are *views of effective permissions*, not authorizations from a frontend selector.

- Preview in app is **not** public publication. External card uses no authenticated App Shell, and an unknown visitor must only fetch explicitly public data; no third-party map without allowed location **and user action**.
- Public link structure, delivery of E2EE-safe media, multi-file/whole-assignment Share, downloading rights, and video/audio availability have **OPEN** product decisions. Never build a multi-file Share flow by aliasing a single-file card.
- **Sources:** [Assignment Editor](../ux/assignments/editor/README.md), [Photo Editor](../ux/browser/editor/README.md), [Public Card](../ux/public-card/README.md), [Sharing open](../ux/browser/SHARING-OPEN-QUESTIONS.md). **Edges:** N-13, N-21–N-26.

## C-07 — contact/profile identity vs team vs Matrix

- Keep **separate** internal account UUID, immutable public eight-digit #UserID, public @username, contact record, team membership, team role, and Matrix user/room identity. A string match is not authority.
- Contact/profile search honors privacy; private/blocked users may be hidden. Team access must be verified against current effective membership and cryptographic epoch; removing a contact is not automatically removing membership.
- Direct-chat intent from profile/contact needs confirmed recipient identity and room binding, including pending/no room, blocked, offline, revoked and multi-device states. Messages **1.1 Beta** provides the conversation UX, not the mapping by itself. Matrix integration can remain deferred while edge is documented.
- Profile 1.6 is **WIP**, and its "Написать" button is disabled in the HTML. Do not silently change its final behavior or invent phone calling in PB3.
- **Sources:** [Contacts/Teams](../ux/contacts-teams/README.md), [Profile WIP](../ux/settings-profile/README.md), [Messages Beta](../ux/messages/README.md), [PB3](../../ts.md) §16. **Edges:** N-28–N-33, N-42–N-45.

## C-08 — Messenger overlay, attachments and recovery

- Message list = Shell. Actual conversation = accessible fullscreen modal overlay **above** Shell, mobile and desktop. Close returns to same inbox and scroll with drafts unaffected. For *external entry* from Profile/Contacts, final return-to-origin behavior remains open (GAP-04).
- Attachments must be selected from real allowed Browser media; transfer only authorized encrypted media/grants and attach proof rather than a demo media descriptor. The recipient rechecks scopes/TTL on open. Text, voice, reply, reaction, edit, redact, forward and statuses require persistent local-first and Matrix delivery evidence.
- Matrix SDK/adapter, room/device trust, Recovery Key envelopes, offline outbox and key rotation are transport/security boundaries. Do not claim E2EE from an animated bubble or successful local demo send.
- **Sources:** [Messages Beta](../ux/messages/README.md), [PB3](../../ts.md) §16, [Browser](../ux/browser/README.md). **Edges:** N-29–N-32, N-42–N-45.

## C-09 — Notifications and deep targets

- A notification has a **typed target**, stable opaque ID, generation/epoch where relevant, and a safe fallback for missing/deleted/expired/blocked content. Reauthenticate/reverify permissions when opening; never trust a push payload as authority.
- No plaintext file names, personal chat text, private GPS, Recovery Key or hidden assignment details in unencrypted push. Notification settings are tied to their own UI section and user consent.
- **Sources:** [Notifications](../ux/notifications/README.md), [PB3](../../ts.md) §17. **Edges:** N-39, N-46.

## C-10 — settings and plan state shared across screens

- One search index for settings with direct **control** deep-link/scroll/focus (not just parent page); RU/EN synonyms incl language/язык, dock/док and theme/тема.
- Appearance Dock position/order and theme/font/launch page are unified preferences; all screen implementations subscribe to the same source without recreating Shell.
- Tariff figures in historical Payments 1.1 HTML are obsolete, must be loaded from **PB3 config-driven plan definitions**, and backend entitlements bound every relevant upload, assignment, backup, share and retention operation. Checkout order/quote state must be authenticated and idempotent; a UI click/redirect never activates a subscription.
- **Sources:** [Appearance](../ux/app-appearance/README.md), [Storage](../ux/data-storage/README.md), [Tariffs](../ux/payments-tariffs/README.md), [Checkout](../ux/payments-tariffs/checkout/README.md), [PB3](../../ts.md) §§8, 19. **Edges:** N-34–N-41.

## C-11 — destructive actions / emergency / expiry

- PIN, Emergency PIN and Recovery Key UI must only report confirmed outcomes. UI must not claim network timeout = device revoked, emergency action = physically erased cloud, or local cache loss = account deleted.
- Deletion/Archive/Restore/Backup must reconcile tombstone, TTL, retention and backups; restoring from backup never resurrects revoked/expired records.
- Destructive gestures/buttons require confirmation, authorization and idempotency; dispose media players/object URLs and scrub transient plaintext when navigation/identity closes its scope.
- **Sources:** [Security](../ux/security-privacy/README.md), [PIN](../ux/pin-shell/README.md), [Authorization Error](../ux/authorization-error/README.md), [Browser](../ux/browser/README.md), [Data Storage](../ux/data-storage/README.md). **Edges:** N-04, N-37, N-38, N-48.

## C-12 — contract acceptance checklist

Each integrated edge/contract gets a small evidence record:

| Field | Required evidence |
|---|---|
| Baseline | Exactly linked UX README and accepted/selected HTML version + source SHA; note Beta/WIP |
| Code | Specific PB3 commit, route/component(s), data model and API |
| Route | Correct click and Back/overlay behavior, mobile 320px–desktop, keyboard/gestures |
| Identity | Immutable IDs, auth/ACL/TTL/encrypted scopes incl rejected/deleted inputs |
| Offline | Cold/warm state per requirements, retry, reload, duplicate prevention |
| Privacy | No unauthorized original/EXIF/GPS/chat text, plaintext persistence or public leakage |
| Test | Automated tests, manual real device evidence and **NOT TESTED** where absent |
| Owner | UX revision approval separately from verified integration acceptance |

Evidence status transitions: **SPECIFIED → IMPLEMENTED → INTEGRATED → INDEPENDENTLY VERIFIED → OWNER ACCEPTED**. A successful unit test alone is not a release gate. See [USER-JOURNEYS.md](USER-JOURNEYS.md).
