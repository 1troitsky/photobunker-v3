# P1-18 — real four-tab Assignment Editor (Fieldwork 2.2 integration slice)

**Status: Draft / CI pending.** Independent staged PR based on P1-17 [PR #35](https://github.com/1troitsky/photobunker-v3/pull/35), immutable commit `9f292eb6fd9d591887ec009e8f0bdbcfce26c2ec`. No changes to `main`, no merge/deploy/owner acceptance.

## Provenance and intent

Accepted UX: PB2 [docs/ux/assignments/editor/README.md](https://github.com/1troitsky/photobunker-new/blob/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux/assignments/editor/README.md) and approved static HTML 2.2. PB3 `ts.md` §11.2 takes precedence for product/crypto semantics. This change is a **real functional screen** based on four-tab structure, **NOT a pixel-identical transplant** and not a claim that all accepted toggles are implemented.

## User journey and integration

- Owner opens a real assignment card from `/assignments`, then chooses `Редактор · 4 вкладки`. New `/assignments/:assignmentId/edit` reuses existing Shell Header and Dock, not a second fake app wrapper. Desktop/mobile tabs: **Основное / Файлы / Участники / Правила**. Keyboard Left/Right/Home/End and roving tab-index supported. Sticky explicit Save/Cancel actions; disabled while no change or pending queue.
- Load **cached independently signed** owner-policy snapshot and open owner AEAD-encrypted title/instructions first; do not wait for HTTP. Then fetch fresh server listing with **cursor pagination**, verify owner-account signature and local key pin, and refresh the UI. Never present an unverified policy or another account's plaintext title. Offline is labelled **signed, potentially stale**.
- **Основное** displays real E2EE-only immutable name/instructions and authoritative signed start/end/status. No editable title or scheduling field is falsely promised: these need versioned encrypted amendment and lifecycle contracts not in current P1.
- **Файлы** edits working signed v6 per-kind allowed photo/video/audio and photo/video/audio progress goals. Photo remains mandatory under PB3 original root contract, even though the accepted Fieldwork v2.2 design allows photo off: **protocol gap, not silently bypassed**. Goal changes do NOT cap additional uploads.
- **Участники** performs actual independent key fingerprint verification and signed contributor invitation. It never grants a media DEK merely because an invitation exists. Other roles, teams, contact search and more granular scopes require future verified backend work; fake controls and mock participants are intentionally excluded.
- **Правила** edits live per-kind mandatory category, description-minimum, GPS, owner-signed public category vocabulary and required tag vocabulary. Actual file category/tags/GPS/description remain AES-GCM protected in prior P1-17. All client inputs are validated in a **pure, separately Vitest-testable editor policy model** (no implicit autosave).
- **Подписать и сохранить правила**: if online, fetch the latest independently authenticated snapshot and reject stale `policyRevision` before signing. Use existing v6 canonical owner-account signing, append-only parent hashes, local-first durable operation outbox, server idempotency and conflict handling. If offline, sign against locally verified snapshot and queue; show pending, never fake server acceptance. Subsequent policy edits blocked until acknowledgment.
- Existing `/assignments` owner controls remain temporarily for compatibility with existing integration tests and user workflows. A real Chromium failure found that quickly opening a cached local card could leave these controls on a stale root policy after fresh owner-signed hydration. The existing form now automatically rebases **only untouched input fields**, preserves local dirty fields and blocks saving if the signed revision advanced. Next UI migration can remove the duplicate legacy owner form after this route is approved and tested, without affecting signed domain operations.

## Constraints / security

- No new server DB columns, migration, key format, media ACL expansion, plaintext indexing or trusted-timestamp claims.
- Changing `Основное` private content, schedules, auto-deletion, roles, Public Card ceilings, file edit scopes, and native mobile edit-first overlay are **not yet supported**. Do not display editable toggles pretending otherwise.
- Route does not touch `main`, silently merge PRs, or authorize uploads without per-file grants.
- Offline owner policy is *not proof of fresh current server authorization*. Server admission remains authoritative; queued edits can be refused on reconnect. One pending policy edit per assignment remains mandatory.
- Native Safari, iOS/Android hardware and pixel-level visual acceptance **not tested**. The accepted HTML remains read-only evidence.

## Acceptance / CI evidence checklist

- PHPUnit PHP 8.4/8.5, PostgreSQL 18/Garage and security floor remain passing.
- Pure Vitest tests exercise legacy v1 and signed v6 editor projection, full three-kind rules, disabled-kind clearing, progress boundaries and strict category/tag inputs.
- Chromium E2E passes A creates E2EE assignment, opens four-tab editor, verifies decrypted private title, tabs, no implicit autosave, signs an actual v6 owner policy revision with category/description constraints, checks server history receipt and continues the real two-account photo/audio/video E2EE submission journey with no regression.
- TypeScript production build and accessibility smoke for tab navigation.
