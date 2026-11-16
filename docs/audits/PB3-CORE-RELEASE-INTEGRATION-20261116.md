# PB3 — core journeys integration, 16 November 2026

**Status: IN PROGRESS — not a merge/readiness certificate.** The owner explicitly authorized integration into remote and local main after verification. Main baseline: `8ed66c438d090efd218efa80b027f0b2f854db4b`.

One integration branch preserves #416, #417, #418, #419 and #420, the #412 frontend, donor `783b6a7757b804d06d15426de2457f94e37ca741`, logout barriers #402/#403 and independent safety QA. The full prior PR/Issue/Git audit is retained as a historical snapshot, including its then-current blockers. No original branch, data or immutable UX source is deleted.

Implemented in this candidate: Camera→encrypted outbox→Garage→Browser/Viewer/Recovery; accepted Welcome/Loader/PIN surfaces; authenticated PIN enrollment/change/disable/relock delay; separately encrypted, explicitly reviewed personal-JPEG Public Card with TTL/revoke and Recovery Key owner management. Publication protocol and limitations: [ADR](../adr/2026-11-16-personal-photo-public-card.md).

Emergency PIN destructive processing is **BLOCKED / disabled**: an intent or local lock is not server revocation, physical cloud deletion or preserved Recovery Vault backup. Matrix, full backup/Panic, payment settlement, native hardware and signed cold offline PWA are not claimed as completed by this slice.

Diagnostics identified distinct harness/environment errors: Linux Docker cannot use macOS native Rollup dependencies; Vite HMR query URLs can create a second Identity module in tests importing bare `/src` URLs; legacy upload tests must open the approved Header bottom sheet; Camera preflight now opens its own corrective sheet and renders customer messages/closed category selects; clearing all native permissions also ends camera tracks on macOS. These are addressed without disabling assertions, changing security floors, forging network ACKs or exposing original media.

Final exact commits, test exits, source/image hashes, sanitized evidence, main merge result and local Docker package links will be recorded here after the final gates complete.
