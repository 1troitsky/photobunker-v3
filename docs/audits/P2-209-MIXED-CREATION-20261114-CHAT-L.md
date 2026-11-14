# PB3 — #209 signed two-phase mixed-media assignment creation · 2026-11-14

**Owner:** CHAT-L · [exclusive Issue #209 claim](https://github.com/1troitsky/photobunker-v3/issues/209#issuecomment-6872536639) · [parallel work journal #302](https://github.com/1troitsky/photobunker-v3/issues/302). Source baseline **main `5aaba8b0509c354f8abb00806180f4ce6cb6ad18`**, Laravel security patched by owner-authorized #326, post-merge 3/3 PASS. **Draft PR only — NO main merge or deployment.**

## Actual product gap

`AssignmentsView.vue` previously created an immutable **photo-only** signed root even though accepted code already supported later video/audio v6 signed policy changes and server-confirmed per-type progress. Server `AssignmentContract::creation` requires `allowedMedia:['photo']`. Simply adding toggles and claiming a new mixed root would forge the meaning of a signed policy and potentially let an executor submit media that the owner/server never authorized.

This slice implements **one user-visible creation intent, TWO independently accepted signed operations**:

1. User explicitly selects photo (always present under current verified root schema), optional video/audio, and optional progress goals: photos 1–9999, video/audio 1–999; the existing client signs the original v1 photo-only root with the encrypted private title/instructions. Only **public requested type flags and optional progress goals** (never private text/DEK/GPS) are kept locally in the already existing account-scoped Dexie `LocalAssignment.mixedCreation` record, atomically with signed root operation. No database schema or server signature change.
2. Existing durable outbox continues even after offline queue/reload. **Only after the root ACK and a fresh signed + independently verified server overview** is a second owner-signed v6 policy op created via the production `queueAssignmentPolicyChange`, with the original immutable root photoGoal, the selected allowed photo/video/audio types and independent progress goals; standard server revision CAS, signed policy requirements and TTL/ACL remain.
3. The v6 op is sent through the existing durable outbox. The local intent is cleared **ONLY if a subsequent freshly fetched, independently signature-verified server policy matches the requested media types and goals**. An outbox `sent` flag alone is never enough to call it accepted. Stale or contradictory owner-signed revisions, terminal 403/409/410/422, malformed data or account-change are fail-closed and remain inspectable as pending/conflict; no overwrite of newer policy and no phantom completion.
4. UI shows intent pending until server-confirmed permission, never counts pending materials in progress. Offline initial create renders the encrypted local draft immediately and does NOT await HTTP; explicit Sync or existing outbox online/visibility lifecycle can finish the two signed stages.

## Only changed paths

- `apps/web/src/features/assignments/domain/mixed-creation.ts` and `.test.ts`: canonical selection, limit validation, explicit stage machine with authoritative server policy requirement and mismatch fail-closed tests.
- `apps/web/src/features/assignments/application/assignment-outbox.ts`: durable account-scoped public intent in existing Dexie `LocalAssignment`, existing signed create and owner v6 CAS reuse, server signature verification before stage transition, automatic continuation through existing durable outbox, explicit read-only progress status.
- `apps/web/src/views/AssignmentsView.vue`: photo required while root v1 schema is immutable; explicit video/audio checkboxes/goals, Local-First creation and truthful in-progress card display. No false media permission or optimistic final count.
- `tests/e2e/p2-assignment-mixed-creation-209.spec.ts`: actual PostgreSQL/Garage/Chromium and user key-only identity. Create while warm-offline; show locally durable intent, zero plaintext title; restore online session, send original root, sign v6, verify both acknowledgements and immutable photo-only root, checked media goals, no duplicate policy; reload preserves accepted state, no extra operation. No mock server, fake signed policy, test disable or custom filesystem gallery.
- This audit report.

## Explicit limitations and security boundaries

- **This is a Stage-1 product slice, NOT full #209 accepted:** `allowedMedia` still must contain `photo`; video-only/audio-only root requires a separately reviewed signed protocol version and backend verification and is NOT implemented. The existing production v6 policy allows only canonical `['photo']`, `['photo','video']`, `['photo','audio']` or `['photo','video','audio']`. No auto grant for mere team/contact, no plaintext S3, no unsigned media permissions.
- Existing verified per-type receipt progress remains unchanged; true A-owner/B-contributor sustained video/audio capture to mobile Safari/Android, reviewer workflows, physical OS permission revoke/storage eviction, full 50m audio/300s video, real Matrix, Panic/Remote Wipe **NOT TESTED** in this slice. Existing #200 MediaFile is in review; #205/#206 source Draft partial. Independent consolidated AV QA [Draft #330](https://github.com/1troitsky/photobunker-v3/pull/330) exact HEAD `27778dd53c8b469337ba5176e1b51886b6f45e32` had 4/4 main-target CI PASS and 89/89 real E2E, but is **not merged** and not an acceptance substitute. This branch does not alter its source/files.
- No destructive migrations, own branch only, no changes to `main`, #330 source PR or foreign branches. A user may see a photo-only permitted root until the second server acceptance; UI explicitly discloses this.

## Exact-HEAD CI status at initial commit

**PENDING until independent workflow verification.** Require complete real Foundation (Composer Audit 0, PHP8.4/8.5 PHPUnit, Vitest, TS/build), real PostgreSQL 18 + Garage + Chromium including the new #209 offline → root ACK → v6 → second ACK/reload E2E, security and UX. Preserve any initial failed run/traces; do not replace failures with unverified PASS. Native iOS/Android marked NOT TESTED.

## Security addendum — offline public-intent anti-tamper (new candidate)

The persisted public media selection is now additionally protected by the owner's own P-256 account signature with independent domain `pb3.assignment-mixed-intent.v1\\n`. The canonical signed JSON binds `version=1`, exact `assignmentId`, exact `ownerAccountId`, SHA-256 of the **immutable original signed v1 ROOT contract**, requested canonical allowed media, and exact optional video/audio goals. The root+intent signature+intent JSON are stored atomically in the existing account-scoped Dexie transaction. Before automatic policy promotion the real app verifies all fields, original root hash, exact canonical serialization, and an imported trusted account public key. If this is absent, tampered or replayed from a different root, it writes an explicit local conflict error and **does not issue any v6 signing operation**. Only a verified intent can be promoted. Intent/signature/error are cleared only after verified, matching independent remote policy ACK.

The new actual-browser E2E includes a second malicious case: create a second valid signed root while offline, change only its `mixedCreation.videoGoal` in IndexedDB without the secret signing key, reconnect and verify **root v1 only**, zero owner policy operations, and persisted `assignment.mixed_intent_signature_invalid` instead of auto-signing a changed goal. This is not an E2E fake server or a crypto mock. No user private text, Recovery Key, or ciphertext is committed to QA evidence.

CI result must be checked on a NEW exact commit after this security gate; prior initial HEAD is not accepted as proof of this addition.
