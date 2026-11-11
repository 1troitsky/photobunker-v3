# P2 V-23 — P1 assignment access, confirmed count and receipt list use the same current membership

**State:** Draft / exact-head CI not yet validated. Stacked on Draft #118 at commit `3eea33570ea7858503c911699d33d419d05e12d7` (parent #117 and earlier #116–#111). No main merge/deploy, Matrix or physical GC.

## Observed inconsistency

The modern P2 Photo MediaFile path already checks `assignment_invites_v1.state='accepted'` on both owner submission listing, server-derived photo counts and recipient E2EE grant reads. The older P1 `photo_records` path admitted accepted contributors at grant/submission creation but, after that, filtered the owner submission list and confirmed counts only by photo/grant state and TTL. Its new read-time signed grant validator from #118 also lacked the ongoing contributor-membership predicate. A no-longer-accepted contributor could leave a still-live P1 assignment grant and confirmed photo counted/readable while an equivalent P2 photo would be denied.

## Narrow changes

- **P1 assignment-scoped v2 encrypted-photo grant:** after verifying immutable owner signature, current recipient exchange key, account status, assignment owner and retention from #118, require an accepted contributor invitation belonging to that exact assignment and owner. No implicit fallback to personal v1 access. Server detail, encrypted chunk stream and received listing all share this effective predicate. No re-signing, ciphertext mutation or DEK rotation.
- **Owner P1 receipts:** require a currently accepted contributor for each signed submission row in `GET /assignments/v1/:id/submissions`. Keep the max-50 cursor, owner-only authorization and original signed evidence from #116.
- **Progress:** apply the identical accepted-member predicate to the server-derived P1 `confirmed_photo_count` aggregate. User-facing progress can decrease when a contributor's membership is revoked; it is not an immutable historical count.
- **Personal v1 signed E2EE shares:** remain independently readable and are not silently transformed into assignment grants. A removed contributor's personal originals are never deleted. Signed P1 submit Lost ACK remains replayable; neither a replay nor an existing grant restores Fieldwork access.

## Tests / evidence

- PHPUnit `PhotoGrantTest`: an explicit v2 scoped grant becomes 410 for recipient detail and ciphertext reads when contributor status becomes nonaccepted, vanishes from recipient grant listing, while separately signed personal v1 grant still reads. Restoring accepted membership restores an otherwise live original v2 grant.
- PHPUnit `AssignmentV1Test`: a historical accepted P1 photo receipt and owner server count both disappear when accepted membership changes, then reappear if accepted status resumes. Stored signed receipt remains untouched.
- No new public grants, tokens, anonymous photo access, independent proof of GPS/camera authenticity or moderation/reputation mechanics.
- Release gate: exact-head PHP 8.4.27+/8.5.12+, Laravel/SQLite, PG18/Garage, Chromium E2E, Vue strict TS/Vitest and Security CI. Physical Safari/iOS/Android and independent product acceptance **NOT TESTED**.

**Caveat:** the current product does not yet expose a fully accepted participant-removal UI. The test toggles a synthetic accepted invitation state to exercise the existing server-side access boundary; this is defense against future membership removal and migration inconsistency, not a claim that a complete remove/revoke UX was shipped.
