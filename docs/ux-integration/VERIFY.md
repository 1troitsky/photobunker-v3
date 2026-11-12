# How to independently verify the UX map

Run from any directory (Node.js 20+), inside PB3 clone:

```sh
node docs/ux-integration/verify-source.mjs
```

This script is **offline** and checks:
1. All **117 imported source files** against their original PB2 PR #56 Git blob SHA-1 and size in [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json); refuses missing, modified or extra files.
2. Relative Markdown links in all mapping documents (source paths, router, view components) resolve **within the PB3 checkout**.
3. Expected registry, navigation, contract, journey and gap IDs are present (S01–S22, N-01–N-48, C-01–C-12, J-01–J-22, GAP-01–GAP-18).

The manifest was built from immutable PB2 source commit `daca24a4a38c62473859b2b54b4999d50400c491`, compared to PB3 Draft #135 imported Git tree (117/117 same SHA). **Git SHA-1 identifies content, not product correctness.** The script will NOT verify UX visual accuracy, real browser navigation, E2EE, ACL, TTL, Matrix delivery or owner approval; use [User Journeys](USER-JOURNEYS.md) and independent device tests for those.

To review a specific pair of screens, open both accepted HTML files from [Screen Registry](SCREEN-REGISTRY.md), read their README specifications, and follow edge IDs in [Navigation Map](NAVIGATION-MAP.md). If a source was overwritten, the verification script fails even when the modified HTML still renders.

The original PB2 Markdown retains historical links to paths outside imported `docs/ux/`; such links are intentionally excluded from link validation. Never silently rewrite them within the immutable 117-file baseline.
