# P4 #240 — isolated backend BrandConfig contract (CHAT-W, 2026-11-14)

## Base, ownership, exclusions

- Accepted base main: 8ed66c438d090efd218efa80b027f0b2f854db4b (#336).
- Exclusive issue #240 claim; shared journal #302; source web-brand Draft #268 already in accepted main.
- Own branch: feat/p4-240-backend-brand-contract-chat-w-20261114.
- Three NEW paths only: app/Branding/ValidatedBrand.php, tests/Feature/Branding/ValidatedBrandTest.php, this QA document.
- No existing backend config, API routes/controllers, billing, legal, PWA signing/service worker, front-end, crypto, account IDs, foreign branch, main or deployment edited.

## Delivered narrow contract

ValidatedBrand::fromConfig() reads the actual existing Laravel brand configuration (injected via env); fromArray() is a deterministic validation entry point; publicMetadata() returns safe, explicitly enumerated presentation metadata.

Rejects invalid slug/color, markup/control text, unsafe URL schemes, public HTTP, credentials, query/fragment secrets, non-origin APP_PUBLIC_URL and private/reserved IPs. HTTP loopback is an explicit local/testing-only exception. Optional HTTPS support URL may contain a path but cannot carry URL credentials or query secrets. No network activity, public endpoint, service registration or decryption occurs.

APP_PWA_ICONS is intentionally not interpreted: a separate signed-asset and independent trust-anchor gate is mandatory. Similarly this contract does not make legal texts approved, support delivery live, invoice settlement functional, public cards releasable or branding deployed. It is a safe independently testable backend foundation, not full #240 acceptance.

## Evidence

- Exact integration baseline: main 8ed66c438d090efd218efa80b027f0b2f854db4b.
- PHP local runtime is 8.4.24 (BELOW mandatory 8.4.27 security floor). Local PHPUnit cannot be used as acceptance evidence and is NOT TESTED.
- GitHub exact-head Foundation / Security / real PostgreSQL18+Garage+Chromium / UX workflow results: NOT TESTED until runs finish; record in issue/PR comments after verifying actual run jobs.
- Full #240 P4 release/mobile/install support: NOT TESTED/BLOCKED. Explicit owner authorization required for integration to main.
