# PB3 P2 #217 — native mobile evidence matrix preflight (CHAT-Y)

Date: 2026-11-14. Source: current `ts.md` §20, mobile scenario 18 in §25, P2/P4 §26; original Issue #217, separate release gate #242.

## Immutable boundary / provenance

- Accepted starting point: `main@8ed66c438d090efd218efa80b027f0b2f854db4b` (verified identical to live main before claim).
- Exclusive source: `scripts/device-acceptance/validate.mjs` and `validate.test.mjs`; distinct optional workflow `.github/workflows/p2-device-evidence-217.yml`.
- No application, mobile navigation, release control, Camera, E2EE, provisioning, user data, routes, configuration or original tests changed. No main merge, deployment or device access.
- Issue #302 START #6875523344 and Issue #217 exclusive CLAIM #6875530220; inspect final Draft PR HEAD and CI separately.

## What the validator actually checks

A *manually collected*, structured evidence manifest is syntactically checked against an **explicit expected 40-character commit SHA**. It requires one record each for physical installed iOS Safari PWA and Android Chrome PWA, independent OS/model/browser metadata, UTC observation time, every required #217 scenario, explicit PASS/FAIL/BLOCKED/NOT_TESTED, reason for untested/blocked, and scoped GitHub/`docs/audits/` evidence refs for PASS/FAIL. It rejects missing devices, simulators declared as such, incorrect SHA, missing/duplicate scenarios, missing proof references, non-HTTPS or query-bearing links. No user identity, GPS, Recovery Key, secret, photos or media contents are needed.

Use only when the true device operator has already collected evidence:

```sh
node scripts/device-acceptance/validate.mjs <private-or-redacted-evidence.json> <exact-tested-commit-sha>
```

**Critical:** A `schemaValid: true` result only means the JSON fields are internally complete. It does not inspect screenshots/logs, attest genuine hardware, verify authors/reviewers, confirm security behavior, inspect files, or transform any recorded `PASS` into accepted mobile evidence. Return field `independentDeviceAcceptance: NOT_VERIFIED` is intentionally invariant, even when every synthetic fixture result is labelled PASS. Human independent inspection on actual devices is mandatory.

## Coverage keys (not successful checks)

- Identity: welcome/recovery, authenticated reload.
- Camera/media: camera/microphone/GPS permissions, revoke GPS, encrypted photo/video/audio, editor export.
- UI: Browser/Viewer navigation, Dock 3–6/reorder, mandatory Profile, safe-area and keyboard, orientation, fullscreen Back.
- Local-First: warm offline encrypted outbox, cold offline boot (known possible design blocker).
- Messaging: fullscreen Messages behavior.

The scenarios enumerate required P2 native QA; they are NOT a replacement for the wider P4 release gate #242 (PIN emergency, SAS, full Matrix A→B, backup restore, trust anchor, failover).

## QA status (2026-11-14)

- Metadata unit tests: authored 13 Node tests with exclusively **synthetic fixtures**; exact-head CI outcome must be reported from actual GitHub Actions after Draft PR.
- Real iPhone Safari: **NOT TESTED** (no physical device session or OS/browser evidence).
- Real Android PWA: **NOT TESTED** (no physical device session or OS/browser evidence).
- Real background GPS, permission prompts, PWA install and cold offline: **NOT TESTED**.
- Actual E2EE, Matrix, backup/restore, PIN and release P4: **NOT TESTED** here.
- No sample report containing invented `PASS` was published.

## Conditions for full #217 / #242 acceptance

1. Owner/independent QA supplies physical iPhone and Android, exact OS/browser, installed PWA, current merged candidate HEAD, redacted device evidence and actual test results.
2. Inspect trace/video/log evidence individually, rerun negative and offline scenarios, document real `FAIL/BLOCKED/NOT TESTED` as release blockers; file scoped defects.
3. Cross-check app behavior, privacy/E2EE assertions and browser platform constraints externally; an evidence manifest can never approve a release.
4. Do **not** mark #217 or #242 fully accepted merely because this metadata contract CI passes.
